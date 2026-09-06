import { parseDiagramSource } from './parser';
import { buildDiagramScene } from './scene-builder';
import { diagramPaintColor, resolveDiagramTheme } from './theme';
import type {
  DiagramDiagnostic,
  DiagramPaint,
  DiagramRenderOptions,
  DiagramRenderResult,
  DiagramScene,
  DiagramSceneCommand,
  DiagramTheme,
} from './types';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function number(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(2).replace(/\.?0+$/u, '');
}

function stableHash(source: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of source) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function cssVariableName(paint: DiagramPaint): string {
  if (paint.startsWith('palette')) return `--diagram-${paint}`;
  return `--diagram-${paint.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
}

function svgPaint(paint: DiagramPaint | undefined, theme: DiagramTheme): string {
  if (!paint || paint === 'none') return 'none';
  return `var(${cssVariableName(paint)}, ${diagramPaintColor(paint, theme)})`;
}

function paintAttributes(
  command: Exclude<DiagramSceneCommand, { type: 'text' }>,
  theme: DiagramTheme,
): string {
  const attrs = [
    `fill="${svgPaint(command.fill, theme)}"`,
    `stroke="${svgPaint(command.stroke, theme)}"`,
  ];
  if (command.strokeWidth !== undefined) attrs.push(`stroke-width="${number(command.strokeWidth)}"`);
  if (command.opacity !== undefined) attrs.push(`opacity="${number(clampOpacity(command.opacity))}"`);
  if (command.dash && command.dash.length > 0) {
    attrs.push(`stroke-dasharray="${command.dash.map(number).join(' ')}"`);
  }
  if ('markerEnd' in command && command.markerEnd) attrs.push('marker-end="url(#arrow)"');
  attrs.push('vector-effect="non-scaling-stroke"');
  return attrs.join(' ');
}

function clampOpacity(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function commandToSvg(command: DiagramSceneCommand, theme: DiagramTheme): string {
  switch (command.type) {
    case 'rect':
      return `<rect x="${number(command.x)}" y="${number(command.y)}" width="${number(command.width)}" height="${number(command.height)}" rx="${number(command.radius ?? 0)}" ${paintAttributes(command, theme)}/>`;
    case 'line':
      return `<line x1="${number(command.x1)}" y1="${number(command.y1)}" x2="${number(command.x2)}" y2="${number(command.y2)}" ${paintAttributes(command, theme)}/>`;
    case 'polyline':
    case 'polygon':
      return `<${command.type} points="${command.points.map((point) => `${number(point.x)},${number(point.y)}`).join(' ')}" ${paintAttributes(command, theme)}/>`;
    case 'ellipse':
      return `<ellipse cx="${number(command.cx)}" cy="${number(command.cy)}" rx="${number(command.rx)}" ry="${number(command.ry)}" ${paintAttributes(command, theme)}/>`;
    case 'text': {
      const anchor = command.anchor ?? 'start';
      const style = command.italic ? ' font-style="italic"' : '';
      return `<text x="${number(command.x)}" y="${number(command.y)}" text-anchor="${anchor}" font-size="${number(command.size)}" font-weight="${command.weight ?? 400}" fill="${svgPaint(command.color, theme)}"${style}>${escapeXml(command.text)}</text>`;
    }
  }
}

function diagnosticsHtml(diagnostics: readonly DiagramDiagnostic[]): string {
  if (diagnostics.length === 0) return '';
  const items = diagnostics.map((diagnostic) =>
    `<li data-severity="${diagnostic.severity}">Line ${diagnostic.line}: ${escapeXml(diagnostic.message)}</li>`,
  ).join('');
  return `<details class="mermaid-diagram__diagnostics"><summary>${diagnostics.length} diagram ${diagnostics.length === 1 ? 'notice' : 'notices'}</summary><ul>${items}</ul></details>`;
}

export function renderDiagram(source: Uint8Array, options: DiagramRenderOptions = {}): DiagramRenderResult {
  const parsed = parseDiagramSource(source, options);
  if (!('kind' in parsed)) return { diagnostics: parsed.diagnostics };
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { diagnostics: parsed.diagnostics };
  }
  const scene = buildDiagramScene(parsed, options);
  return { scene, diagnostics: scene.diagnostics };
}

export function serializeDiagramScene(
  scene: DiagramScene,
  sourceId = 'diagram',
  options: DiagramRenderOptions = {},
): string {
  const theme = resolveDiagramTheme(options.theme);
  const safeId = sourceId.replaceAll(/[^a-zA-Z0-9_-]/gu, '-');
  const titleId = `${safeId}-title`;
  const descriptionId = `${safeId}-description`;
  const title = scene.title || `${scene.kind} diagram`;
  const description = scene.description || `Mermaid ${scene.kind} diagram rendered by SMDP`;
  const commands = scene.commands.map((command) => commandToSvg(command, theme)).join('');
  return `<svg class="mermaid-diagram__svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${number(scene.width)} ${number(scene.height)}" width="${number(scene.width)}" height="${number(scene.height)}" role="img" aria-labelledby="${titleId} ${descriptionId}" preserveAspectRatio="xMidYMin meet"><title id="${titleId}">${escapeXml(title)}</title><desc id="${descriptionId}">${escapeXml(description)}</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0 0 L8 4 L0 8 Z" fill="context-stroke"/></marker></defs>${commands}</svg>`;
}

export function renderDiagramToSvg(source: Uint8Array, options: DiagramRenderOptions = {}): string {
  const result = renderDiagram(source, options);
  if (!result.scene) {
    const message = result.diagnostics[0]?.message ?? 'Diagram rendering failed';
    throw new Error(message);
  }
  const id = `smdp-diagram-${stableHash(source)}`;
  return `<figure class="mermaid-diagram" data-diagram-kind="${result.scene.kind}" data-mermaid-version="${result.scene.compatibilityVersion}">${serializeDiagramScene(result.scene, id, options)}${diagnosticsHtml(result.diagnostics)}</figure>`;
}

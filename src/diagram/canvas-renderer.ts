import { diagramPaintColor, resolveDiagramTheme } from './theme';
import type {
  DiagramPaint,
  DiagramRenderOptions,
  DiagramScene,
  DiagramSceneCommand,
  DiagramTheme,
} from './types';

export interface CanvasDiagramDrawOptions extends DiagramRenderOptions {
  readonly x?: number;
  readonly y?: number;
  readonly maxWidth?: number;
}

function setPaint(
  context: CanvasRenderingContext2D,
  command: Exclude<DiagramSceneCommand, { type: 'text' }>,
  theme: DiagramTheme,
): void {
  context.fillStyle = diagramPaintColor(command.fill, theme);
  context.strokeStyle = diagramPaintColor(command.stroke, theme);
  context.lineWidth = command.strokeWidth ?? 1;
  context.globalAlpha = command.opacity ?? 1;
  context.setLineDash(command.dash ? [...command.dash] : []);
}

function hasPaint(paint: DiagramPaint | undefined): boolean {
  return paint !== undefined && paint !== 'none';
}

function paintCurrentPath(
  context: CanvasRenderingContext2D,
  command: Exclude<DiagramSceneCommand, { type: 'text' }>,
): void {
  if (hasPaint(command.fill)) context.fill();
  if (hasPaint(command.stroke)) context.stroke();
}

function drawArrow(
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = Math.max(5, context.lineWidth * 3.5);
  context.save();
  context.translate(x2, y2);
  context.rotate(angle);
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(-size, -size * 0.55);
  context.lineTo(-size, size * 0.55);
  context.closePath();
  context.fillStyle = context.strokeStyle;
  context.fill();
  context.restore();
}

function drawCommand(
  context: CanvasRenderingContext2D,
  command: DiagramSceneCommand,
  theme: DiagramTheme,
): void {
  if (command.type === 'text') {
    context.globalAlpha = 1;
    context.fillStyle = diagramPaintColor(command.color, theme);
    context.textAlign = command.anchor === 'middle' ? 'center' : command.anchor ?? 'start';
    context.textBaseline = 'alphabetic';
    context.font = `${command.italic ? 'italic ' : ''}${command.weight ?? 400} ${command.size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    if (command.maxWidth !== undefined) context.fillText(command.text, command.x, command.y, command.maxWidth);
    else context.fillText(command.text, command.x, command.y);
    return;
  }

  setPaint(context, command, theme);
  context.beginPath();
  switch (command.type) {
    case 'rect': {
      const radius = Math.max(0, Math.min(command.radius ?? 0, command.width / 2, command.height / 2));
      if (radius > 0 && typeof context.roundRect === 'function') {
        context.roundRect(command.x, command.y, command.width, command.height, radius);
      } else {
        context.rect(command.x, command.y, command.width, command.height);
      }
      paintCurrentPath(context, command);
      break;
    }
    case 'line':
      context.moveTo(command.x1, command.y1);
      context.lineTo(command.x2, command.y2);
      paintCurrentPath(context, command);
      if (command.markerEnd) drawArrow(context, command.x1, command.y1, command.x2, command.y2);
      break;
    case 'polyline':
    case 'polygon': {
      const first = command.points[0];
      if (!first) break;
      context.moveTo(first.x, first.y);
      for (let index = 1; index < command.points.length; index++) {
        context.lineTo(command.points[index].x, command.points[index].y);
      }
      if (command.type === 'polygon') context.closePath();
      paintCurrentPath(context, command);
      if (command.markerEnd && command.points.length >= 2) {
        const before = command.points[command.points.length - 2];
        const last = command.points[command.points.length - 1];
        drawArrow(context, before.x, before.y, last.x, last.y);
      }
      break;
    }
    case 'ellipse':
      context.ellipse(command.cx, command.cy, command.rx, command.ry, 0, 0, Math.PI * 2);
      paintCurrentPath(context, command);
      break;
  }
}

export function drawDiagramSceneToCanvas(
  scene: DiagramScene,
  context: CanvasRenderingContext2D,
  options: CanvasDiagramDrawOptions = {},
): number {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const maxWidth = Math.max(1, options.maxWidth ?? scene.width);
  const scale = Math.min(1, maxWidth / scene.width);
  const theme = resolveDiagramTheme(options.theme);
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const command of scene.commands) drawCommand(context, command, theme);
  context.restore();
  return scene.height * scale;
}

import type { ParsedDiagram, ParsedDiagramLine } from './parser';
import {
  MERMAID_COMPATIBILITY_VERSION,
  type DiagramDiagnostic,
  type DiagramPoint,
  type DiagramRenderOptions,
  type DiagramScene,
  type DiagramSceneCommand,
  type DiagramTextMeasure,
} from './types';

const DEFAULT_WIDTH = 760;
const MIN_WIDTH = 280;
const MAX_WIDTH = 1600;
const DEFAULT_MAX_COMMANDS = 50_000;
const NODE_HEIGHT = 54;
const NODE_GAP_Y = 44;

type NodeShape = 'rect' | 'round' | 'ellipse' | 'diamond';

interface GraphNode {
  readonly id: string;
  label: string;
  shape: NodeShape;
  readonly line: number;
}

interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly dashed: boolean;
  readonly thick: boolean;
  readonly line: number;
}

interface PositionedNode extends GraphNode {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface LaneItem {
  readonly section: string;
  readonly label: string;
  readonly detail: string;
  readonly score?: number;
  readonly line: number;
}

function approximateTextWidth(text: string, size: number, weight: number): number {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20) units += 0.34;
    else if (code >= 0x2e80 || code > 0xffff) units += 1;
    else if ('ilI.,:;!|\''.includes(char)) units += 0.3;
    else if ('MW@#%&'.includes(char)) units += 0.9;
    else units += 0.58;
  }
  return units * size * (weight >= 600 ? 1.04 : 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanLabel(value: string): string {
  let label = value.trim();
  if (label.startsWith('|')) {
    const closing = label.indexOf('|', 1);
    if (closing > 0) label = label.slice(closing + 1).trim();
  }
  label = label.replace(/:::[A-Za-z0-9_-]+$/u, '').trim();
  const wrappers: ReadonlyArray<readonly [string, string]> = [
    ['[[', ']]'], ['((', '))'], ['{{', '}}'], ['([', '])'],
    ['[/', '/]'], ['[\\', '\\]'], ['[', ']'], ['(', ')'], ['{', '}'], ['>', ']'],
  ];
  for (const [open, close] of wrappers) {
    if (label.startsWith(open) && label.endsWith(close) && label.length >= open.length + close.length) {
      label = label.slice(open.length, -close.length).trim();
      break;
    }
  }
  if (
    label.length >= 2 &&
    ((label.startsWith('"') && label.endsWith('"')) ||
      (label.startsWith("'") && label.endsWith("'")))
  ) {
    label = label.slice(1, -1);
  }
  return label.replaceAll('<br/>', ' / ').replaceAll('<br>', ' / ').replaceAll('&quot;', '"');
}

function firstIdentifier(value: string): string {
  const trimmed = value.trim();
  let end = 0;
  while (end < trimmed.length) {
    const code = trimmed.charCodeAt(end);
    const allowed =
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      code === 0x5f || code === 0x2d || code === 0x2e || code === 0x3a || code === 0x24;
    if (!allowed) break;
    end++;
  }
  return trimmed.slice(0, end);
}

function nodeFromToken(raw: string, line: number): GraphNode | null {
  const trimmed = raw.trim().replace(/^&\s*/, '');
  const id = firstIdentifier(trimmed);
  if (!id || id === 'end') return null;
  const suffix = trimmed.slice(id.length).trim();
  let shape: NodeShape = 'round';
  if (suffix.startsWith('{')) shape = 'diamond';
  else if (suffix.startsWith('((') || suffix.startsWith('([‘') || suffix.startsWith('([')) shape = 'ellipse';
  else if (suffix.startsWith('[')) shape = 'rect';
  const label = suffix ? cleanLabel(suffix) : cleanLabel(id);
  return { id, label: label || id, shape, line };
}

class SceneBuilder {
  readonly commands: DiagramSceneCommand[] = [];
  readonly diagnostics: DiagramDiagnostic[];
  readonly width: number;
  readonly measure: DiagramTextMeasure;
  private readonly maxCommands: number;
  private limitReported = false;

  constructor(parsed: ParsedDiagram, options: DiagramRenderOptions) {
    this.width = clamp(options.width ?? DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);
    this.measure = options.measureText ?? approximateTextWidth;
    this.maxCommands = options.maxCommands ?? DEFAULT_MAX_COMMANDS;
    this.diagnostics = [...parsed.diagnostics];
  }

  add(command: DiagramSceneCommand): void {
    if (this.commands.length < this.maxCommands) {
      this.commands.push(command);
      return;
    }
    if (!this.limitReported) {
      this.limitReported = true;
      this.warn('Diagram scene command limit reached; rendering was truncated', 1);
    }
  }

  warn(message: string, line: number): void {
    this.diagnostics.push({ severity: 'warning', message, line, column: 1 });
  }

  text(
    x: number,
    y: number,
    text: string,
    size = 14,
    anchor: 'start' | 'middle' | 'end' = 'start',
    weight: 400 | 500 | 600 | 700 = 400,
    color: Extract<DiagramSceneCommand, { type: 'text' }>['color'] = 'text',
    maxWidth?: number,
  ): void {
    let visibleText = text;
    if (maxWidth !== undefined && maxWidth > 0 && this.measure(visibleText, size, weight) > maxWidth) {
      const characters = [...visibleText];
      let low = 0;
      let high = characters.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = `${characters.slice(0, middle).join('')}…`;
        if (this.measure(candidate, size, weight) <= maxWidth) low = middle;
        else high = middle - 1;
      }
      visibleText = low > 0 ? `${characters.slice(0, low).join('')}…` : '…';
    }
    const base = { type: 'text' as const, x, y, text: visibleText, size, anchor, weight, color };
    this.add(maxWidth === undefined ? base : { ...base, maxWidth });
  }

  finish(parsed: ParsedDiagram, height: number): DiagramScene {
    return {
      abiVersion: 1,
      compatibilityVersion: MERMAID_COMPATIBILITY_VERSION,
      kind: parsed.kind,
      direction: parsed.direction,
      width: this.width,
      height: Math.max(120, Math.ceil(height)),
      title: parsed.title,
      description: parsed.description,
      commands: this.commands,
      diagnostics: this.diagnostics,
      usesSimd: true,
    };
  }
}

function addTitle(builder: SceneBuilder, parsed: ParsedDiagram): number {
  if (!parsed.title) return 20;
  builder.text(builder.width / 2, 29, parsed.title, 18, 'middle', 700, 'text', builder.width - 40);
  return 54;
}

function arrowOperator(value: string): { index: number; value: string } | null {
  const operators = [
    '<==>', '<-->', '<<-->>', '<->', '<|--', '--|>', '..|>', '-->>', '->>', '-->', '-.->',
    '==>', '--x', '--o', 'o--o', 'x--x', '*--', '--*', 'o--', '--o', '<--', '---', '..>',
    '->', '<-', '--', '==',
  ];
  let best: { index: number; value: string } | null = null;
  for (const operator of operators) {
    const index = value.indexOf(operator);
    if (index >= 0 && (!best || index < best.index || (index === best.index && operator.length > best.value.length))) {
      best = { index, value: operator };
    }
  }
  return best;
}

function parseFunctionArguments(value: string): string[] {
  const open = value.indexOf('(');
  const close = value.lastIndexOf(')');
  if (open < 0 || close <= open) return [];
  const source = value.slice(open + 1, close);
  const args: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (const char of source) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ',') {
      args.push(cleanLabel(current));
      current = '';
      continue;
    }
    current += char;
  }
  args.push(cleanLabel(current));
  return args;
}

function parseGraph(parsed: ParsedDiagram, builder: SceneBuilder): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  let generated = 0;

  const remember = (node: GraphNode | null): GraphNode | null => {
    if (!node) return null;
    const existing = nodes.get(node.id);
    if (existing) {
      if (node.label !== node.id) existing.label = node.label;
      if (node.shape !== 'round') existing.shape = node.shape;
      return existing;
    }
    nodes.set(node.id, node);
    return node;
  };

  const edgeNode = (raw: string, line: number, side: 'from' | 'to'): GraphNode | null => {
    if (parsed.kind === 'state' && raw.trim() === '[*]') {
      return {
        id: `__state_${side}_${line}`,
        label: side === 'from' ? 'Start' : 'End',
        shape: 'ellipse',
        line,
      };
    }
    return nodeFromToken(raw, line);
  };

  for (const line of parsed.body) {
    const text = line.trimmed;
    const lower = text.toLowerCase();
    if (
      !text || lower === 'end' || lower.startsWith('direction ') || lower.startsWith('style ') ||
      lower.startsWith('classdef ') || (lower.startsWith('class ') && parsed.kind !== 'class') || lower.startsWith('linkstyle ') ||
      lower.startsWith('click ') || lower.startsWith('hideemptydescription') || lower.startsWith('namespace ')
    ) {
      continue;
    }
    if (parsed.kind === 'class' && (text === '}' || /^[+\-#~]/u.test(text))) continue;
    if (lower.startsWith('subgraph ')) {
      const label = cleanLabel(text.slice(9));
      const id = `subgraph_${generated++}`;
      remember({ id, label, shape: 'round', line: line.line });
      continue;
    }

    if (parsed.kind === 'class' && lower.startsWith('class ')) {
      const declaration = text.slice(6).trim();
      const brace = declaration.indexOf('{');
      const names = (brace >= 0 ? declaration.slice(0, brace) : declaration)
        .split(',')
        .map((name) => firstIdentifier(name))
        .filter(Boolean);
      for (const name of names) {
        remember({ id: name, label: name, shape: 'rect', line: line.line });
      }
      continue;
    }

    if (parsed.kind === 'er') {
      const relationship = /^(\S+)\s+([|o}{]+(?:--|\.\.)[|o}{]+)\s+(\S+)(?:\s*:\s*(.*))?$/u.exec(text);
      if (relationship) {
        const fromId = firstIdentifier(relationship[1]);
        const toId = firstIdentifier(relationship[3]);
        const from = remember(fromId ? { id: fromId, label: fromId, shape: 'rect', line: line.line } : null);
        const to = remember(toId ? { id: toId, label: toId, shape: 'rect', line: line.line } : null);
        if (from && to) {
          edges.push({
            from: from.id,
            to: to.id,
            label: cleanLabel(relationship[4] ?? ''),
            dashed: relationship[2].includes('..'),
            thick: false,
            line: line.line,
          });
        }
        continue;
      }
    }

    const callName = firstIdentifier(text).toLowerCase();
    const args = parseFunctionArguments(text);
    if (args.length > 0 && /^(person|person_ext|system|system_ext|container|container_ext|component|component_ext|boundary|enterprise_boundary|system_boundary|container_boundary|deployment_node|node|service|group|junction)$/u.test(callName)) {
      const id = args[0] || `node_${generated++}`;
      const label = args[1] || id;
      remember({ id, label, shape: callName === 'person' || callName === 'person_ext' ? 'ellipse' : 'round', line: line.line });
      continue;
    }
    if (args.length >= 2 && /^(rel|rel_u|rel_d|rel_l|rel_r|birel|rel_neighbor)$/u.test(callName)) {
      const from = remember({ id: args[0], label: args[0], shape: 'round', line: line.line });
      const to = remember({ id: args[1], label: args[1], shape: 'round', line: line.line });
      if (from && to) edges.push({ from: from.id, to: to.id, label: args[2] ?? '', dashed: false, thick: false, line: line.line });
      continue;
    }

    const operator = arrowOperator(text);
    if (operator) {
      const leftRaw = text.slice(0, operator.index).trim();
      let rightRaw = text.slice(operator.index + operator.value.length).trim();
      let label = '';
      if (rightRaw.startsWith('|')) {
        const endLabel = rightRaw.indexOf('|', 1);
        if (endLabel > 0) {
          label = cleanLabel(rightRaw.slice(1, endLabel));
          rightRaw = rightRaw.slice(endLabel + 1).trim();
        }
      } else {
        const colon = rightRaw.lastIndexOf(':');
        if (colon > 0 && (parsed.kind === 'er' || parsed.kind === 'state' || parsed.kind === 'class')) {
          label = cleanLabel(rightRaw.slice(colon + 1));
          rightRaw = rightRaw.slice(0, colon).trim();
        }
      }
      const left = remember(edgeNode(leftRaw, line.line, 'from'));
      const right = remember(edgeNode(rightRaw, line.line, 'to'));
      if (left && right) {
        edges.push({
          from: left.id,
          to: right.id,
          label,
          dashed: operator.value.includes('.'),
          thick: operator.value.includes('='),
          line: line.line,
        });
        continue;
      }
    }

    const brace = text.indexOf('{');
    if (brace > 0 && parsed.kind === 'er') {
      const id = firstIdentifier(text.slice(0, brace));
      if (id) remember({ id, label: id, shape: 'rect', line: line.line });
      continue;
    }
    const standalone = nodeFromToken(text, line.line);
    if (standalone && standalone.label !== standalone.id) {
      remember(standalone);
      continue;
    }

    const id = `annotation_${generated++}`;
    remember({ id, label: text, shape: 'round', line: line.line });
    builder.warn('Rendered an unrecognized construct as an annotation', line.line);
  }

  return { nodes: [...nodes.values()], edges };
}

function graphRanks(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Map<string, number> {
  const ranks = new Map(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const edge of edges) {
      const from = ranks.get(edge.from) ?? 0;
      const to = ranks.get(edge.to) ?? 0;
      if (edge.from !== edge.to && to <= from && from + 1 < nodes.length) {
        ranks.set(edge.to, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return ranks;
}

function renderNode(builder: SceneBuilder, node: PositionedNode, paletteIndex: number): void {
  if (node.shape === 'ellipse') {
    builder.add({
      type: 'ellipse', cx: node.x, cy: node.y, rx: node.width / 2, ry: node.height / 2,
      fill: 'surface', stroke: `palette${paletteIndex % 6}` as 'palette0', strokeWidth: 1.6,
    });
  } else if (node.shape === 'diamond') {
    builder.add({
      type: 'polygon',
      points: [
        { x: node.x, y: node.y - node.height / 2 },
        { x: node.x + node.width / 2, y: node.y },
        { x: node.x, y: node.y + node.height / 2 },
        { x: node.x - node.width / 2, y: node.y },
      ],
      fill: 'surface', stroke: `palette${paletteIndex % 6}` as 'palette0', strokeWidth: 1.6,
    });
  } else {
    builder.add({
      type: 'rect', x: node.x - node.width / 2, y: node.y - node.height / 2,
      width: node.width, height: node.height, radius: node.shape === 'round' ? 12 : 2,
      fill: 'surface', stroke: `palette${paletteIndex % 6}` as 'palette0', strokeWidth: 1.6,
    });
  }
  const availableLabelWidth = node.width - 16;
  const naturalLabelWidth = builder.measure(node.label, 13, 600);
  const words = node.label.trim().split(/\s+/u);
  if (naturalLabelWidth > availableLabelWidth && words.length > 1) {
    let best: { first: string; second: string; width: number } | null = null;
    for (let index = 1; index < words.length; index++) {
      const first = words.slice(0, index).join(' ');
      const second = words.slice(index).join(' ');
      const width = Math.max(builder.measure(first, 12, 600), builder.measure(second, 12, 600));
      if (!best || width < best.width) best = { first, second, width };
    }
    if (best) {
      const labelSize = Math.max(9, Math.min(12, 12 * availableLabelWidth / best.width * 0.96));
      builder.text(node.x, node.y - 2, best.first, labelSize, 'middle', 600, 'text', availableLabelWidth);
      builder.text(node.x, node.y + labelSize, best.second, labelSize, 'middle', 600, 'text', availableLabelWidth);
      return;
    }
  }
  const labelSize = naturalLabelWidth > availableLabelWidth
    ? Math.max(8.5, 13 * availableLabelWidth / naturalLabelWidth * 0.96)
    : 13;
  builder.text(node.x, node.y + labelSize * 0.36, node.label, labelSize, 'middle', 600, 'text', availableLabelWidth);
}

function renderGraph(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const graph = parseGraph(parsed, builder);
  if (graph.nodes.length === 0) {
    builder.warn('The diagram contains no renderable nodes', 1);
    builder.text(builder.width / 2, titleBottom + 36, 'No diagram content', 14, 'middle', 500, 'muted');
    return builder.finish(parsed, titleBottom + 72);
  }

  const ranks = graphRanks(graph.nodes, graph.edges);
  const byRank = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    const list = byRank.get(rank) ?? [];
    list.push(node);
    byRank.set(rank, list);
  }
  const rankValues = [...byRank.keys()].sort((a, b) => a - b);
  const maxRankSize = Math.max(...rankValues.map((rank) => byRank.get(rank)?.length ?? 0));
  const horizontal = parsed.direction === 'LR' || parsed.direction === 'RL';
  const desiredNodeWidth = clamp(
    Math.max(...graph.nodes.map((node) => builder.measure(node.label, 13, 600) + 30)),
    92,
    190,
  );
  const horizontalNodeWidth = Math.max(
    68,
    Math.min(
      desiredNodeWidth,
      (builder.width - 40 - Math.max(0, rankValues.length - 1) * 36) / Math.max(1, rankValues.length),
    ),
  );
  const verticalNodeWidth = Math.max(
    88,
    Math.min(
      desiredNodeWidth,
      (builder.width - 40 - Math.max(0, maxRankSize - 1) * 30) / Math.max(1, maxRankSize),
    ),
  );
  const nodeWidth = horizontal ? horizontalNodeWidth : verticalNodeWidth;
  const firstRankX = 20 + nodeWidth / 2;
  const lastRankX = builder.width - 20 - nodeWidth / 2;
  const rankStepX = rankValues.length > 1
    ? (lastRankX - firstRankX) / (rankValues.length - 1)
    : 0;
  const rankStepY = NODE_HEIGHT + NODE_GAP_Y + 34;
  const horizontalLaneHeight = maxRankSize * NODE_HEIGHT + Math.max(0, maxRankSize - 1) * NODE_GAP_Y;
  const positioned = new Map<string, PositionedNode>();

  for (let rankIndex = 0; rankIndex < rankValues.length; rankIndex++) {
    const rank = rankValues[rankIndex];
    const list = byRank.get(rank) ?? [];
    const listHeight = list.length * NODE_HEIGHT + Math.max(0, list.length - 1) * NODE_GAP_Y;
    const firstItemX = 20 + nodeWidth / 2;
    const lastItemX = builder.width - 20 - nodeWidth / 2;
    const itemStepX = list.length > 1 ? (lastItemX - firstItemX) / (list.length - 1) : 0;
    for (let itemIndex = 0; itemIndex < list.length; itemIndex++) {
      const rankPosition = parsed.direction === 'RL' || parsed.direction === 'BT'
        ? rankValues.length - 1 - rankIndex
        : rankIndex;
      const rawX = horizontal
        ? (rankValues.length > 1 ? firstRankX + rankPosition * rankStepX : builder.width / 2)
        : (list.length > 1 ? firstItemX + itemIndex * itemStepX : builder.width / 2);
      const rawY = horizontal
        ? titleBottom + 44 + (horizontalLaneHeight - listHeight) / 2 + NODE_HEIGHT / 2 + itemIndex * (NODE_HEIGHT + NODE_GAP_Y)
        : titleBottom + 48 + NODE_HEIGHT / 2 + rankPosition * rankStepY;
      positioned.set(list[itemIndex].id, {
        ...list[itemIndex],
        x: rawX,
        y: rawY,
        width: nodeWidth,
        height: NODE_HEIGHT,
      });
    }
  }

  for (const edge of graph.edges) {
    const from = positioned.get(edge.from);
    const to = positioned.get(edge.to);
    if (!from || !to) continue;
    let x1 = from.x;
    let y1 = from.y;
    let x2 = to.x;
    let y2 = to.y;
    if (horizontal) {
      const sign = x2 >= x1 ? 1 : -1;
      x1 += sign * from.width / 2;
      x2 -= sign * to.width / 2;
    } else {
      const sign = y2 >= y1 ? 1 : -1;
      y1 += sign * from.height / 2;
      y2 -= sign * to.height / 2;
    }
    builder.add({
      type: 'line', x1, y1, x2, y2, stroke: 'border', strokeWidth: edge.thick ? 2.5 : 1.5,
      markerEnd: true, ...(edge.dashed ? { dash: [6, 5] } : {}),
    });
    if (edge.label) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const width = clamp(builder.measure(edge.label, 11, 500) + 12, 36, 170);
      builder.add({ type: 'rect', x: mx - width / 2, y: my - 11, width, height: 20, radius: 5, fill: 'background' });
      builder.text(mx, my + 4, edge.label, 11, 'middle', 500, 'muted', width - 8);
    }
  }
  let index = 0;
  for (const node of positioned.values()) renderNode(builder, node, index++);
  const bottom = Math.max(...[...positioned.values()].map((node) => node.y + node.height / 2), titleBottom + 50);
  return builder.finish(parsed, bottom + 32);
}

function parseSequenceMessage(text: string): { from: string; to: string; label: string; dashed: boolean } | null {
  const colon = text.indexOf(':');
  if (colon < 0) return null;
  const head = text.slice(0, colon).trim();
  const operator = arrowOperator(head);
  if (!operator) return null;
  const from = firstIdentifier(head.slice(0, operator.index));
  const to = firstIdentifier(head.slice(operator.index + operator.value.length));
  if (!from || !to) return null;
  return {
    from,
    to,
    label: cleanLabel(text.slice(colon + 1)),
    dashed: operator.value.includes('--') || operator.value.includes('.'),
  };
}

function renderSequence(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const participants = new Map<string, string>();
  const messages: Array<{ from: string; to: string; label: string; dashed: boolean; line: number }> = [];
  const notes: Array<{ label: string; line: number }> = [];
  for (const line of parsed.body) {
    const lower = line.trimmed.toLowerCase();
    if (lower.startsWith('participant ') || lower.startsWith('actor ')) {
      const rest = line.trimmed.slice(line.trimmed.indexOf(' ') + 1).trim();
      const alias = /\s+as\s+/iu.exec(rest);
      const id = firstIdentifier(alias ? rest.slice(0, alias.index) : rest);
      const label = alias ? cleanLabel(rest.slice(alias.index + alias[0].length)) : id;
      if (id) participants.set(id, label || id);
      continue;
    }
    const message = parseSequenceMessage(line.trimmed);
    if (message) {
      if (!participants.has(message.from)) participants.set(message.from, message.from);
      if (!participants.has(message.to)) participants.set(message.to, message.to);
      messages.push({ ...message, line: line.line });
      continue;
    }
    if (lower.startsWith('note ') || lower.startsWith('loop ') || lower.startsWith('alt ') || lower.startsWith('opt ') || lower.startsWith('par ') || lower.startsWith('critical ')) {
      const colon = line.trimmed.indexOf(':');
      notes.push({ label: cleanLabel(colon >= 0 ? line.trimmed.slice(colon + 1) : line.trimmed), line: line.line });
    }
  }
  if (participants.size === 0) {
    builder.warn('The sequence diagram has no participants', 1);
    return builder.finish(parsed, titleBottom + 70);
  }

  const ids = [...participants.keys()];
  const left = 42;
  const usable = builder.width - left * 2;
  const gap = ids.length === 1 ? 0 : usable / (ids.length - 1);
  const xById = new Map(ids.map((id, index) => [id, ids.length === 1 ? builder.width / 2 : left + index * gap]));
  const headerY = titleBottom + 30;
  const startY = headerY + 46;
  const rowHeight = 64;
  const bottom = startY + Math.max(messages.length, 1) * rowHeight + notes.length * 36 + 28;
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    const x = xById.get(id) ?? 0;
    const boxWidth = clamp(builder.measure(participants.get(id) ?? id, 12, 600) + 22, 72, Math.max(72, gap - 12));
    builder.add({ type: 'rect', x: x - boxWidth / 2, y: headerY, width: boxWidth, height: 34, radius: 8, fill: 'surface', stroke: `palette${index % 6}` as 'palette0', strokeWidth: 1.4 });
    builder.text(x, headerY + 22, participants.get(id) ?? id, 12, 'middle', 600, 'text', boxWidth - 10);
    builder.add({ type: 'line', x1: x, y1: headerY + 34, x2: x, y2: bottom, stroke: 'border', strokeWidth: 1, dash: [5, 5] });
  }
  let y = startY;
  for (const message of messages) {
    const x1 = xById.get(message.from) ?? left;
    const x2 = xById.get(message.to) ?? builder.width - left;
    builder.add({ type: 'line', x1, y1: y, x2, y2: y, stroke: 'accent', strokeWidth: 1.5, markerEnd: true, ...(message.dashed ? { dash: [6, 4] } : {}) });
    builder.text((x1 + x2) / 2, y - 9, message.label, 11, 'middle', 500, 'text', Math.abs(x2 - x1) - 14);
    y += rowHeight;
  }
  for (const note of notes) {
    const width = clamp(builder.measure(note.label, 11, 500) + 20, 90, builder.width - 70);
    builder.add({ type: 'rect', x: (builder.width - width) / 2, y: y - 18, width, height: 30, radius: 5, fill: 'surfaceAlt', stroke: 'border', strokeWidth: 1 });
    builder.text(builder.width / 2, y + 1, note.label, 11, 'middle', 500, 'text', width - 12);
    y += 36;
  }
  return builder.finish(parsed, bottom + 18);
}

function parseLaneItems(parsed: ParsedDiagram): LaneItem[] {
  const items: LaneItem[] = [];
  let section = 'Items';
  for (const line of parsed.body) {
    const text = line.trimmed;
    const lower = text.toLowerCase();
    if (!text || lower.startsWith('dateformat ') || lower.startsWith('axisformat ') || lower.startsWith('excludes ') || lower.startsWith('weekday ')) continue;
    if (lower.startsWith('section ')) {
      section = cleanLabel(text.slice(8)) || section;
      continue;
    }
    if (parsed.kind === 'gitGraph') {
      const keyword = firstIdentifier(text).toLowerCase();
      if (['commit', 'branch', 'checkout', 'switch', 'merge', 'cherry-pick'].includes(keyword)) {
        items.push({ section: keyword === 'commit' ? section : keyword, label: cleanLabel(text), detail: '', line: line.line });
      }
      continue;
    }
    const colon = text.indexOf(':');
    if (colon >= 0) {
      const label = cleanLabel(text.slice(0, colon));
      const detail = cleanLabel(text.slice(colon + 1));
      let score: number | undefined;
      if (parsed.kind === 'journey') {
        const scoreValue = finiteNumber(detail.split(':', 1)[0]);
        if (scoreValue !== null) score = scoreValue;
      }
      items.push(score === undefined
        ? { section, label, detail, line: line.line }
        : { section, label, detail, score, line: line.line });
      continue;
    }
    const bracket = /^([A-Za-z0-9_.-]+)\s*\[(.*)\]$/u.exec(text);
    if (bracket) {
      if (line.indent <= 2) section = cleanLabel(bracket[2]) || bracket[1];
      else items.push({ section, label: cleanLabel(bracket[2]), detail: '', line: line.line });
      continue;
    }
    items.push({ section, label: cleanLabel(text), detail: '', line: line.line });
  }
  return items;
}

function renderLanes(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const items = parseLaneItems(parsed);
  if (items.length === 0) {
    builder.warn('The diagram contains no lane items', 1);
    return builder.finish(parsed, titleBottom + 70);
  }
  const sections = [...new Set(items.map((item) => item.section))];
  const labelWidth = clamp(Math.max(...sections.map((section) => builder.measure(section, 12, 600))) + 24, 80, 150);
  const laneLeft = 18 + labelWidth;
  const laneWidth = builder.width - laneLeft - 18;
  const rowHeight = 64;
  let y = titleBottom + 20;
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];
    const sectionItems = items.filter((item) => item.section === section);
    const sectionHeight = Math.max(rowHeight, sectionItems.length * rowHeight);
    builder.add({ type: 'rect', x: 18, y, width: labelWidth - 8, height: sectionHeight - 6, radius: 8, fill: `palette${sectionIndex % 6}` as 'palette0', opacity: 0.14, stroke: `palette${sectionIndex % 6}` as 'palette0', strokeWidth: 1 });
    builder.text(18 + (labelWidth - 8) / 2, y + 28, section, 12, 'middle', 700, 'text', labelWidth - 20);
    for (let itemIndex = 0; itemIndex < sectionItems.length; itemIndex++) {
      const item = sectionItems[itemIndex];
      const itemY = y + itemIndex * rowHeight;
      builder.add({ type: 'rect', x: laneLeft, y: itemY, width: laneWidth, height: rowHeight - 6, radius: 8, fill: itemIndex % 2 ? 'surfaceAlt' : 'surface', stroke: 'border', strokeWidth: 1 });
      builder.text(laneLeft + 14, itemY + 23, item.label, 13, 'start', 600, 'text', laneWidth * 0.48);
      if (item.detail) builder.text(laneLeft + laneWidth - 14, itemY + 23, item.detail, 11, 'end', 400, 'muted', laneWidth * 0.45);
      if (item.score !== undefined) {
        const scoreWidth = clamp(item.score, 0, 5) / 5 * Math.max(20, laneWidth * 0.24);
        builder.add({ type: 'rect', x: laneLeft + 14, y: itemY + 38, width: scoreWidth, height: 5, radius: 2.5, fill: 'accent' });
      }
    }
    y += sectionHeight + 10;
  }
  return builder.finish(parsed, y + 8);
}

function parseLabelValue(line: ParsedDiagramLine): { label: string; value: number } | null {
  const colon = line.trimmed.lastIndexOf(':');
  if (colon <= 0) return null;
  const value = finiteNumber(line.trimmed.slice(colon + 1));
  if (value === null) return null;
  return { label: cleanLabel(line.trimmed.slice(0, colon)), value };
}

function renderPie(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const values = parsed.body.map(parseLabelValue).filter((value): value is { label: string; value: number } => value !== null && value.value >= 0);
  const total = values.reduce((sum, value) => sum + value.value, 0);
  if (values.length === 0 || total <= 0) {
    builder.warn('Pie chart values must contain at least one positive number', 1);
    return builder.finish(parsed, titleBottom + 80);
  }
  const radius = clamp(builder.width * 0.24, 78, 150);
  const cx = Math.min(radius + 28, builder.width * 0.34);
  const cy = titleBottom + radius + 20;
  let angle = -Math.PI / 2;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    const sweep = value.value / total * Math.PI * 2;
    const steps = Math.max(3, Math.ceil(sweep / (Math.PI / 18)));
    const points: DiagramPoint[] = [{ x: cx, y: cy }];
    for (let step = 0; step <= steps; step++) {
      const pointAngle = angle + sweep * step / steps;
      points.push({ x: cx + Math.cos(pointAngle) * radius, y: cy + Math.sin(pointAngle) * radius });
    }
    builder.add({ type: 'polygon', points, fill: `palette${index % 6}` as 'palette0', stroke: 'background', strokeWidth: 1.2 });
    angle += sweep;
  }
  const legendX = Math.min(builder.width - 190, cx + radius + 34);
  for (let index = 0; index < values.length; index++) {
    const y = titleBottom + 30 + index * 28;
    builder.add({ type: 'rect', x: legendX, y: y - 11, width: 13, height: 13, radius: 3, fill: `palette${index % 6}` as 'palette0' });
    builder.text(legendX + 21, y, `${values[index].label} (${values[index].value})`, 11, 'start', 500, 'text', builder.width - legendX - 25);
  }
  return builder.finish(parsed, Math.max(cy + radius + 24, titleBottom + values.length * 28 + 42));
}

function numberArray(value: string): number[] {
  const start = value.indexOf('[');
  const end = value.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  return value.slice(start + 1, end).split(',').map(finiteNumber).filter((item): item is number => item !== null);
}

function renderXY(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const series: Array<{ type: 'bar' | 'line'; values: number[] }> = [];
  for (const line of parsed.body) {
    const lower = line.trimmed.toLowerCase();
    if (lower.startsWith('bar ')) series.push({ type: 'bar', values: numberArray(line.trimmed) });
    if (lower.startsWith('line ')) series.push({ type: 'line', values: numberArray(line.trimmed) });
  }
  const all = series.flatMap((item) => item.values);
  if (all.length === 0) {
    builder.warn('XY chart contains no bar or line values', 1);
    return builder.finish(parsed, titleBottom + 80);
  }
  const plot = { x: 54, y: titleBottom + 20, width: builder.width - 82, height: 260 };
  const min = Math.min(0, ...all);
  const max = Math.max(1, ...all);
  const scaleY = (value: number): number => plot.y + plot.height - (value - min) / Math.max(1e-9, max - min) * plot.height;
  builder.add({ type: 'line', x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.height, stroke: 'border', strokeWidth: 1.3 });
  builder.add({ type: 'line', x1: plot.x, y1: scaleY(0), x2: plot.x + plot.width, y2: scaleY(0), stroke: 'border', strokeWidth: 1.3 });
  const maxCount = Math.max(...series.map((item) => item.values.length));
  const stepX = plot.width / Math.max(1, maxCount);
  for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
    const item = series[seriesIndex];
    if (item.type === 'bar') {
      const barWidth = Math.max(3, stepX * 0.64 / Math.max(1, series.filter((candidate) => candidate.type === 'bar').length));
      for (let index = 0; index < item.values.length; index++) {
        const valueY = scaleY(item.values[index]);
        const zeroY = scaleY(0);
        builder.add({ type: 'rect', x: plot.x + index * stepX + stepX * 0.18 + seriesIndex * barWidth, y: Math.min(valueY, zeroY), width: barWidth, height: Math.max(1, Math.abs(zeroY - valueY)), radius: 2, fill: `palette${seriesIndex % 6}` as 'palette0' });
      }
    } else {
      const points = item.values.map((value, index) => ({ x: plot.x + (index + 0.5) * stepX, y: scaleY(value) }));
      builder.add({ type: 'polyline', points, fill: 'none', stroke: `palette${seriesIndex % 6}` as 'palette0', strokeWidth: 2.2 });
      for (const point of points) builder.add({ type: 'ellipse', cx: point.x, cy: point.y, rx: 3.5, ry: 3.5, fill: `palette${seriesIndex % 6}` as 'palette0' });
    }
  }
  builder.text(plot.x - 8, plot.y + 5, String(max), 10, 'end', 400, 'muted');
  builder.text(plot.x - 8, plot.y + plot.height, String(min), 10, 'end', 400, 'muted');
  return builder.finish(parsed, plot.y + plot.height + 32);
}

function renderQuadrant(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const size = Math.min(builder.width - 80, 390);
  const x = (builder.width - size) / 2;
  const y = titleBottom + 30;
  builder.add({ type: 'rect', x, y, width: size / 2, height: size / 2, fill: 'palette0', opacity: 0.09 });
  builder.add({ type: 'rect', x: x + size / 2, y, width: size / 2, height: size / 2, fill: 'palette1', opacity: 0.09 });
  builder.add({ type: 'rect', x, y: y + size / 2, width: size / 2, height: size / 2, fill: 'palette2', opacity: 0.09 });
  builder.add({ type: 'rect', x: x + size / 2, y: y + size / 2, width: size / 2, height: size / 2, fill: 'palette3', opacity: 0.09 });
  builder.add({ type: 'rect', x, y, width: size, height: size, fill: 'none', stroke: 'border', strokeWidth: 1.2 });
  builder.add({ type: 'line', x1: x + size / 2, y1: y, x2: x + size / 2, y2: y + size, stroke: 'border', strokeWidth: 1 });
  builder.add({ type: 'line', x1: x, y1: y + size / 2, x2: x + size, y2: y + size / 2, stroke: 'border', strokeWidth: 1 });
  let points = 0;
  for (const line of parsed.body) {
    const values = numberArray(line.trimmed);
    const colon = line.trimmed.indexOf(':');
    if (values.length < 2 || colon <= 0) continue;
    const px = x + clamp(values[0], 0, 1) * size;
    const py = y + (1 - clamp(values[1], 0, 1)) * size;
    builder.add({ type: 'ellipse', cx: px, cy: py, rx: 5, ry: 5, fill: `palette${points % 6}` as 'palette0', stroke: 'background', strokeWidth: 1 });
    builder.text(px + 8, py + 4, cleanLabel(line.trimmed.slice(0, colon)), 10, 'start', 500, 'text', 120);
    points++;
  }
  if (points === 0) builder.warn('Quadrant chart contains no [x, y] points', 1);
  return builder.finish(parsed, y + size + 32);
}

function renderRadar(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  let axes: string[] = [];
  const curves: number[][] = [];
  for (const line of parsed.body) {
    const lower = line.trimmed.toLowerCase();
    if (lower.startsWith('axis ')) {
      const open = line.trimmed.indexOf('[');
      const close = line.trimmed.lastIndexOf(']');
      if (open >= 0 && close > open) axes = line.trimmed.slice(open + 1, close).split(',').map(cleanLabel);
    }
    if (lower.startsWith('curve ')) curves.push(numberArray(line.trimmed));
  }
  const count = Math.max(axes.length, ...curves.map((curve) => curve.length), 3);
  if (axes.length === 0) axes = Array.from({ length: count }, (_, index) => `Axis ${index + 1}`);
  const all = curves.flat();
  const max = Math.max(1, ...all);
  const radius = clamp(builder.width * 0.28, 85, 180);
  const cx = builder.width / 2;
  const cy = titleBottom + radius + 34;
  const point = (index: number, value = 1): DiagramPoint => {
    const angle = -Math.PI / 2 + index / count * Math.PI * 2;
    return { x: cx + Math.cos(angle) * radius * value, y: cy + Math.sin(angle) * radius * value };
  };
  for (let ring = 1; ring <= 4; ring++) {
    builder.add({ type: 'polygon', points: Array.from({ length: count }, (_, index) => point(index, ring / 4)), fill: 'none', stroke: 'border', strokeWidth: 0.7, opacity: 0.7 });
  }
  for (let index = 0; index < count; index++) {
    const edge = point(index);
    builder.add({ type: 'line', x1: cx, y1: cy, x2: edge.x, y2: edge.y, stroke: 'border', strokeWidth: 0.7 });
    const label = point(index, 1.13);
    builder.text(label.x, label.y + 4, axes[index] ?? `Axis ${index + 1}`, 10, 'middle', 500, 'muted', 90);
  }
  for (let curveIndex = 0; curveIndex < curves.length; curveIndex++) {
    const values = curves[curveIndex];
    builder.add({ type: 'polygon', points: Array.from({ length: count }, (_, index) => point(index, clamp((values[index] ?? 0) / max, 0, 1))), fill: `palette${curveIndex % 6}` as 'palette0', stroke: `palette${curveIndex % 6}` as 'palette0', strokeWidth: 1.7, opacity: 0.2 });
  }
  if (curves.length === 0) builder.warn('Radar chart contains no curve values', 1);
  return builder.finish(parsed, cy + radius + 46);
}

function renderSankey(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const rows: Array<{ from: string; to: string; value: number; line: number }> = [];
  for (const line of parsed.body) {
    const parts = line.text.split(',').map(cleanLabel);
    const value = parts.length >= 3 ? finiteNumber(parts[2]) : null;
    if (parts.length >= 3 && value !== null && value >= 0) rows.push({ from: parts[0], to: parts[1], value, line: line.line });
  }
  if (rows.length === 0) {
    builder.warn('Sankey diagram contains no source,target,value rows', 1);
    return builder.finish(parsed, titleBottom + 80);
  }
  const sources = [...new Set(rows.map((row) => row.from))];
  const targets = [...new Set(rows.map((row) => row.to))];
  const top = titleBottom + 24;
  const height = Math.max(230, Math.max(sources.length, targets.length) * 52);
  const leftX = 32;
  const rightX = builder.width - 50;
  const nodeWidth = 18;
  const yFor = (index: number, count: number): number => top + (index + 0.5) * height / count;
  const maxValue = Math.max(...rows.map((row) => row.value), 1);
  for (const row of rows) {
    const y1 = yFor(sources.indexOf(row.from), sources.length);
    const y2 = yFor(targets.indexOf(row.to), targets.length);
    builder.add({ type: 'polyline', points: [{ x: leftX + nodeWidth, y: y1 }, { x: builder.width / 2, y: (y1 + y2) / 2 }, { x: rightX, y: y2 }], fill: 'none', stroke: `palette${rows.indexOf(row) % 6}` as 'palette0', strokeWidth: 1.5 + row.value / maxValue * 9, opacity: 0.55 });
  }
  sources.forEach((label, index) => {
    const y = yFor(index, sources.length);
    builder.add({ type: 'rect', x: leftX, y: y - 17, width: nodeWidth, height: 34, radius: 3, fill: `palette${index % 6}` as 'palette0' });
    builder.text(leftX + nodeWidth + 7, y + 4, label, 10, 'start', 600, 'text', builder.width * 0.27);
  });
  targets.forEach((label, index) => {
    const y = yFor(index, targets.length);
    builder.add({ type: 'rect', x: rightX, y: y - 17, width: nodeWidth, height: 34, radius: 3, fill: `palette${(index + sources.length) % 6}` as 'palette0' });
    builder.text(rightX - 7, y + 4, label, 10, 'end', 600, 'text', builder.width * 0.27);
  });
  return builder.finish(parsed, top + height + 24);
}

function renderTreemap(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const values = parsed.body.map(parseLabelValue).filter((value): value is { label: string; value: number } => value !== null && value.value > 0);
  if (values.length === 0) {
    builder.warn('Treemap contains no positive label:value leaves', 1);
    return builder.finish(parsed, titleBottom + 80);
  }
  const total = values.reduce((sum, value) => sum + value.value, 0);
  const x = 20;
  const y = titleBottom + 20;
  const width = builder.width - 40;
  const height = 300;
  let offset = 0;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    const itemWidth = index === values.length - 1 ? width - offset : width * value.value / total;
    builder.add({ type: 'rect', x: x + offset, y, width: itemWidth, height, fill: `palette${index % 6}` as 'palette0', opacity: 0.72, stroke: 'background', strokeWidth: 2 });
    if (itemWidth > 34) {
      builder.text(x + offset + itemWidth / 2, y + height / 2, `${value.label} ${value.value}`, 11, 'middle', 700, 'background', itemWidth - 10);
    }
    offset += itemWidth;
  }
  return builder.finish(parsed, y + height + 24);
}

function renderVenn(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const sets: string[] = [];
  for (const line of parsed.body) {
    const lower = line.trimmed.toLowerCase();
    if (lower.startsWith('set ')) {
      const rest = line.trimmed.slice(4).trim();
      const id = firstIdentifier(rest);
      const label = cleanLabel(rest.slice(id.length)) || id;
      if (label) sets.push(label);
    }
  }
  if (sets.length === 0) {
    for (const line of parsed.body) {
      const label = cleanLabel(line.trimmed);
      if (label && !label.toLowerCase().startsWith('union ')) sets.push(label);
      if (sets.length >= 3) break;
    }
  }
  const count = clamp(sets.length, 1, 3);
  const radius = clamp(builder.width * 0.2, 65, 125);
  const cx = builder.width / 2;
  const cy = titleBottom + radius + 38;
  const centers = count === 1
    ? [{ x: cx, y: cy }]
    : count === 2
      ? [{ x: cx - radius * 0.48, y: cy }, { x: cx + radius * 0.48, y: cy }]
      : [{ x: cx - radius * 0.48, y: cy - radius * 0.18 }, { x: cx + radius * 0.48, y: cy - radius * 0.18 }, { x: cx, y: cy + radius * 0.48 }];
  centers.forEach((center, index) => {
    builder.add({ type: 'ellipse', cx: center.x, cy: center.y, rx: radius, ry: radius * 0.82, fill: `palette${index % 6}` as 'palette0', stroke: `palette${index % 6}` as 'palette0', strokeWidth: 1.6, opacity: 0.22 });
    builder.text(center.x, center.y - radius * 0.55, sets[index] ?? `Set ${index + 1}`, 12, 'middle', 700, 'text', radius * 1.3);
  });
  if (sets.length === 0) builder.warn('Venn diagram contains no sets', 1);
  return builder.finish(parsed, cy + radius * 1.35);
}

interface TreeEntry {
  readonly id: string;
  readonly label: string;
  readonly depth: number;
  readonly parent?: string;
  readonly line: number;
}

function renderTree(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const entries: TreeEntry[] = [];
  const parents: Array<TreeEntry | undefined> = [];
  for (const line of parsed.body) {
    const label = cleanLabel(line.trimmed.replace(/^[-+*]\s*/u, ''));
    if (!label) continue;
    const depth = Math.max(0, Math.floor(line.indent / 2));
    const parent = parents[depth - 1];
    const entry: TreeEntry = {
      id: `tree_${entries.length}`,
      label,
      depth,
      ...(parent ? { parent: parent.id } : {}),
      line: line.line,
    };
    entries.push(entry);
    parents[depth] = entry;
    parents.length = depth + 1;
  }
  if (entries.length === 0) {
    builder.warn('The tree diagram contains no nodes', 1);
    return builder.finish(parsed, titleBottom + 70);
  }
  const maxDepth = Math.max(...entries.map((entry) => entry.depth));
  const xGap = (builder.width - 70) / Math.max(1, maxDepth + 1);
  const yGap = 56;
  const positions = new Map<string, { x: number; y: number }>();
  entries.forEach((entry, index) => positions.set(entry.id, { x: 38 + entry.depth * xGap, y: titleBottom + 28 + index * yGap }));
  for (const entry of entries) {
    const position = positions.get(entry.id)!;
    const parent = entry.parent ? positions.get(entry.parent) : undefined;
    if (parent) builder.add({ type: 'polyline', points: [{ x: parent.x + 55, y: parent.y }, { x: position.x - 55, y: position.y }], fill: 'none', stroke: 'border', strokeWidth: 1.3, markerEnd: true });
  }
  entries.forEach((entry, index) => {
    const position = positions.get(entry.id)!;
    builder.add({ type: 'rect', x: position.x - 50, y: position.y - 19, width: 100, height: 38, radius: entry.depth === 0 ? 19 : 8, fill: 'surface', stroke: `palette${entry.depth % 6}` as 'palette0', strokeWidth: 1.4 });
    builder.text(position.x, position.y + 4, entry.label, 11, 'middle', entry.depth === 0 ? 700 : 500, 'text', 90);
    if (index > 4000) return;
  });
  return builder.finish(parsed, titleBottom + entries.length * yGap + 28);
}

function renderPacket(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const fields: Array<{ start: number; end: number; label: string; line: number }> = [];
  for (const line of parsed.body) {
    const colon = line.trimmed.indexOf(':');
    if (colon <= 0) continue;
    const range = line.trimmed.slice(0, colon).trim().split('-').map(finiteNumber);
    if (range[0] === null) continue;
    const start = Math.max(0, Math.floor(range[0]));
    const end = Math.max(start, Math.floor(range[1] ?? start));
    fields.push({ start, end, label: cleanLabel(line.trimmed.slice(colon + 1)), line: line.line });
  }
  if (fields.length === 0) {
    builder.warn('Packet diagram contains no bit ranges', 1);
    return builder.finish(parsed, titleBottom + 80);
  }
  const left = 22;
  const width = builder.width - 44;
  const rowHeight = 62;
  const bitsPerRow = 32;
  const rows = Math.floor(Math.max(...fields.map((field) => field.end)) / bitsPerRow) + 1;
  const top = titleBottom + 28;
  for (const field of fields) {
    let bit = field.start;
    while (bit <= field.end) {
      const row = Math.floor(bit / bitsPerRow);
      const rowEnd = Math.min(field.end, (row + 1) * bitsPerRow - 1);
      const localStart = bit % bitsPerRow;
      const localEnd = rowEnd % bitsPerRow;
      const x = left + localStart / bitsPerRow * width;
      const fieldWidth = (localEnd - localStart + 1) / bitsPerRow * width;
      const y = top + row * rowHeight;
      builder.add({ type: 'rect', x, y, width: fieldWidth, height: rowHeight - 8, fill: `palette${fields.indexOf(field) % 6}` as 'palette0', opacity: 0.16, stroke: 'border', strokeWidth: 1 });
      builder.text(x + fieldWidth / 2, y + 23, field.label, 10, 'middle', 600, 'text', fieldWidth - 6);
      builder.text(x + 3, y + 49, `${bit}-${rowEnd}`, 8, 'start', 400, 'muted');
      bit = rowEnd + 1;
    }
  }
  return builder.finish(parsed, top + rows * rowHeight + 18);
}

function renderWardley(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const plot = { x: 64, y: titleBottom + 26, width: builder.width - 92, height: 310 };
  builder.add({ type: 'line', x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.height, stroke: 'border', strokeWidth: 1.2 });
  builder.add({ type: 'line', x1: plot.x, y1: plot.y + plot.height, x2: plot.x + plot.width, y2: plot.y + plot.height, stroke: 'border', strokeWidth: 1.2 });
  builder.text(plot.x - 10, plot.y + 4, 'Visible', 10, 'end', 500, 'muted');
  builder.text(plot.x - 10, plot.y + plot.height, 'Invisible', 10, 'end', 500, 'muted');
  builder.text(plot.x, plot.y + plot.height + 18, 'Genesis', 10, 'start', 500, 'muted');
  builder.text(plot.x + plot.width, plot.y + plot.height + 18, 'Commodity', 10, 'end', 500, 'muted');
  let found = 0;
  for (const line of parsed.body) {
    const lower = line.trimmed.toLowerCase();
    if (!lower.startsWith('component ')) continue;
    const values = numberArray(line.trimmed);
    const bracket = line.trimmed.lastIndexOf('[');
    const label = cleanLabel(line.trimmed.slice(10, bracket >= 0 ? bracket : undefined));
    if (values.length < 2) continue;
    const x = plot.x + clamp(values[1], 0, 1) * plot.width;
    const y = plot.y + (1 - clamp(values[0], 0, 1)) * plot.height;
    builder.add({ type: 'ellipse', cx: x, cy: y, rx: 5, ry: 5, fill: `palette${found % 6}` as 'palette0' });
    builder.text(x + 8, y + 3, label, 10, 'start', 600, 'text', 120);
    found++;
  }
  if (found === 0) builder.warn('Wardley map contains no component [visibility, evolution] positions', 1);
  return builder.finish(parsed, plot.y + plot.height + 42);
}

function renderCynefin(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const x = 24;
  const y = titleBottom + 22;
  const width = builder.width - 48;
  const height = 300;
  const labels = ['Complex', 'Complicated', 'Chaotic', 'Clear'];
  const items = parsed.body.map((line) => cleanLabel(line.trimmed)).filter(Boolean);
  for (let index = 0; index < 4; index++) {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const cellX = x + col * width / 2;
    const cellY = y + row * height / 2;
    builder.add({ type: 'rect', x: cellX, y: cellY, width: width / 2, height: height / 2, fill: `palette${index}` as 'palette0', opacity: 0.1, stroke: 'border', strokeWidth: 1 });
    builder.text(cellX + width / 4, cellY + 27, labels[index], 14, 'middle', 700, 'text');
    const item = items[index];
    if (item) builder.text(cellX + width / 4, cellY + 72, item, 11, 'middle', 500, 'muted', width / 2 - 24);
  }
  builder.add({ type: 'ellipse', cx: x + width / 2, cy: y + height / 2, rx: 42, ry: 25, fill: 'surface', stroke: 'border', strokeWidth: 1.2 });
  builder.text(x + width / 2, y + height / 2 + 4, 'Confusion', 10, 'middle', 700, 'text');
  return builder.finish(parsed, y + height + 24);
}

function renderRailroad(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const rules = parsed.body.filter((line) => line.trimmed.includes('::=') || line.trimmed.includes('=') || line.trimmed.includes('<-'));
  if (rules.length === 0) {
    builder.warn('Railroad diagram contains no grammar rules', 1);
    return builder.finish(parsed, titleBottom + 80);
  }
  const left = 28;
  const rowHeight = 76;
  for (let row = 0; row < rules.length; row++) {
    const line = rules[row];
    const separator = line.trimmed.includes('::=') ? '::=' : line.trimmed.includes('<-') ? '<-' : '=';
    const at = line.trimmed.indexOf(separator);
    const name = cleanLabel(line.trimmed.slice(0, at));
    const terms = line.trimmed.slice(at + separator.length).split(/\s+/u).filter(Boolean).slice(0, 8);
    const y = titleBottom + 30 + row * rowHeight;
    builder.text(left, y + 6, name, 11, 'start', 700, 'text', 100);
    let x = left + 110;
    builder.add({ type: 'ellipse', cx: x, cy: y, rx: 5, ry: 5, fill: 'accent' });
    for (let index = 0; index < terms.length; index++) {
      const term = cleanLabel(terms[index]);
      const width = clamp(builder.measure(term, 10, 500) + 18, 38, 105);
      builder.add({ type: 'line', x1: x + 5, y1: y, x2: x + 18, y2: y, stroke: 'border', strokeWidth: 1.2, markerEnd: true });
      x += 18;
      builder.add({ type: 'rect', x, y: y - 17, width, height: 34, radius: term.startsWith('"') ? 16 : 5, fill: index % 2 ? 'surfaceAlt' : 'surface', stroke: `palette${index % 6}` as 'palette0', strokeWidth: 1 });
      builder.text(x + width / 2, y + 4, term, 10, 'middle', 500, 'text', width - 8);
      x += width;
      if (x > builder.width - 60) break;
    }
    builder.add({ type: 'line', x1: x, y1: y, x2: Math.min(builder.width - 30, x + 24), y2: y, stroke: 'border', strokeWidth: 1.2, markerEnd: true });
  }
  return builder.finish(parsed, titleBottom + rules.length * rowHeight + 20);
}

function renderGenericCards(parsed: ParsedDiagram, builder: SceneBuilder): DiagramScene {
  const titleBottom = addTitle(builder, parsed);
  const lines = parsed.body.filter((line) => line.trimmed && line.trimmed.toLowerCase() !== 'end');
  const columns = builder.width >= 600 ? 2 : 1;
  const gap = 14;
  const cardWidth = (builder.width - 36 - gap * (columns - 1)) / columns;
  const cardHeight = 58;
  for (let index = 0; index < lines.length; index++) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = 18 + col * (cardWidth + gap);
    const y = titleBottom + 20 + row * (cardHeight + 12);
    builder.add({ type: 'rect', x, y, width: cardWidth, height: cardHeight, radius: 9, fill: index % 2 ? 'surfaceAlt' : 'surface', stroke: `palette${index % 6}` as 'palette0', strokeWidth: 1.1 });
    builder.text(x + 12, y + 25, cleanLabel(lines[index].trimmed), 11, 'start', 500, 'text', cardWidth - 24);
  }
  if (lines.length === 0) builder.warn('The diagram contains no renderable statements', 1);
  return builder.finish(parsed, titleBottom + Math.ceil(Math.max(1, lines.length) / columns) * (cardHeight + 12) + 18);
}

export function buildDiagramScene(parsed: ParsedDiagram, options: DiagramRenderOptions = {}): DiagramScene {
  const builder = new SceneBuilder(parsed, options);
  switch (parsed.kind) {
    case 'sequence':
    case 'zenuml':
      return renderSequence(parsed, builder);
    case 'journey':
    case 'gantt':
    case 'timeline':
    case 'gitGraph':
    case 'kanban':
    case 'swimlanes':
      return renderLanes(parsed, builder);
    case 'pie':
      return renderPie(parsed, builder);
    case 'quadrant':
      return renderQuadrant(parsed, builder);
    case 'xychart':
      return renderXY(parsed, builder);
    case 'radar':
      return renderRadar(parsed, builder);
    case 'sankey':
      return renderSankey(parsed, builder);
    case 'treemap':
      return renderTreemap(parsed, builder);
    case 'venn':
      return renderVenn(parsed, builder);
    case 'mindmap':
    case 'treeView':
    case 'ishikawa':
      return renderTree(parsed, builder);
    case 'packet':
      return renderPacket(parsed, builder);
    case 'wardley':
      return renderWardley(parsed, builder);
    case 'cynefin':
      return renderCynefin(parsed, builder);
    case 'railroad':
      return renderRailroad(parsed, builder);
    case 'eventModeling':
      return renderGenericCards(parsed, builder);
    case 'flowchart':
    case 'class':
    case 'state':
    case 'er':
    case 'requirement':
    case 'c4':
    case 'block':
    case 'architecture':
      return renderGraph(parsed, builder);
  }
}

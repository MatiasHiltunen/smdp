import { DiagramRuntimeError, hashDiagramToken, scanDiagramSource } from './runtime';
import type {
  DiagramDiagnostic,
  DiagramKind,
  DiagramRenderOptions,
} from './types';

const DECODER = new TextDecoder('utf-8');
const DEFAULT_MAX_SOURCE_BYTES = 1024 * 1024;
const DEFAULT_MAX_LINES = 16_384;

type Declaration = {
  readonly kind: DiagramKind;
  readonly canonical: string;
};

const DECLARATIONS: readonly Declaration[] = [
  { kind: 'flowchart', canonical: 'flowchart' },
  { kind: 'flowchart', canonical: 'graph' },
  { kind: 'swimlanes', canonical: 'swimlanes-beta' },
  { kind: 'swimlanes', canonical: 'swimlanes' },
  { kind: 'sequence', canonical: 'sequencediagram' },
  { kind: 'class', canonical: 'classdiagram' },
  { kind: 'state', canonical: 'statediagram-v2' },
  { kind: 'state', canonical: 'statediagram' },
  { kind: 'er', canonical: 'erdiagram' },
  { kind: 'journey', canonical: 'journey' },
  { kind: 'gantt', canonical: 'gantt' },
  { kind: 'pie', canonical: 'pie' },
  { kind: 'quadrant', canonical: 'quadrantchart' },
  { kind: 'requirement', canonical: 'requirementdiagram' },
  { kind: 'gitGraph', canonical: 'gitgraph' },
  { kind: 'c4', canonical: 'c4context' },
  { kind: 'c4', canonical: 'c4container' },
  { kind: 'c4', canonical: 'c4component' },
  { kind: 'c4', canonical: 'c4dynamic' },
  { kind: 'c4', canonical: 'c4deployment' },
  { kind: 'mindmap', canonical: 'mindmap' },
  { kind: 'timeline', canonical: 'timeline' },
  { kind: 'zenuml', canonical: 'zenuml' },
  { kind: 'sankey', canonical: 'sankey-beta' },
  { kind: 'sankey', canonical: 'sankey' },
  { kind: 'xychart', canonical: 'xychart-beta' },
  { kind: 'xychart', canonical: 'xychart' },
  { kind: 'block', canonical: 'block-beta' },
  { kind: 'block', canonical: 'block' },
  { kind: 'packet', canonical: 'packet-beta' },
  { kind: 'packet', canonical: 'packet' },
  { kind: 'kanban', canonical: 'kanban' },
  { kind: 'architecture', canonical: 'architecture-beta' },
  { kind: 'architecture', canonical: 'architecture' },
  { kind: 'radar', canonical: 'radar-beta' },
  { kind: 'radar', canonical: 'radar' },
  { kind: 'eventModeling', canonical: 'eventmodeling' },
  { kind: 'treemap', canonical: 'treemap-beta' },
  { kind: 'treemap', canonical: 'treemap' },
  { kind: 'venn', canonical: 'venn-beta' },
  { kind: 'venn', canonical: 'venn' },
  { kind: 'ishikawa', canonical: 'ishikawa-beta' },
  { kind: 'ishikawa', canonical: 'ishikawa' },
  { kind: 'wardley', canonical: 'wardley' },
  { kind: 'cynefin', canonical: 'cynefin-beta' },
  { kind: 'cynefin', canonical: 'cynefin' },
  { kind: 'treeView', canonical: 'treeview-beta' },
  { kind: 'treeView', canonical: 'treeview' },
  { kind: 'railroad', canonical: 'railroad' },
  { kind: 'railroad', canonical: 'abnf' },
  { kind: 'railroad', canonical: 'ebnf' },
  { kind: 'railroad', canonical: 'peg' },
] as const;

const DECLARATIONS_BY_HASH = new Map<number, readonly Declaration[]>();
for (const declaration of DECLARATIONS) {
  const hash = hashDiagramToken(declaration.canonical);
  const current = DECLARATIONS_BY_HASH.get(hash) ?? [];
  DECLARATIONS_BY_HASH.set(hash, [...current, declaration]);
}

export interface ParsedDiagramLine {
  readonly text: string;
  readonly trimmed: string;
  readonly indent: number;
  readonly flags: number;
  readonly firstTokenHash: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly line: number;
}

export interface ParsedDiagram {
  readonly kind: DiagramKind;
  readonly declaration: string;
  readonly direction: 'TB' | 'BT' | 'LR' | 'RL';
  readonly title: string;
  readonly description: string;
  readonly body: readonly ParsedDiagramLine[];
  readonly diagnostics: readonly DiagramDiagnostic[];
  readonly seed: number;
}

function firstToken(value: string): string {
  const trimmed = value.trimStart();
  let end = 0;
  while (end < trimmed.length) {
    const code = trimmed.charCodeAt(end);
    if (code === 0x20 || code === 0x09 || code === 0x3a) break;
    end++;
  }
  return trimmed.slice(0, end).toLowerCase();
}

function splitKeyValue(value: string): readonly [string, string] | null {
  const colon = value.indexOf(':');
  if (colon <= 0) return null;
  return [value.slice(0, colon).trim().toLowerCase(), value.slice(colon + 1).trim()];
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function normalizedDirection(value: string): 'TB' | 'BT' | 'LR' | 'RL' | null {
  const token = firstToken(value).toUpperCase();
  if (token === 'TD') return 'TB';
  if (token === 'TB' || token === 'BT' || token === 'LR' || token === 'RL') return token;
  return null;
}

function defaultDirection(kind: DiagramKind): 'TB' | 'BT' | 'LR' | 'RL' {
  if (
    kind === 'sequence' ||
    kind === 'timeline' ||
    kind === 'gantt' ||
    kind === 'journey' ||
    kind === 'gitGraph' ||
    kind === 'sankey' ||
    kind === 'xychart' ||
    kind === 'packet' ||
    kind === 'wardley' ||
    kind === 'railroad'
  ) {
    return 'LR';
  }
  return 'TB';
}

function titleForKind(kind: DiagramKind): string {
  const labels: Record<DiagramKind, string> = {
    flowchart: 'Flowchart',
    swimlanes: 'Swimlanes diagram',
    sequence: 'Sequence diagram',
    class: 'Class diagram',
    state: 'State diagram',
    er: 'Entity relationship diagram',
    journey: 'User journey',
    gantt: 'Gantt chart',
    pie: 'Pie chart',
    quadrant: 'Quadrant chart',
    requirement: 'Requirement diagram',
    gitGraph: 'Git graph',
    c4: 'C4 diagram',
    mindmap: 'Mind map',
    timeline: 'Timeline',
    zenuml: 'ZenUML diagram',
    sankey: 'Sankey diagram',
    xychart: 'XY chart',
    block: 'Block diagram',
    packet: 'Packet diagram',
    kanban: 'Kanban board',
    architecture: 'Architecture diagram',
    radar: 'Radar chart',
    eventModeling: 'Event modeling diagram',
    treemap: 'Treemap',
    venn: 'Venn diagram',
    ishikawa: 'Ishikawa diagram',
    wardley: 'Wardley map',
    cynefin: 'Cynefin diagram',
    treeView: 'Tree view',
    railroad: 'Railroad diagram',
  };
  return labels[kind];
}

function unsafeReason(value: string): string | null {
  const lower = value.toLowerCase();
  if (lower.includes('javascript:')) return 'javascript URLs are not permitted';
  if (lower.includes('<script') || lower.includes('<foreignobject')) {
    return 'active or arbitrary HTML is not permitted';
  }
  if (lower.startsWith('callback ') || (lower.startsWith('click ') && lower.includes(' call '))) {
    return 'callbacks are not permitted';
  }
  return null;
}

function detectDeclaration(line: ParsedDiagramLine): Declaration | null {
  const candidates = DECLARATIONS_BY_HASH.get(line.firstTokenHash);
  if (!candidates) return null;
  const token = firstToken(line.trimmed);
  return candidates.find((candidate) => candidate.canonical === token) ?? null;
}

export function parseDiagramSource(
  source: Uint8Array,
  options: DiagramRenderOptions = {},
): ParsedDiagram | { readonly diagnostics: readonly DiagramDiagnostic[] } {
  const maxSourceBytes = options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  if (source.byteLength > maxSourceBytes) {
    return {
      diagnostics: [{
        severity: 'error',
        message: `Diagram source exceeds the ${maxSourceBytes}-byte limit`,
        line: 1,
        column: 1,
      }],
    };
  }

  let records;
  try {
    records = scanDiagramSource(source, maxLines);
  } catch (error) {
    return {
      diagnostics: [{
        severity: 'error',
        message: error instanceof DiagramRuntimeError ? error.message : 'Diagram parsing failed',
        line: 1,
        column: 1,
      }],
    };
  }

  const lines: ParsedDiagramLine[] = records.map((record, index) => {
    const text = DECODER.decode(source.subarray(record.start, record.end));
    return {
      text,
      trimmed: text.trim(),
      indent: record.indent,
      flags: record.flags,
      firstTokenHash: record.firstTokenHash,
      sourceStart: record.start,
      sourceEnd: record.end,
      line: index + 1,
    };
  });

  const diagnostics: DiagramDiagnostic[] = [];
  const body: ParsedDiagramLine[] = [];
  let title = '';
  let description = '';
  let declaration: Declaration | null = null;
  let declarationText = '';
  let direction: 'TB' | 'BT' | 'LR' | 'RL' | null = null;
  let inFrontmatter = false;
  let frontmatterSeen = false;

  for (const line of lines) {
    if (line.text.includes('\uFFFD')) {
      diagnostics.push({
        severity: 'warning',
        message: 'Invalid UTF-8 was replaced while reading this line',
        line: line.line,
        column: 1,
      });
    }

    if (!declaration && line.trimmed === '---' && (!frontmatterSeen || inFrontmatter)) {
      inFrontmatter = !inFrontmatter;
      frontmatterSeen = true;
      continue;
    }
    if (inFrontmatter) {
      const pair = splitKeyValue(line.trimmed);
      if (pair?.[0] === 'title') title = unquote(pair[1]);
      if (pair?.[0] === 'direction') direction = normalizedDirection(pair[1]) ?? direction;
      continue;
    }

    if (!line.trimmed || line.trimmed.startsWith('%%')) continue;

    if (!declaration) {
      declaration = detectDeclaration(line);
      if (!declaration) {
        return {
          diagnostics: [{
            severity: 'error',
            message: `Unknown Mermaid 11.17.2 diagram declaration: ${firstToken(line.trimmed) || '(empty)'}`,
            line: line.line,
            column: 1,
          }],
        };
      }
      declarationText = line.trimmed;
      const declarationTail = line.trimmed.slice(firstToken(line.trimmed).length).trim();
      direction = normalizedDirection(declarationTail) ?? direction;
      continue;
    }

    const reason = unsafeReason(line.trimmed);
    if (reason) {
      diagnostics.push({
        severity: 'error',
        message: reason,
        line: line.line,
        column: 1,
      });
      continue;
    }

    const pair = splitKeyValue(line.trimmed);
    if (pair?.[0] === 'title') {
      title = unquote(pair[1]);
      continue;
    }
    if (pair?.[0] === 'acctitle') {
      if (!title) title = unquote(pair[1]);
      continue;
    }
    if (pair?.[0] === 'accdescr') {
      description = unquote(pair[1]);
      continue;
    }
    if (pair?.[0] === 'direction') {
      direction = normalizedDirection(pair[1]) ?? direction;
      continue;
    }
    body.push(line);
  }

  if (!declaration) {
    return {
      diagnostics: [{
        severity: 'error',
        message: 'The Mermaid block does not contain a diagram declaration',
        line: 1,
        column: 1,
      }],
    };
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { diagnostics };
  }

  return {
    kind: declaration.kind,
    declaration: declarationText,
    direction: direction ?? defaultDirection(declaration.kind),
    title: title || titleForKind(declaration.kind),
    description,
    body,
    diagnostics,
    seed: options.seed ?? 0x5d4d_5031,
  };
}

export const MERMAID_COMPATIBILITY_VERSION = '11.17.2' as const;

export type DiagramKind =
  | 'flowchart'
  | 'swimlanes'
  | 'sequence'
  | 'class'
  | 'state'
  | 'er'
  | 'journey'
  | 'gantt'
  | 'pie'
  | 'quadrant'
  | 'requirement'
  | 'gitGraph'
  | 'c4'
  | 'mindmap'
  | 'timeline'
  | 'zenuml'
  | 'sankey'
  | 'xychart'
  | 'block'
  | 'packet'
  | 'kanban'
  | 'architecture'
  | 'radar'
  | 'eventModeling'
  | 'treemap'
  | 'venn'
  | 'ishikawa'
  | 'wardley'
  | 'cynefin'
  | 'treeView'
  | 'railroad';

export type DiagramDiagnosticSeverity = 'warning' | 'error';

export interface DiagramDiagnostic {
  readonly severity: DiagramDiagnosticSeverity;
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

export type DiagramPaint =
  | 'none'
  | 'background'
  | 'surface'
  | 'surfaceAlt'
  | 'text'
  | 'muted'
  | 'accent'
  | 'border'
  | 'success'
  | 'warning'
  | 'danger'
  | 'palette0'
  | 'palette1'
  | 'palette2'
  | 'palette3'
  | 'palette4'
  | 'palette5';

export interface DiagramPoint {
  readonly x: number;
  readonly y: number;
}

interface DiagramPaintStyle {
  readonly fill?: DiagramPaint;
  readonly stroke?: DiagramPaint;
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly dash?: readonly number[];
}

export type DiagramSceneCommand =
  | ({
      readonly type: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly radius?: number;
    } & DiagramPaintStyle)
  | ({
      readonly type: 'line';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly markerEnd?: boolean;
    } & DiagramPaintStyle)
  | ({
      readonly type: 'polyline' | 'polygon';
      readonly points: readonly DiagramPoint[];
      readonly markerEnd?: boolean;
    } & DiagramPaintStyle)
  | ({
      readonly type: 'ellipse';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
    } & DiagramPaintStyle)
  | {
      readonly type: 'text';
      readonly x: number;
      readonly y: number;
      readonly text: string;
      readonly size: number;
      readonly color: DiagramPaint;
      readonly anchor?: 'start' | 'middle' | 'end';
      readonly weight?: 400 | 500 | 600 | 700;
      readonly italic?: boolean;
      readonly maxWidth?: number;
    };

export interface DiagramScene {
  readonly abiVersion: 1;
  readonly compatibilityVersion: typeof MERMAID_COMPATIBILITY_VERSION;
  readonly kind: DiagramKind;
  readonly direction: 'TB' | 'BT' | 'LR' | 'RL';
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly description: string;
  readonly commands: readonly DiagramSceneCommand[];
  readonly diagnostics: readonly DiagramDiagnostic[];
  readonly usesSimd: true;
}

export interface DiagramTheme {
  readonly background: string;
  readonly surface: string;
  readonly surfaceAlt: string;
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  readonly border: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  readonly palette: readonly [string, string, string, string, string, string];
}

export type DiagramTextMeasure = (
  text: string,
  size: number,
  weight: 400 | 500 | 600 | 700,
) => number;

export interface DiagramRenderOptions {
  readonly width?: number;
  readonly theme?: Partial<DiagramTheme>;
  readonly measureText?: DiagramTextMeasure;
  readonly maxSourceBytes?: number;
  readonly maxLines?: number;
  readonly maxCommands?: number;
  readonly seed?: number;
}

export interface DiagramRenderResult {
  readonly scene?: DiagramScene;
  readonly diagnostics: readonly DiagramDiagnostic[];
}

/**
 * Type definitions for the Markdown parser
 */

export interface LineSpan {
  start: number;
  end: number;
}

export interface FenceInfo {
  ch: number;
  len: number;
}

export interface ListMarker {
  type: 'ul' | 'ol';
  indent: number;
  afterStart: number;
  afterEnd: number;
}

export interface UrlScan {
  hrefStart: number;
  hrefEnd: number;
}

// Inline token types
export type InlineToken =
  | { kind: 'text'; s: number; e: number }
  | { kind: 'code'; s: number; e: number }
  | { kind: 'img'; altS: number; altE: number; srcS: number; srcE: number }
  | { kind: 'link'; hrefS: number; hrefE: number; textS: number; textE: number }
  | { kind: 'autolink'; s: number; e: number; isWww: boolean }
  | { kind: 'emOpen' }
  | { kind: 'emClose' }
  | { kind: 'strongOpen' }
  | { kind: 'strongClose' };

// Block event types
export type BlockEvent =
  | { type: 'bqOpen' }
  | { type: 'bqClose' }
  | { type: 'hr' }
  | { type: 'heading'; level: number; s: number; e: number }
  | { type: 'listOpen'; kind: 'ul' | 'ol'; indent: number }
  | { type: 'listItem'; s: number; e: number }
  | { type: 'listClose'; kind: 'ul' | 'ol' }
  | { type: 'paraLine'; s: number; e: number }
  | { type: 'codeOpen' }
  | { type: 'codeText'; s: number; e: number }
  | { type: 'codeClose' };

export interface BlockState {
  bqLevel: number;
  listStack: Array<{ kind: 'ul' | 'ol'; indent: number }>;
  inFence: boolean;
  fenceCh: number;
  fenceLen: number;
}

export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: boolean;
  color?: string;
  size?: number;
}

export interface TextSpan {
  text: string;
  style: TextStyle;
}

export interface DrawResult {
  x: number;
  y: number;
}

export interface ListStackItem {
  kind: 'ul' | 'ol';
  liOpen: boolean;
}

export interface CanvasListItem {
  kind: 'ul' | 'ol';
  counter: number;
}

export interface CodeBlockInfo {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlockquoteInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  indent: number;
}

export interface RenderSegment {
  startY: number;
  endY: number;
  commands: CanvasCommand[];
}

export type CanvasCommand =
  | { type: 'text'; text: string; x: number; y: number; font: string; fill: string; baseline: CanvasTextBaseline }
  | { type: 'linkUnderline'; x1: number; y: number; x2: number; stroke: string; width: number }
  | { type: 'fillRect'; x: number; y: number; w: number; h: number; color: string }
  | { type: 'roundedRect'; x: number; y: number; w: number; h: number; radius: number; color: string }
  | { type: 'bullet'; x: number; y: number; radius: number; color: string };

export interface RenderChunkMetadata {
  totalHeight: number;
  codeBlocks: CodeBlockInfo[];
  blockquotes: BlockquoteInfo[];
  segments: RenderSegment[];
}


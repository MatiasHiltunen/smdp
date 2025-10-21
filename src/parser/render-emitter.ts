import type { BlockEvent, CanvasCommand, InlineToken } from "./types";

export interface RenderEmitter {
  onBlock(event: BlockEvent): void;
  onInline(tokens: Iterable<InlineToken>): void;
  onCanvasCommand?(command: CanvasCommand): void;
  onHighlightToken?(info: {
    lang?: string;
    type: number;
    text: string;
    line: number;
  }): void;
  finalize(): void;
}

export class BaseRenderEmitter implements RenderEmitter {
  onBlock(_event: BlockEvent): void {}
  onInline(_tokens: Iterable<InlineToken>): void {}
  onCanvasCommand(_command: CanvasCommand): void {}
  onHighlightToken(_info: {
    lang?: string;
    type: number;
    text: string;
    line: number;
  }): void {}
  finalize(): void {}
}

export class CollectingRenderEmitter extends BaseRenderEmitter {
  readonly blocks: BlockEvent[] = [];
  readonly inline: InlineToken[][] = [];
  readonly canvas: CanvasCommand[] = [];
  readonly highlight: Array<{
    lang?: string;
    type: number;
    text: string;
    line: number;
  }> = [];

  override onBlock(event: BlockEvent): void {
    this.blocks.push(event);
  }

  override onInline(tokens: Iterable<InlineToken>): void {
    this.inline.push(Array.from(tokens));
  }

  override onCanvasCommand(command: CanvasCommand): void {
    this.canvas.push(command);
  }

  override onHighlightToken(info: {
    lang?: string;
    type: number;
    text: string;
    line: number;
  }): void {
    this.highlight.push(info);
  }
}

export class RenderBus {
  private readonly emitter: RenderEmitter | null | undefined;
  
  constructor(emitter?: RenderEmitter | null) {
    this.emitter = emitter;
  }

  emitBlock(ev: BlockEvent): void {
    this.emitter?.onBlock(ev);
  }

  emitInline(tokens: Iterable<InlineToken>): void {
    this.emitter?.onInline(tokens);
  }

  emitCanvas(command: CanvasCommand): void {
    this.emitter?.onCanvasCommand?.(command);
  }

  emitHighlight(info: {
    lang?: string;
    type: number;
    text: string;
    line: number;
  }): void {
    this.emitter?.onHighlightToken?.(info);
  }

  finalize(): void {
    this.emitter?.finalize();
  }
}

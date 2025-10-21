import type { ParserOptions } from "../parser/index";
import type { RenderEmitter } from "../parser/render-emitter";
import { BaseRenderEmitter, RenderBus } from "../parser/render-emitter";
import { renderHTMLFromBlocks } from "../parser/html-renderer";
import { renderToCanvasFromBlocks } from "../parser/canvas-renderer";
import { ChunkBuffer } from "./chunk-buffer";
import type { Chunk } from "./types";

export interface StreamHTMLTarget {
  onHTML?: (html: string) => void;
  emitter?: RenderEmitter;
  options?: ParserOptions;
}

export class StreamHTMLRenderer {
  private readonly buffer = new ChunkBuffer();
  private readonly target: StreamHTMLTarget;

  constructor(target: StreamHTMLTarget = {}) {
    this.target = target;
  }

  push(chunk: Chunk): void {
    this.buffer.append(chunk);
  }

  async finalize(): Promise<string> {
    const buffer = this.buffer.toUint8Array();
    const emitter = this.target.emitter ?? new BaseRenderEmitter();
    const bus = new RenderBus(emitter);
    const html = await renderHTMLFromBlocks(buffer, this.target.options ?? {}, emitter);
    this.target.onHTML?.(html);
    bus.finalize();
    return html;
  }
}

export interface StreamCanvasTarget {
  canvas: HTMLCanvasElement;
  emitter?: RenderEmitter;
  options?: ParserOptions;
}

export class StreamCanvasRenderer {
  private readonly buffer = new ChunkBuffer();
  private readonly target: StreamCanvasTarget;

  constructor(target: StreamCanvasTarget) {
    this.target = target;
  }

  push(chunk: Chunk): void {
    this.buffer.append(chunk);
  }

  async finalize(): Promise<void> {
    const buffer = this.buffer.toUint8Array();
    const emitter = this.target.emitter ?? new BaseRenderEmitter();
    const bus = new RenderBus(emitter);
    renderToCanvasFromBlocks(buffer, this.target.canvas, this.target.options ?? {}, emitter);
    bus.finalize();
  }
}

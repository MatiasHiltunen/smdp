import type { BlockEvent } from "./types";

export type RenderContext = {
  source: Uint8Array;
};

export type BlockVisitor = {
  finalize?(ctx: RenderContext): void | Promise<void>;
} & {
  [K in BlockEvent["type"]]?: (
    event: Extract<BlockEvent, { type: K }>,
    ctx: RenderContext,
  ) => void | Promise<void>;
};

export class RenderPipeline {
  constructor(private readonly visitors: BlockVisitor[]) {}

  async run(events: Iterable<BlockEvent>, ctx: RenderContext): Promise<void> {
    for (const event of events) {
      for (const visitor of this.visitors) {
        const handler = visitor[event.type as keyof BlockVisitor];
        if (typeof handler === "function") {
          await (handler as (ev: BlockEvent, context: RenderContext) => void | Promise<void>)(
            event as BlockEvent,
            ctx,
          );
        }
      }
    }

    for (const visitor of this.visitors) {
      if (visitor.finalize) {
        await visitor.finalize(ctx);
      }
    }
  }

  runSync(events: Iterable<BlockEvent>, ctx: RenderContext): void {
    for (const event of events) {
      for (const visitor of this.visitors) {
        const handler = visitor[event.type as keyof BlockVisitor];
        if (typeof handler === "function") {
          const result = (handler as (ev: BlockEvent, context: RenderContext) => void | Promise<void>)(
            event as BlockEvent,
            ctx,
          );
          if (isPromiseLike(result)) {
            throw new Error("RenderPipeline.runSync cannot await async handler results");
          }
        }
      }
    }

    for (const visitor of this.visitors) {
      if (visitor.finalize) {
        const result = visitor.finalize(ctx);
        if (isPromiseLike(result)) {
          throw new Error("RenderPipeline.runSync cannot await async finalize results");
        }
      }
    }
  }
}

export function createRenderPipeline(visitors: BlockVisitor[]): RenderPipeline {
  return new RenderPipeline(visitors);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && typeof (value as PromiseLike<unknown>).then === "function";
}

import type {
  BlockquoteInfo,
  CanvasCommand,
  CodeBlockInfo,
  RenderSegment,
} from "../parser/types";

export interface CanvasArena {
  codeBlocks: CodeBlockInfo[];
  blockquotes: BlockquoteInfo[];
  infoBlocks: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    type: string;
  }>;
  segments: RenderSegment[];
  commands: CanvasCommand[];
  reset(): void;
}

class CanvasArenaImpl implements CanvasArena {
  codeBlocks: CodeBlockInfo[] = [];
  blockquotes: BlockquoteInfo[] = [];
  infoBlocks: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    type: string;
  }> = [];
  segments: RenderSegment[] = [];
  commands: CanvasCommand[] = [];

  reset(): void {
    this.codeBlocks.length = 0;
    this.blockquotes.length = 0;
    this.infoBlocks.length = 0;
    this.segments.length = 0;
    this.commands.length = 0;
  }
}

const canvasArenaPool: CanvasArenaImpl[] = [];
const MAX_CANVAS_POOL = 4;

export function borrowCanvasArena(): CanvasArena {
  const arena = canvasArenaPool.pop() ?? new CanvasArenaImpl();
  arena.reset();
  return arena;
}

export function releaseCanvasArena(arena: CanvasArena): void {
  const impl = arena as CanvasArenaImpl;
  if (canvasArenaPool.length < MAX_CANVAS_POOL) {
    impl.reset();
    canvasArenaPool.push(impl);
  }
}

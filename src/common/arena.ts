import { HtmlArena } from "../parser/arena.ts";

export interface WritableArena {
  writeByte(b: number): void;
  writeBytes(bytes: Uint8Array): void;
  writeAscii(str: string): void;
  writeEscaped(bytes: Uint8Array, s: number, e: number): void;
  reserve(additionalCapacity: number): void;
  reset(): void;
  toUint8Array(): Uint8Array;
  length: number;
}

const htmlArenaPool: HtmlArena[] = [];
const MAX_POOL_SIZE = 8;

export function borrowHtmlArena(): HtmlArena {
  const arena = htmlArenaPool.pop() ?? new HtmlArena();
  arena.reset();
  return arena;
}

export function releaseHtmlArena(arena: HtmlArena): void {
  if (htmlArenaPool.length < MAX_POOL_SIZE) {
    arena.reset();
    htmlArenaPool.push(arena);
  }
}

export { HtmlArena } from "../parser/arena.ts";

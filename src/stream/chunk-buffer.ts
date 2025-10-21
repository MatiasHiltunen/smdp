import type { Chunk } from "./types";

export class ChunkBuffer {
  private chunks: Chunk[] = [];
  private total = 0;

  append(chunk: Chunk): void {
    if (!chunk.length) return;
    this.chunks.push(chunk);
    this.total += chunk.length;
  }

  clear(): void {
    this.chunks = [];
    this.total = 0;
  }

  get size(): number {
    return this.total;
  }

  toUint8Array(): Uint8Array {
    if (this.chunks.length === 1) {
      const [only] = this.chunks;
      const copy = new Uint8Array(only.length);
      copy.set(only);
      return copy;
    }
    const merged = new Uint8Array(this.total);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }
}

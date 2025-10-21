export type Chunk = Uint8Array;
export type AsyncChunkIterable = AsyncIterable<Chunk>;
export type Transform = (src: AsyncChunkIterable) => AsyncChunkIterable;

export interface PredictOptions {
  /** If HEAD/Range probing fails, fall back to this size. */
  fallback?: number;
  /** Try HEAD before Range probe. Default true. */
  tryHeadFirst?: boolean;
}

export interface FileSaveOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

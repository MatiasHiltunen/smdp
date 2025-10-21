import type { AsyncChunkIterable, Chunk, PredictOptions } from "./types";
import { composeTransforms } from "./utils";
import type { Transform } from "./types";

async function* fetchBytes(
  input: RequestInfo | URL,
  init?: RequestInit,
): AsyncGenerator<Chunk> {
  const res = await fetch(input, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error("ReadableStream not supported in this browser");
  }
  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

const parseContentRange = (cr: string | null): number | undefined => {
  if (!cr) return undefined;
  const match = /bytes \d+-\d+\/(\d+)/i.exec(cr);
  return match ? Number(match[1]) : undefined;
};

export async function predictContentSize(
  url: string | URL | Request,
  { fallback = 2 * 1024 * 1024, tryHeadFirst = true }: PredictOptions = {},
): Promise<number | undefined> {
  const toRequest =
    typeof url === "string" || url instanceof URL ? new Request(url) : url;

  if (tryHeadFirst) {
    try {
      const head = await fetch(new Request(toRequest, { method: "HEAD" }));
      if (head.ok) {
        const encoding = head.headers.get("Content-Encoding") || "identity";
        const len = head.headers.get("Content-Length");
        if (
          len &&
          (encoding === "identity" || encoding === "none") &&
          Number.isFinite(Number(len))
        ) {
          return Number(len);
        }
        const total = parseContentRange(head.headers.get("Content-Range"));
        if (Number.isFinite(total)) return total;
      }
    } catch {
      /* ignore */
    }
  }

  try {
    const probe = await fetch(
      new Request(toRequest, { headers: { Range: "bytes=0-0" } }),
    );
    if (probe.status === 206) {
      const total = parseContentRange(probe.headers.get("Content-Range"));
      if (Number.isFinite(total)) return total;
    }
  } catch {
    /* ignore */
  }

  return fallback;
}

export class StreamBuilder {
  private transforms: Transform[] = [];
  private abort: AbortSignal | undefined;
  private readonly sourceFactory: () => AsyncChunkIterable;

  private constructor(sourceFactory: () => AsyncChunkIterable) {
    this.sourceFactory = sourceFactory;
  }

  static fromFetch(input: RequestInfo | URL, init?: RequestInit): StreamBuilder {
    const factory = () => fetchBytes(input, init);
    return new StreamBuilder(factory);
  }

  static fromIterable(src: AsyncChunkIterable): StreamBuilder {
    return new StreamBuilder(() => src);
  }

  private clone(newFactory: () => AsyncChunkIterable): StreamBuilder {
    const builder = new StreamBuilder(newFactory);
    builder.transforms.push(...this.transforms);
    builder.abort = this.abort;
    return builder;
  }

  withAbort(signal: AbortSignal): StreamBuilder {
    const builder = this.clone(this.sourceFactory);
    builder.abort = signal;
    return builder;
  }

  through(transform: Transform): StreamBuilder {
    const builder = this.clone(this.sourceFactory);
    builder.transforms.push(transform);
    return builder;
  }

  build(): AsyncChunkIterable {
    const src = this.sourceFactory();
    const pipeline = composeTransforms(...this.transforms);
    return pipeline(src);
  }
}

import type { Chunk, Transform } from "./types";

export function pipe<T>(value: T, ...fns: Array<(x: T) => T>): T {
  return fns.reduce((acc, fn) => fn(acc), value);
}

export function composeTransforms(...ts: Transform[]): Transform {
  return (src) => ts.reduce((acc, t) => t(acc), src);
}

export function asAsyncIterable<T>(
  it: AsyncIterator<T> | AsyncIterable<T>,
): AsyncIterable<T> {
  if (Symbol.asyncIterator in Object(it)) {
    return it as AsyncIterable<T>;
  }
  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const n = await (it as AsyncIterator<T>).next();
        if (n.done) return;
        yield n.value;
      }
    },
  };
}

export const mapChunks = (
  fn: (c: Chunk) => Chunk | Promise<Chunk>,
): Transform =>
  (src) => ({
    async *[Symbol.asyncIterator]() {
      for await (const c of src) yield await fn(c);
    },
  });

export const tapChunks = (
  fn: (c: Chunk) => void | Promise<void>,
): Transform =>
  (src) => ({
    async *[Symbol.asyncIterator]() {
      for await (const c of src) {
        await fn(c);
        yield c;
      }
    },
  });

export const limitBytes = (max: number): Transform =>
  (src) => ({
    async *[Symbol.asyncIterator]() {
      let left = max;
      if (left <= 0) return;
      for await (const c of src) {
        if (c.length <= left) {
          yield c;
          left -= c.length;
          if (left === 0) return;
        } else {
          yield c.subarray(0, left);
          return;
        }
      }
    },
  });

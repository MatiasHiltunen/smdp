export type CodeBlockSourceSpan = Readonly<{ s: number; e: number }>;

export type BufferedCodeBlock = {
  readonly bytes: Uint8Array;
  readonly lines: ReadonlyArray<Readonly<{ s: number; e: number }>>;
};

/**
 * Materialize only the current fenced block while retaining logical line
 * offsets. Parser events can omit indentation or blockquote prefixes, so a
 * contiguous source subarray is not always equivalent to the rendered code.
 */
export function bufferCodeBlock(
  source: Uint8Array,
  spans: readonly CodeBlockSourceSpan[],
): BufferedCodeBlock {
  let length = 0;
  for (const span of spans) {
    length += Math.max(0, span.e - span.s) + 1;
  }

  const bytes = new Uint8Array(length);
  const lines: Array<{ s: number; e: number }> = [];
  let offset = 0;
  for (const span of spans) {
    const slice = source.subarray(span.s, span.e);
    const start = offset;
    bytes.set(slice, offset);
    offset += slice.length;
    lines.push({ s: start, e: offset });
    bytes[offset++] = 0x0a;
  }

  return { bytes, lines };
}

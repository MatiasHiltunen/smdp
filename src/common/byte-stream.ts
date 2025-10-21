/**
 * High-performance cursor over a Uint8Array with basic line/column tracking.
 * Designed for byte-oriented parsing – avoids allocations and normalises CRLF.
 */

export interface ByteStreamOptions {
  tabWidth?: number;
}

export class ByteStream {
  readonly buffer: Uint8Array;
  readonly start: number;
  readonly end: number;

  private index: number;
  private readonly tabWidth: number;

  line = 0;
  column = 0;

  constructor(
    buffer: Uint8Array,
    start = 0,
    end = buffer.length,
    options: ByteStreamOptions = {},
  ) {
    if (start < 0 || end < start || end > buffer.length) {
      throw new RangeError('Invalid ByteStream bounds');
    }
    this.buffer = buffer;
    this.start = start;
    this.index = start;
    this.end = end;
    this.tabWidth = Math.max(1, options.tabWidth ?? 4);
  }

  get pos(): number {
    return this.index;
  }

  set pos(value: number) {
    if (value < this.start || value > this.end) {
      throw new RangeError('ByteStream position out of bounds');
    }
    this.index = value;
  }

  get eof(): boolean {
    return this.index >= this.end;
  }

  peek(offset = 0): number {
    const target = this.index + offset;
    return target < this.end ? this.buffer[target] : -1;
  }

  read(): number {
    const value = this.peek();
    if (value !== -1) {
      this.advance();
    }
    return value;
  }

  advance(count = 1): void {
    while (count-- > 0 && this.index < this.end) {
      const code = this.buffer[this.index++];

      if (code === 0x0d) {
        // carriage return; treat CRLF as a single newline
        if (this.index < this.end && this.buffer[this.index] === 0x0a) {
          this.index++;
        }
        this.line++;
        this.column = 0;
        continue;
      }

      if (code === 0x0a) {
        this.line++;
        this.column = 0;
        continue;
      }

      if (code === 0x09) {
        this.column += this.tabWidth;
      } else {
        this.column++;
      }
    }
  }

  /**
   * Consume spaces/tabs returning the computed indent (tabs count as tabWidth).
   */
  consumeIndent(): number {
    let indent = 0;
    while (!this.eof) {
      const code = this.peek();
      if (code === 0x20) {
        indent++;
        this.advance();
        continue;
      }
      if (code === 0x09) {
        indent += this.tabWidth;
        this.advance();
        continue;
      }
      break;
    }
    return indent;
  }

  skipWhile(predicate: (code: number) => boolean): void {
    while (!this.eof && predicate(this.peek())) {
      this.advance();
    }
  }

  mark(): number {
    return this.index;
  }

  sliceFrom(mark: number): Uint8Array {
    const start = Math.max(this.start, Math.min(mark, this.end));
    return this.buffer.subarray(start, this.index);
  }
}

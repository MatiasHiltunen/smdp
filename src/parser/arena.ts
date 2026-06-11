/**
 * Arena-style HTML buffer with geometric growth
 * Uses Uint8Array for efficient byte-level operations
 */

import { TAG, TD, TE } from './constants';

export class HtmlArena {
  private buf: ArrayBuffer;
  private len: number;

  // Lower preallocated size results in faster small writes, but more reallocations.
  constructor(initial = 8192) {
    this.buf = new ArrayBuffer(initial);
    this.len = 0;
  }

  private ensure(cap: number): void {
    if (cap <= this.buf.byteLength) return;
    
    let n = this.buf.byteLength || 8;
    // Double until 1MB, then 1.5x (fewer copies for very large output)
    while (n < cap) {
      n = n < (1 << 20) ? (n << 1) : n + (n >> 1);
    }

    const next = new ArrayBuffer(n);
    new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.len));
    this.buf = next;
  }

  writeByte(b: number): void {
    const p = this.len;
    this.ensure(p + 1);

    const view = new Uint8Array(this.buf);
    view[p] = b;
    this.len = p + 1;
  }

  writeBytes(u8: Uint8Array): void {
    const p = this.len;
    this.ensure(p + u8.byteLength);
    const view = new Uint8Array(this.buf);
    view.set(u8, p);
    this.len = p + u8.byteLength;
  }

  /**
   * Reserve capacity for additional bytes to reduce future reallocations.
   */
  reserve(additionalCapacity: number): void {
    const need = this.len + (additionalCapacity | 0);
    if (need > this.buf.byteLength) this.ensure(need);
  }

  writeAscii(str: string): void {
    // For constants only
    const p = this.len;
    const n = str.length;
    this.ensure(p + n);
    const view = new Uint8Array(this.buf);

    let o = p;
    
    for (let i = 0; i < n; i++) {
      const code = str.charCodeAt(i);
      if (code > 0x7f) {
        throw new Error('writeAscii only accepts ASCII input; use writeUtf8 for non-ASCII text');
      }
      view[o++] = code;
    }
    
    this.len = o;
  }

  writeUtf8(str: string): void {
    if (!str) return;
    this.writeBytes(TE.encode(str));
  }

  /**
   * Hot-path: copy chunks between escapes (&, <, >, ", ')
   */
  writeEscaped(bytes: Uint8Array, s: number, e: number): void {
    let start = s;
    
    for (let i = s; i < e; i++) {
      const c = bytes[i];
      if (c === 0x26 || c === 0x3c || c === 0x3e || c === 0x22 || c === 0x27) {
        if (i > start) {
          this.writeBytes(bytes.subarray(start, i));
        }
        
        if (c === 0x26) this.writeBytes(TAG.amp);      // &
        else if (c === 0x3c) this.writeBytes(TAG.lt);  // <
        else if (c === 0x3e) this.writeBytes(TAG.gt);  // >
        else if (c === 0x22) this.writeBytes(TAG.quot); // "
        else this.writeBytes(TAG.apos);                // '
        
        start = i + 1;
      }
    }
    
    if (start < e) {
      this.writeBytes(bytes.subarray(start, e));
    }
  }

  toString(): string {
    const view = new Uint8Array(this.buf);
    return TD.decode(view.subarray(0, this.len));
  }

  toUint8Array(): Uint8Array {
    const view = new Uint8Array(this.buf);
    return view.slice(0, this.len);
  }
}

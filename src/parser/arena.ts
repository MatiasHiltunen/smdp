/**
 * Arena-style HTML buffer with geometric growth
 * Uses Uint8Array for efficient byte-level operations
 */

import { TAG, TD } from './constants';

export class HtmlArena {
  private buf: Uint8Array;
  private len: number;

  constructor(initial = 8192) {
    this.buf = new Uint8Array(initial);
    this.len = 0;
  }

  private ensure(cap: number): void {
    if (cap <= this.buf.length) return;
    
    let n = this.buf.length || 8;
    // Double until 1MB, then 1.5x (fewer copies for very large output)
    while (n < cap) {
      n = n < (1 << 20) ? (n << 1) : n + (n >> 1);
    }
    
    const nb = new Uint8Array(n);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }

  writeByte(b: number): void {
    const p = this.len;
    this.ensure(p + 1);
    this.buf[p] = b;
    this.len = p + 1;
  }

  writeBytes(u8: Uint8Array): void {
    const p = this.len;
    this.ensure(p + u8.length);
    this.buf.set(u8, p);
    this.len = p + u8.length;
  }

  writeAscii(str: string): void {
    // For constants only
    const p = this.len;
    const n = str.length;
    this.ensure(p + n);
    const b = this.buf;
    let o = p;
    
    for (let i = 0; i < n; i++) {
      b[o++] = str.charCodeAt(i) & 0xff;
    }
    
    this.len = o;
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
    return TD.decode(this.buf.subarray(0, this.len));
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}


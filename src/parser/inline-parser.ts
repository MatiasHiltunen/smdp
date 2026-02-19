/**
 * Inline token generator for parsing emphasis, code, links, images, etc.
 */

import type { InlineToken } from './types';
import { findBracket, matchHttp, matchWww, scanUrl } from './utils';

export interface InlineParseOptions {
  allowRawHtml?: boolean;
}

function isAsciiAlpha(byte: number): boolean {
  const lower = byte | 32;
  return lower >= 0x61 && lower <= 0x7a;
}

/**
 * Yields inline tokens:
 *  - text{s,e}          (escaped as HTML)
 *  - code{s,e}
 *  - img{altS,altE,srcS,srcE}
 *  - link{hrefS,hrefE,textS,textE}
 *  - autolink{s,e,isWww}
 *  - emOpen / emClose   (simplified emphasis)
 *  - strongOpen / strongClose
 */
export function* inlineTokens(
  u8: Uint8Array,
  s: number,
  e: number,
  options: InlineParseOptions = {},
): Generator<InlineToken> {
  const allowRawHtml = options.allowRawHtml === true;
  const emStack: Array<{ char: number; pos: number }> = [];
  const strongStack: Array<{ char: number; pos: number }> = [];
  const strikeStack: number[] = [];
  let i = s;
  let inCode = false;
  let codeTicks = 0;
  let codeStart = -1;

  while (i < e) {
    const c = u8[i];

    // `code`
    if (c === 0x60) { // backtick
      let t = 0;
      while (i < e && u8[i] === 0x60) {
        t++;
        i++;
      }
      
      if (!inCode) {
        inCode = true;
        codeTicks = t;
        codeStart = i;
        continue;
      }
      
      if (t === codeTicks) {
        yield { kind: 'code', s: codeStart, e: i - t };
        inCode = false;
        codeTicks = 0;
        codeStart = -1;
        continue;
      }
      
      for (; t > 0; t--) {
        yield { kind: 'text', s: i - t, e: i - t + 1 };
      }
      continue;
    }
    
    if (inCode) {
      // Skip characters inside code spans - they'll be yielded as a single 'code' token
      i++;
      continue;
    }

    // Raw HTML tag passthrough when enabled (sanitized in renderer)
    if (allowRawHtml && c === 0x3c && i + 2 < e) { // <
      let probe = i + 1;
      if (u8[probe] === 0x2f) probe++; // optional /
      const first = probe < e ? u8[probe] : 0;
      if (isAsciiAlpha(first) || first === 0x21) { // letter or ! (comments/doctype)
        let close = probe + 1;
        while (close < e && u8[close] !== 0x3e) close++; // >
        if (close < e) {
          yield { kind: 'rawHtml', s: i, e: close + 1 };
          i = close + 1;
          continue;
        }
      }
    }

    // ![alt](src)
    if (c === 0x21 && i + 1 < e && u8[i + 1] === 0x5b) { // ![ 
      const altClose = findBracket(u8, i + 2, e, 0x5d);
      if (altClose !== -1 && altClose + 1 < e && u8[altClose + 1] === 0x28) { // ](
        const srcClose = findBracket(u8, altClose + 2, e, 0x29); // )
        if (srcClose !== -1) {
          yield {
            kind: 'img',
            altS: i + 2,
            altE: altClose,
            srcS: altClose + 2,
            srcE: srcClose,
          };
          i = srcClose + 1;
          continue;
        }
      }
    }

    // [text](url) or [^footnote]
    if (c === 0x5b) { // [
      // Check for footnote reference [^id]
      if (i + 2 < e && u8[i + 1] === 0x5e) { // [^
        const close = findBracket(u8, i + 2, e, 0x5d); // ]
        if (close !== -1) {
          yield {
            kind: 'footnoteRef',
            idS: i + 2,
            idE: close,
          };
          i = close + 1;
          continue;
        }
      }
      
      // Regular link [text](url)
      const close = findBracket(u8, i + 1, e, 0x5d); // ]
      if (close !== -1 && close + 1 < e && u8[close + 1] === 0x28) { // (
        const endParen = findBracket(u8, close + 2, e, 0x29); // )
        if (endParen !== -1) {
          yield {
            kind: 'link',
            hrefS: close + 2,
            hrefE: endParen,
            textS: i + 1,
            textE: close,
          };
          i = endParen + 1;
          continue;
        }
      }
    }

    // Autolinks: http(s)://... OR www....
    if (
      (c === 0x68 && matchHttp(u8, i, e)) || // h (http)
      (c === 0x77 && matchWww(u8, i, e))     // w (www)
    ) {
      const isWww = c === 0x77;
      const { hrefStart, hrefEnd } = scanUrl(u8, i, e);
      yield { kind: 'autolink', s: hrefStart, e: hrefEnd, isWww };
      i = hrefEnd;
      continue;
    }

    // Strikethrough ~~text~~
    if (c === 0x7e) { // ~
      let j = i;
      while (j < e && u8[j] === 0x7e) j++;
      const runLen = j - i;
      if (runLen >= 2) {
        if (strikeStack.length > 0) {
          strikeStack.pop();
          yield { kind: 'strikeClose' };
        } else {
          strikeStack.push(i);
          yield { kind: 'strikeOpen' };
        }
        i = j;
        continue;
      }
    }

    // Emphasis (simple toggling for * and _, with separate handling for singles/doubles)
    if (c === 0x2a || c === 0x5f) { // * or _
      let j = i;
      while (j < e && u8[j] === c) j++;
      const runLen = j - i;
      
      if (runLen === 1 || runLen === 2) {
        const isStrong = runLen === 2;
        const stk = isStrong ? strongStack : emStack;
        
        // Check if this closes an existing emphasis
        const matchIdx = stk.findIndex(item => item.char === c);
        if (matchIdx !== -1) {
          // Close the emphasis
          stk.splice(matchIdx, 1);
          yield { kind: isStrong ? 'strongClose' : 'emClose' };
        } else {
          // Open new emphasis
          stk.push({ char: c, pos: i });
          yield { kind: isStrong ? 'strongOpen' : 'emOpen' };
        }
      } else {
        // Treat long runs as literal text
        yield { kind: 'text', s: i, e: j };
      }
      
      i = j;
      continue;
    }

    // Text byte (may be part of a multibyte UTF-8 sequence)
    const byte = u8[i];
    let advance = 1;
    if ((byte & 0b11100000) === 0b11000000) {
      advance = 2;
    } else if ((byte & 0b11110000) === 0b11100000) {
      advance = 3;
    } else if ((byte & 0b11111000) === 0b11110000) {
      advance = 4;
    }
    const end = Math.min(i + advance, e);
    yield { kind: 'text', s: i, e: end };
    i = end;
  }

  // Close any unclosed emphasis markers at the end of the span
  // This prevents deeply nested tags from cascading through the document
  while (strongStack.length > 0) {
    strongStack.pop();
    yield { kind: 'strongClose' };
  }
  while (emStack.length > 0) {
    emStack.pop();
    yield { kind: 'emClose' };
  }
  while (strikeStack.length > 0) {
    strikeStack.pop();
    yield { kind: 'strikeClose' };
  }
}

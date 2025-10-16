/**
 * Inline token generator for parsing emphasis, code, links, images, etc.
 */

import type { InlineToken } from './types';
import { findBracket, matchHttp, matchWww, scanUrl } from './utils';

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
): Generator<InlineToken> {
  const emStack: number[] = [];
  const strongStack: number[] = [];
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

    // [text](url)
    if (c === 0x5b) { // [
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

    // Emphasis (simple toggling for * and _, with separate handling for singles/doubles)
    if (c === 0x2a || c === 0x5f) { // * or _
      let j = i;
      while (j < e && u8[j] === c) j++;
      const runLen = j - i;
      
      if (runLen === 1 || runLen === 2) {
        const isStrong = runLen === 2;
        const stk = isStrong ? strongStack : emStack;
        
        if (stk.length && stk[stk.length - 1] === c) {
          stk.pop();
          yield { kind: isStrong ? 'strongClose' : 'emClose' };
        } else {
          stk.push(c);
          yield { kind: isStrong ? 'strongOpen' : 'emOpen' };
        }
      } else {
        // Treat long runs as literal text
        yield { kind: 'text', s: i, e: j };
      }
      
      i = j;
      continue;
    }

    // Text byte
    yield { kind: 'text', s: i, e: i + 1 };
    i++;
  }

  // Unbalanced emphasis → literal marker(s): cheap no-op (already text)
  emStack.length = 0;
  strongStack.length = 0;
}


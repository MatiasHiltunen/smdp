/**
 * Inline token generator for parsing emphasis, code, links, images, etc.
 */

import { ByteStream } from "../common/byte-stream.ts";
import type { InlineToken } from "./types";
import { findBracket, matchHttp, matchWww, scanUrl } from "./utils";

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
  const cursor = new ByteStream(u8, s, e);
  const end = e;

  const emStack: Array<{ char: number; pos: number }> = [];
  const strongStack: Array<{ char: number; pos: number }> = [];
  const strikeStack: number[] = [];

  let inCode = false;
  let codeTicks = 0;
  let codeStart = -1;

  while (!cursor.eof) {
    const i = cursor.pos;
    const c = cursor.peek();

    if (c === 0x60) {
      const runStart = cursor.pos;
      let t = 0;
      while (!cursor.eof && cursor.peek() === 0x60) {
        cursor.advance();
        t++;
      }

      if (!inCode) {
        inCode = true;
        codeTicks = t;
        codeStart = cursor.pos;
        continue;
      }

      if (t === codeTicks) {
        yield { kind: "code", s: codeStart, e: runStart };
        inCode = false;
        codeTicks = 0;
        codeStart = -1;
        continue;
      }

      for (let k = 0; k < t; k++) {
        const pos = runStart + k;
        yield { kind: "text", s: pos, e: pos + 1 };
      }
      continue;
    }

    if (inCode) {
      cursor.advance();
      continue;
    }

    if (c === 0x21 && i + 1 < end && u8[i + 1] === 0x5b) {
      const altClose = findBracket(u8, i + 2, end, 0x5d);
      if (altClose !== -1 && altClose + 1 < end && u8[altClose + 1] === 0x28) {
        const srcClose = findBracket(u8, altClose + 2, end, 0x29);
        if (srcClose !== -1) {
          yield {
            kind: "img",
            altS: i + 2,
            altE: altClose,
            srcS: altClose + 2,
            srcE: srcClose,
          };
          cursor.pos = srcClose + 1;
          continue;
        }
      }
    }

    if (c === 0x5b) {
      if (i + 2 < end && u8[i + 1] === 0x5e) {
        const close = findBracket(u8, i + 2, end, 0x5d);
        if (close !== -1) {
          yield {
            kind: "footnoteRef",
            idS: i + 2,
            idE: close,
          };
          cursor.pos = close + 1;
          continue;
        }
      }

      const close = findBracket(u8, i + 1, end, 0x5d);
      if (close !== -1 && close + 1 < end && u8[close + 1] === 0x28) {
        const endParen = findBracket(u8, close + 2, end, 0x29);
        if (endParen !== -1) {
          yield {
            kind: "link",
            hrefS: close + 2,
            hrefE: endParen,
            textS: i + 1,
            textE: close,
          };
          cursor.pos = endParen + 1;
          continue;
        }
      }
    }

    if (
      (c === 0x68 && matchHttp(u8, i, end)) ||
      (c === 0x77 && matchWww(u8, i, end))
    ) {
      const isWww = c === 0x77;
      const { hrefStart, hrefEnd } = scanUrl(u8, i, end);
      yield { kind: "autolink", s: hrefStart, e: hrefEnd, isWww };
      cursor.pos = hrefEnd;
      continue;
    }

    if (c === 0x7e) {
      let j = i;
      while (j < end && u8[j] === 0x7e) j++;
      const runLen = j - i;
      if (runLen >= 2) {
        if (strikeStack.length > 0) {
          strikeStack.pop();
          yield { kind: "strikeClose" };
        } else {
          strikeStack.push(i);
          yield { kind: "strikeOpen" };
        }
        cursor.pos = j;
        continue;
      }
    }

    if (c === 0x2a || c === 0x5f) {
      let j = i;
      while (j < end && u8[j] === c) j++;
      const runLen = j - i;

      if (runLen === 1 || runLen === 2) {
        const isStrong = runLen === 2;
        const stack = isStrong ? strongStack : emStack;
        const matchIdx = stack.findIndex((item) => item.char === c);

        if (matchIdx !== -1) {
          stack.splice(matchIdx, 1);
          yield { kind: isStrong ? "strongClose" : "emClose" };
        } else {
          stack.push({ char: c, pos: i });
          yield { kind: isStrong ? "strongOpen" : "emOpen" };
        }
      } else {
        yield { kind: "text", s: i, e: j };
      }
      cursor.pos = j;
      continue;
    }

    const byte = u8[i];
    let advance = 1;
    if ((byte & 0b11100000) === 0b11000000) {
      advance = 2;
    } else if ((byte & 0b11110000) === 0b11100000) {
      advance = 3;
    } else if ((byte & 0b11111000) === 0b11110000) {
      advance = 4;
    }

    const textEnd = Math.min(i + advance, end);
    yield { kind: "text", s: i, e: textEnd };
    cursor.advance(textEnd - i);
  }

  while (strongStack.length > 0) {
    strongStack.pop();
    yield { kind: "strongClose" };
  }
  while (emStack.length > 0) {
    emStack.pop();
    yield { kind: "emClose" };
  }
  while (strikeStack.length > 0) {
    strikeStack.pop();
    yield { kind: "strikeClose" };
  }
}

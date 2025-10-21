/**
 * Block event generator for parsing block-level structures
 * (headings, blockquotes, lists, code blocks, paragraphs, etc.)
 */

import { ByteStream } from "../common/byte-stream.ts";
import type { BlockEvent, BlockState } from "./types";
import { lineSpans } from "./line-parser";
import {
  isHr,
  detectFence,
  parseListMarker,
  skipSpaces,
  hasRepeat,
  isSpace,
  isTableSeparator,
  parseTableRow,
  detectInfoBlock,
  parseFenceMeta,
  clampUtf8SliceEnd,
} from "./utils";

/**
 * Events:
 *  bqOpen / bqClose
 *  hr
 *  heading{level,s,e}
 *  listOpen{kind:'ul'|'ol', indent} / listItem{s,e} / listClose{kind}
 *  paraLine{s,e}
 *  codeOpen / codeText{s,e} / codeClose
 */
export function* blocks(u8: Uint8Array): Generator<BlockEvent> {
  const st: BlockState = {
    bqLevel: 0,
    listStack: [],
    inFence: false,
    fenceCh: 0,
    fenceLen: 0,
    fenceInfo: undefined,
    inTable: false,
    tableAlignments: [],
    inInfo: false,
  };

  const lines = Array.from(lineSpans(u8));

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const { start, end } = lines[lineIdx];

    // Handle info blocks
    const infoCheck = detectInfoBlock(u8, start, end);
    if (infoCheck.isInfo) {
      if (infoCheck.isClose) {
        if (st.inInfo) {
          st.inInfo = false;
          delete st.infoType;
          yield { type: "infoClose" };
        }
        continue;
      } else if (infoCheck.type) {
        st.inInfo = true;
        st.infoType = infoCheck.type;
        yield {
          type: "infoOpen",
          infoType: infoCheck.type as "info" | "warning" | "error" | "success",
        };
        continue;
      }
    }

    if (st.inFence) {
      let i = skipSpaces(u8, start, end);
      if (hasRepeat(u8, i, end, st.fenceCh, st.fenceLen)) {
        st.inFence = false;
        st.fenceCh = 0;
        st.fenceLen = 0;
        st.fenceInfo = undefined;
        yield { type: "codeClose" };
        continue;
      }
      yield { type: "codeText", s: start, e: end };
      continue;
    }

    // Blockquote prefixes
    const lineStream = new ByteStream(u8, start, end);
    let bq = 0;

    while (!lineStream.eof) {
      const c = lineStream.peek();
      if (isSpace(c)) {
        lineStream.advance();
        continue;
      }
      if (c === 0x3e) {
        bq++;
        lineStream.advance();
        if (!lineStream.eof && lineStream.peek() === 0x20) {
          lineStream.advance();
        }
        continue;
      }
      break;
    }

    let i = lineStream.pos;

    while (st.bqLevel < bq) {
      st.bqLevel++;
      yield { type: "bqOpen" };
    }
    while (st.bqLevel > bq) {
      st.bqLevel--;
      yield { type: "bqClose" };
    }

    const contentStream = new ByteStream(u8, i, end);
    const contentStart = contentStream.pos;
    let blank = true;
    while (!contentStream.eof) {
      if (!isSpace(contentStream.peek())) {
        blank = false;
        break;
      }
      contentStream.advance();
    }
    if (blank) {
      while (st.listStack.length) {
        const item = st.listStack.pop()!;
        yield { type: "listClose", kind: item.kind };
      }
      continue;
    }
    contentStream.pos = contentStart;
    i = contentStream.pos;

    // Headings
    {
      let h = 0;
      while (!contentStream.eof && h < 6 && contentStream.peek() === 0x23) {
        h++;
        contentStream.advance();
      }
      const afterHashes = contentStream.pos;
      if (h > 0 && !contentStream.eof && contentStream.peek() === 0x20) {
        yield { type: "heading", level: h, s: afterHashes + 1, e: end };
        continue;
      }
      contentStream.pos = contentStart;
    }

    const footStream = new ByteStream(u8, i, end);
    if (!footStream.eof && footStream.peek() === 0x5b) {
      footStream.advance();
      if (!footStream.eof && footStream.peek() === 0x5e) {
        footStream.advance();
        const idStart = footStream.pos;
        while (!footStream.eof && footStream.peek() !== 0x5d) {
          footStream.advance();
        }
        if (!footStream.eof) {
          const idEnd = footStream.pos;
          footStream.advance(); // skip ]
          if (!footStream.eof && footStream.peek() === 0x3a) {
            footStream.advance();
            while (!footStream.eof && footStream.peek() === 0x20) {
              footStream.advance();
            }
            yield {
              type: "footnoteDef",
              idS: idStart,
              idE: idEnd,
              contentS: footStream.pos,
              contentE: end,
            };
            continue;
          }
        }
      }
    }

    // Tables - check if current line starts with | and next line is separator
    if (
      !st.inTable &&
      i < end &&
      u8[i] === 0x7c &&
      lineIdx + 1 < lines.length
    ) {
      // |
      const nextLine = lines[lineIdx + 1];
      const sepCheck = isTableSeparator(u8, nextLine.start, nextLine.end);

      if (sepCheck.isTable) {
        st.inTable = true;
        st.tableAlignments = sepCheck.alignments;
        yield { type: "tableOpen" };

        // Parse header row
        const headerCells = parseTableRow(u8, start, end);
        const headerWithAlign = headerCells.map((cell, idx) => ({
          ...cell,
          align: st.tableAlignments[idx] || "left",
        }));
        yield { type: "tableHeader", cells: headerWithAlign };

        lineIdx++; // Skip separator line
        continue;
      }
    }

    // Continue parsing table rows
    if (st.inTable) {
      // Check if line is a table row
      if (i < end && u8[i] === 0x7c) {
        // |
        const cells = parseTableRow(u8, start, end);
        yield { type: "tableRow", cells };
        continue;
      } else {
        // End of table
        st.inTable = false;
        st.tableAlignments = [];
        yield { type: "tableClose" };
        // Don't continue, process this line normally
      }
    }

    // HR
    if (isHr(u8, i, end)) {
      yield { type: "hr" };
      continue;
    }

    // Fenced code start
    {
      const f = detectFence(u8, i, end);
      if (f) {
        st.inFence = true;
        st.fenceCh = f.ch;
        st.fenceLen = f.len;
        const info = parseFenceMeta(u8, i + f.len, end);
        st.fenceInfo = info;
        if (info) {
          yield { type: "codeOpen", info };
        } else {
          yield { type: "codeOpen" };
        }
        continue;
      }
    }

    // Lists
    const leadingIndent = i - start;
    const li = parseListMarker(u8, i, end);
    if (li) {
      li.indent += leadingIndent;

      // Step back up the stack until we reach a matching indent
      while (
        st.listStack.length &&
        st.listStack[st.listStack.length - 1].indent > li.indent
      ) {
        const item = st.listStack.pop()!;
        yield { type: "listClose", kind: item.kind };
      }

      // Replace list at the same indent when the marker kind changes
      while (st.listStack.length) {
        const top = st.listStack[st.listStack.length - 1];
        if (top.indent === li.indent && top.kind !== li.type) {
          const item = st.listStack.pop()!;
          yield { type: "listClose", kind: item.kind };
          continue;
        }
        break;
      }

      const top = st.listStack[st.listStack.length - 1];
      if (!top || top.indent !== li.indent || top.kind !== li.type) {
        st.listStack.push({ kind: li.type, indent: li.indent });
        yield { type: "listOpen", kind: li.type, indent: li.indent };
      }

      // Detect GFM task list prefix [ ] or [x]
      let task = false;
      let checked = false;
      let afterStart = li.afterStart;
      if (
        afterStart + 3 <= end &&
        u8[afterStart] === 0x5b &&
        u8[afterStart + 2] === 0x5d
      ) {
        // '[' _ ']'
        const mid = u8[afterStart + 1] | 32; // lowercased
        if (mid === 0x20 || mid === 0x78) {
          // space or 'x'
          const maybeSpace = afterStart + 3 < end ? u8[afterStart + 3] : 0;
          if (maybeSpace === 0x20) {
            task = true;
            checked = mid === 0x78; // 'x'
            afterStart += 4; // skip "[ ] " or "[x] "
          }
        }
      }

      yield { type: "listItem", s: afterStart, e: li.afterEnd, task, checked };
      continue;
    }

    // Paragraph line (ensure we don't split inside a multibyte codepoint)
    const lineEnd = clampUtf8SliceEnd(u8, i, end, end);
    yield { type: "paraLine", s: i, e: lineEnd };
  }

  // EOF flush
  if (st.inFence) {
    yield { type: "codeClose" };
    st.inFence = false;
    st.fenceInfo = undefined;
  }

  while (st.bqLevel > 0) {
    yield { type: "bqClose" };
    st.bqLevel--;
  }

  while (st.listStack.length) {
    const item = st.listStack.pop()!;
    yield { type: "listClose", kind: item.kind };
  }
}

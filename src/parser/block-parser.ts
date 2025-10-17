/**
 * Block event generator for parsing block-level structures
 * (headings, blockquotes, lists, code blocks, paragraphs, etc.)
 */

import type { BlockEvent, BlockState } from './types';
import { lineSpans } from './line-parser';
import {
  isBlank,
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
} from './utils';

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
          yield { type: 'infoClose' };
        }
        continue;
      } else if (infoCheck.type) {
        st.inInfo = true;
        st.infoType = infoCheck.type;
        yield { type: 'infoOpen', infoType: infoCheck.type as 'info' | 'warning' | 'error' | 'success' };
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
        yield { type: 'codeClose' };
        continue;
      }
      yield { type: 'codeText', s: start, e: end };
      continue;
    }

    // Blockquote prefixes
    let i = start;
    let bq = 0;
    
    while (i < end) {
      const c = u8[i];
      if (isSpace(c)) {
        i++;
        continue;
      }
      if (c === 0x3e) { // >
        bq++;
        i++;
        if (i < end && u8[i] === 0x20) i++;
        continue;
      }
      break;
    }
    
    while (st.bqLevel < bq) {
      st.bqLevel++;
      yield { type: 'bqOpen' };
    }
    while (st.bqLevel > bq) {
      st.bqLevel--;
      yield { type: 'bqClose' };
    }

    if (isBlank(u8, i, end)) {
      // Blank line closes lists
      while (st.listStack.length) {
        const item = st.listStack.pop()!;
        yield { type: 'listClose', kind: item.kind };
      }
      continue;
    }

    // Headings
    {
      let h = 0;
      let j = i;
      while (j < end && h < 6 && u8[j] === 0x23) { // #
        h++;
        j++;
      }
      if (h > 0 && j < end && u8[j] === 0x20) {
        yield { type: 'heading', level: h, s: j + 1, e: end };
        continue;
      }
    }

    // Tables - check if current line starts with | and next line is separator
    if (!st.inTable && i < end && u8[i] === 0x7c && lineIdx + 1 < lines.length) { // |
      const nextLine = lines[lineIdx + 1];
      const sepCheck = isTableSeparator(u8, nextLine.start, nextLine.end);
      
      if (sepCheck.isTable) {
        st.inTable = true;
        st.tableAlignments = sepCheck.alignments;
        yield { type: 'tableOpen' };
        
        // Parse header row
        const headerCells = parseTableRow(u8, start, end);
        const headerWithAlign = headerCells.map((cell, idx) => ({
          ...cell,
          align: st.tableAlignments[idx] || 'left',
        }));
        yield { type: 'tableHeader', cells: headerWithAlign };
        
        lineIdx++; // Skip separator line
        continue;
      }
    }
    
    // Continue parsing table rows
    if (st.inTable) {
      // Check if line is a table row
      if (i < end && u8[i] === 0x7c) { // |
        const cells = parseTableRow(u8, start, end);
        yield { type: 'tableRow', cells };
        continue;
      } else {
        // End of table
        st.inTable = false;
        st.tableAlignments = [];
        yield { type: 'tableClose' };
        // Don't continue, process this line normally
      }
    }

    // HR
    if (isHr(u8, i, end)) {
      yield { type: 'hr' };
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
          yield { type: 'codeOpen', info };
        } else {
          yield { type: 'codeOpen' };
        }
        continue;
      }
    }

    // Lists
    const li = parseListMarker(u8, i, end);
    if (li) {
      // Close lists at higher/equal indent with different kind
      while (
        st.listStack.length &&
        st.listStack[st.listStack.length - 1].indent >= li.indent &&
        st.listStack[st.listStack.length - 1].kind !== li.type
      ) {
        const item = st.listStack.pop()!;
        yield { type: 'listClose', kind: item.kind };
      }
      
      const top = st.listStack[st.listStack.length - 1];
      if (!top || top.indent !== li.indent || top.kind !== li.type) {
        st.listStack.push({ kind: li.type, indent: li.indent });
        yield { type: 'listOpen', kind: li.type, indent: li.indent };
      }
      
      yield { type: 'listItem', s: li.afterStart, e: li.afterEnd };
      continue;
    }

    // Paragraph line (ensure we don't split inside a multibyte codepoint)
    let lineEnd = end;
    while (lineEnd > i && (u8[lineEnd - 1] & 0b11000000) === 0b10000000) {
      lineEnd--;
    }
    yield { type: 'paraLine', s: i, e: lineEnd };
  }

  // EOF flush
  if (st.inFence) {
    yield { type: 'codeClose' };
    st.inFence = false;
    st.fenceInfo = undefined;
  }
  
  while (st.bqLevel > 0) {
    yield { type: 'bqClose' };
    st.bqLevel--;
  }
  
  while (st.listStack.length) {
    const item = st.listStack.pop()!;
    yield { type: 'listClose', kind: item.kind };
  }
}


/**
 * Block event generator for parsing block-level structures
 * (headings, blockquotes, lists, code blocks, paragraphs, etc.)
 */

import type { BlockEvent, BlockState } from './types';
import { lineSpans } from './line-parser';
import { TD } from './constants';
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
  clampUtf8SliceEnd,
} from './utils';

export interface BlockParseOptions {
  allowRawHtml?: boolean;
}

const RAW_HTML_BLOCK_TAGS = new Set([
  'details',
  'summary',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
]);

function isAsciiAlphaNum(byte: number): boolean {
  const lower = byte | 32;
  return (lower >= 0x61 && lower <= 0x7a) || (byte >= 0x30 && byte <= 0x39);
}

type RawHtmlBlockTag = {
  tagName: string;
  isClosing: boolean;
};

function parseRawHtmlBlockTag(u8: Uint8Array, s: number, e: number): RawHtmlBlockTag | null {
  let i = skipSpaces(u8, s, e);
  if (i >= e || u8[i] !== 0x3c) return null; // <
  i++;
  let isClosing = false;
  if (i < e && u8[i] === 0x2f) {
    isClosing = true;
    i++;
  } // optional /
  const nameStart = i;
  while (i < e && isAsciiAlphaNum(u8[i])) i++;
  if (i <= nameStart) return null;
  const tagName = TD.decode(u8.subarray(nameStart, i)).toLowerCase();
  return { tagName, isClosing };
}

function hasSummaryCloseTagOnLine(u8: Uint8Array, s: number, e: number): boolean {
  return TD.decode(u8.subarray(s, e)).toLowerCase().includes('</summary');
}

function hasTablePipe(u8: Uint8Array, s: number, e: number): boolean {
  for (let i = s; i < e; i++) {
    if (u8[i] === 0x7c) return true; // |
  }
  return false;
}

function isAtxHeadingLine(u8: Uint8Array, s: number, e: number): boolean {
  let i = s;
  let level = 0;
  while (i < e && level < 6 && u8[i] === 0x23) { // #
    level++;
    i++;
  }
  return level > 0 && i < e && u8[i] === 0x20;
}

function isFootnoteDefinitionLine(
  u8: Uint8Array,
  s: number,
  e: number,
): boolean {
  if (s + 4 >= e || u8[s] !== 0x5b || u8[s + 1] !== 0x5e) return false; // [^
  let i = s + 2;
  while (i < e && u8[i] !== 0x5d) i++; // ]
  return i + 1 < e && u8[i + 1] === 0x3a; // :
}

function isTableRowContinuation(
  u8: Uint8Array,
  start: number,
  end: number,
  allowRawHtml: boolean,
): boolean {
  const i = skipSpaces(u8, start, end);
  if (i >= end || !hasTablePipe(u8, i, end)) return false;
  if (u8[i] === 0x7c) return true; // Explicit leading pipe.

  // Pipe-less rows are valid GFM table rows, but block constructs still end
  // the table instead of becoming cell content.
  if (u8[i] === 0x3e) return false; // >
  if (isAtxHeadingLine(u8, i, end)) return false;
  if (isFootnoteDefinitionLine(u8, i, end)) return false;
  if (detectInfoBlock(u8, i, end).isInfo) return false;
  if (detectFence(u8, i, end)) return false;
  if (parseListMarker(u8, i, end)) return false;
  if (isHr(u8, i, end)) return false;

  if (allowRawHtml) {
    const rawTag = parseRawHtmlBlockTag(u8, i, end);
    if (rawTag && RAW_HTML_BLOCK_TAGS.has(rawTag.tagName)) return false;
  }

  return true;
}

function skipBlockquotePrefixes(
  u8: Uint8Array,
  s: number,
  e: number,
  maxPrefixes: number,
): { index: number; count: number } {
  let i = s;
  let count = 0;

  while (i < e && count < maxPrefixes) {
    const c = u8[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === 0x3e) { // >
      count++;
      i++;
      if (i < e && u8[i] === 0x20) i++;
      continue;
    }
    break;
  }

  return { index: i, count };
}

/**
 * Events:
 *  bqOpen / bqClose
 *  hr
 *  heading{level,s,e}
 *  listOpen{kind:'ul'|'ol', indent} / listItem{s,e} / listClose{kind}
 *  paraLine{s,e}
 *  codeOpen / codeText{s,e} / codeClose
 */
export function* blocks(
  u8: Uint8Array,
  options: BlockParseOptions = {},
): Generator<BlockEvent> {
  const allowRawHtml = options.allowRawHtml === true;
  const st: BlockState = {
    bqLevel: 0,
    listStack: [],
    inFence: false,
    fenceCh: 0,
    fenceLen: 0,
    fenceInfo: undefined,
    inRawSummary: false,
    inTable: false,
    tableAlignments: [],
    inInfo: false,
  };
  
  const iterator = lineSpans(u8)[Symbol.iterator]();
  let current = iterator.next();
  let next = iterator.next();

  while (!current.done) {
    const { start, end } = current.value;
    let skipNext = false;
    try {

    // A table must close before any following block is emitted. Keeping this
    // check ahead of headings, info blocks, raw HTML, and footnotes prevents
    // those blocks from being nested inside <tbody> or reordered by buffered
    // renderers.
    if (st.inTable) {
      if (isTableRowContinuation(u8, start, end, allowRawHtml)) {
        const cells = parseTableRow(u8, start, end);
        yield { type: 'tableRow', cells };
        continue;
      }

      st.inTable = false;
      st.tableAlignments = [];
      yield { type: 'tableClose' };
      // Process the same non-table line normally below.
    }
    
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
      let lineStart = start;
      if (st.bqLevel > 0) {
        const stripped = skipBlockquotePrefixes(u8, start, end, st.bqLevel);
        if (stripped.count > 0) {
          lineStart = stripped.index;
        }
      }

      let i = skipSpaces(u8, lineStart, end);
      if (hasRepeat(u8, i, end, st.fenceCh, st.fenceLen)) {
        st.inFence = false;
        st.fenceCh = 0;
        st.fenceLen = 0;
        st.fenceInfo = undefined;
        yield { type: 'codeClose' };
        continue;
      }
      yield { type: 'codeText', s: lineStart, e: end };
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

    if (allowRawHtml && st.inRawSummary) {
      yield { type: 'rawHtmlLine', s: i, e: end };
      const rawTag = parseRawHtmlBlockTag(u8, i, end);
      if (rawTag && rawTag.tagName === 'summary' && rawTag.isClosing) {
        st.inRawSummary = false;
      }
      continue;
    }

    if (isBlank(u8, i, end)) {
      // Blank line closes lists
      while (st.listStack.length) {
        const item = st.listStack.pop()!;
        yield { type: 'listClose', kind: item.kind };
      }
      continue;
    }

    if (allowRawHtml) {
      const rawTag = parseRawHtmlBlockTag(u8, i, end);
      if (rawTag && RAW_HTML_BLOCK_TAGS.has(rawTag.tagName)) {
        if (
          rawTag.tagName === 'summary' &&
          !rawTag.isClosing &&
          !hasSummaryCloseTagOnLine(u8, i, end)
        ) {
          st.inRawSummary = true;
        } else if (rawTag.tagName === 'summary' && rawTag.isClosing) {
          st.inRawSummary = false;
        }
        yield { type: 'rawHtmlLine', s: i, e: end };
        continue;
      }
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

    // Footnote definitions [^id]: content
    if (i + 4 < end && u8[i] === 0x5b && u8[i + 1] === 0x5e) { // [^
      let j = i + 2;
      while (j < end && u8[j] !== 0x5d) j++; // Find ]
      if (j < end && j + 1 < end && u8[j + 1] === 0x3a) { // ]:
        const idS = i + 2;
        const idE = j;
        let contentStart = j + 2;
        // Skip whitespace after colon
        while (contentStart < end && u8[contentStart] === 0x20) contentStart++;
        yield {
          type: 'footnoteDef',
          idS,
          idE,
          contentS: contentStart,
          contentE: end,
        };
        continue;
      }
    }

    // Tables support optional outer pipes. At least one pipe is required in
    // the header to avoid treating a plain `---` line as a one-column table.
    if (i < end && hasTablePipe(u8, i, end) && !next.done) {
      const nextLine = next.value;
      const sepCheck = isTableSeparator(u8, nextLine.start, nextLine.end);
      const headerCells = parseTableRow(u8, i, end);

      if (
        sepCheck.isTable &&
        headerCells.length === sepCheck.alignments.length
      ) {
        st.inTable = true;
        st.tableAlignments = sepCheck.alignments;
        yield { type: 'tableOpen' };
        
        const headerWithAlign = headerCells.map((cell, idx) => ({
          ...cell,
          align: st.tableAlignments[idx] || 'left',
        }));
        yield { type: 'tableHeader', cells: headerWithAlign };
        
        skipNext = true; // Skip separator line
        continue;
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
        yield { type: 'listClose', kind: item.kind };
      }

      // Replace list at the same indent when the marker kind changes
      while (st.listStack.length) {
        const top = st.listStack[st.listStack.length - 1];
        if (top.indent === li.indent && top.kind !== li.type) {
          const item = st.listStack.pop()!;
          yield { type: 'listClose', kind: item.kind };
          continue;
        }
        break;
      }

      const top = st.listStack[st.listStack.length - 1];
      if (!top || top.indent !== li.indent || top.kind !== li.type) {
        st.listStack.push({ kind: li.type, indent: li.indent });
        yield { type: 'listOpen', kind: li.type, indent: li.indent };
      }

      // Detect GFM task list prefix [ ] or [x]
      let task = false;
      let checked = false;
      let afterStart = li.afterStart;
      if (afterStart + 3 <= end && u8[afterStart] === 0x5b && u8[afterStart + 2] === 0x5d) { // '[' _ ']'
        const mid = u8[afterStart + 1] | 32; // lowercased
        if (mid === 0x20 || mid === 0x78) { // space or 'x'
          const maybeSpace = (afterStart + 3 < end) ? u8[afterStart + 3] : 0;
          if (maybeSpace === 0x20) {
            task = true;
            checked = mid === 0x78; // 'x'
            afterStart += 4; // skip "[ ] " or "[x] "
          }
        }
      }

      yield { type: 'listItem', s: afterStart, e: li.afterEnd, task, checked };
      continue;
    }

    // Paragraph line (ensure we don't split inside a multibyte codepoint)
    const lineEnd = clampUtf8SliceEnd(u8, i, end, end);
    yield { type: 'paraLine', s: i, e: lineEnd };
    } finally {
      current = next;
      next = iterator.next();
      if (skipNext) {
        current = next;
        next = iterator.next();
      }
    }
  }

  // EOF flush
  if (st.inFence) {
    yield { type: 'codeClose' };
    st.inFence = false;
    st.fenceInfo = undefined;
  }

  if (st.inTable) {
    yield { type: 'tableClose' };
    st.inTable = false;
    st.tableAlignments = [];
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

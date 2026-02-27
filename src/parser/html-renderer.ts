/**
 * HTML renderer - converts parsed blocks and inline tokens to HTML
 */

import { HtmlArena } from './arena';
import { TAG, TD, TE } from './constants';
import { blocks } from './block-parser';
import { inlineTokens } from './inline-parser';
import type { ListStackItem } from './types';
import { highlightCodeBlock } from '../highlight';
import type { ParserOptions } from './index';
import { defaultUrlAllowlist, resolveUrlRelativeToBase } from './utils';

function decodeSpan(u8: Uint8Array, s: number, e: number): string {
  return TD.decode(u8.subarray(s, e));
}

function isAsciiAlpha(byte: number): boolean {
  const lower = byte | 32;
  return lower >= 0x61 && lower <= 0x7a;
}

type RawHtmlState = {
  suppressedTag: 'script' | 'style' | null;
};

const ALLOWED_RAW_HTML_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'br',
  'code',
  'details',
  'del',
  'em',
  'i',
  'img',
  'kbd',
  'mark',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
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
  'u',
]);

const VOID_RAW_HTML_TAGS = new Set(['br', 'img', 'col']);

const GLOBAL_ALLOWED_ATTRS = new Set([
  'class',
  'id',
  'title',
  'role',
  'aria-label',
  'aria-hidden',
]);

const A_ALLOWED_ATTRS = new Set(['href', 'title', 'target', 'rel']);
const IMG_ALLOWED_ATTRS = new Set([
  'src',
  'alt',
  'title',
  'width',
  'height',
  'loading',
]);
const TABLE_CELL_ALLOWED_ATTRS = new Set(['rowspan', 'colspan', 'scope']);
const COLGROUP_ALLOWED_ATTRS = new Set(['span']);
const COL_ALLOWED_ATTRS = new Set(['span']);
const DETAILS_ALLOWED_ATTRS = new Set(['open', 'name']);

const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function isAttrAllowed(tagName: string, attrName: string): boolean {
  if (GLOBAL_ALLOWED_ATTRS.has(attrName)) return true;
  if (tagName === 'a') return A_ALLOWED_ATTRS.has(attrName);
  if (tagName === 'img') return IMG_ALLOWED_ATTRS.has(attrName);
  if (tagName === 'details') return DETAILS_ALLOWED_ATTRS.has(attrName);
  if (tagName === 'th' || tagName === 'td') return TABLE_CELL_ALLOWED_ATTRS.has(attrName);
  if (tagName === 'colgroup') return COLGROUP_ALLOWED_ATTRS.has(attrName);
  if (tagName === 'col') return COL_ALLOWED_ATTRS.has(attrName);
  return false;
}

function sanitizeRawHtmlTag(
  rawTag: string,
  urlAllowlist: (url: string) => boolean,
  baseUrl: string | undefined,
  state: RawHtmlState,
): string {
  const tag = rawTag.trim();
  if (!tag.startsWith('<') || !tag.endsWith('>')) {
    return '';
  }
  if (tag.startsWith('<!--')) {
    return '';
  }

  let inner = tag.slice(1, -1).trim();
  if (!inner) return '';

  let isClosing = false;
  if (inner.startsWith('/')) {
    isClosing = true;
    inner = inner.slice(1).trim();
  }

  let isSelfClosing = false;
  if (inner.endsWith('/')) {
    isSelfClosing = true;
    inner = inner.slice(0, -1).trim();
  }

  const tagNameMatch = /^([a-zA-Z][a-zA-Z0-9:-]*)/.exec(inner);
  if (!tagNameMatch) {
    return '';
  }
  const tagName = tagNameMatch[1].toLowerCase();

  if (tagName === 'script' || tagName === 'style') {
    if (!isClosing) {
      state.suppressedTag = tagName;
    } else if (state.suppressedTag === tagName) {
      state.suppressedTag = null;
    }
    return '';
  }

  if (state.suppressedTag) {
    if (isClosing && tagName === state.suppressedTag) {
      state.suppressedTag = null;
    }
    return '';
  }

  if (!ALLOWED_RAW_HTML_TAGS.has(tagName)) {
    return '';
  }

  if (isClosing) {
    if (VOID_RAW_HTML_TAGS.has(tagName)) return '';
    return `</${tagName}>`;
  }

  const attrText = inner.slice(tagNameMatch[0].length);
  const attrs = new Map<string, string>();
  let targetBlank = false;

  ATTR_RE.lastIndex = 0;
  for (const match of attrText.matchAll(ATTR_RE)) {
    const attrName = match[1].toLowerCase();
    if (!attrName || attrName === 'style' || attrName.startsWith('on')) continue;
    if (!isAttrAllowed(tagName, attrName)) continue;

    let value = match[2] ?? match[3] ?? match[4] ?? '';
    if (attrName === 'href' || attrName === 'src') {
      if (!value) continue;
      const resolved = resolveUrlRelativeToBase(value, baseUrl);
      if (!urlAllowlist(resolved)) continue;
      value = resolved;
    }
    if (attrName === 'target') {
      const lower = value.toLowerCase();
      if (lower !== '_blank' && lower !== '_self' && lower !== '_parent' && lower !== '_top') {
        continue;
      }
      value = lower;
      if (lower === '_blank') {
        targetBlank = true;
      }
    }
    attrs.set(attrName, value);
  }

  if (tagName === 'a' && targetBlank) {
    const relTokens = new Set(
      (attrs.get('rel') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.toLowerCase()),
    );
    relTokens.delete('opener');
    relTokens.add('noopener');
    relTokens.add('noreferrer');
    attrs.set('rel', Array.from(relTokens).join(' '));
  }

  const renderedAttrs: string[] = [];
  for (const [name, value] of attrs.entries()) {
    renderedAttrs.push(`${name}="${escapeAttr(value)}"`);
  }
  const attrSuffix = renderedAttrs.length > 0 ? ` ${renderedAttrs.join(' ')}` : '';
  if (VOID_RAW_HTML_TAGS.has(tagName) || isSelfClosing) {
    return `<${tagName}${attrSuffix}>`;
  }
  return `<${tagName}${attrSuffix}>`;
}

function writeEscapedHtmlTextInRawContext(
  out: HtmlArena,
  bytes: Uint8Array,
  s: number,
  e: number,
): void {
  let start = s;

  for (let i = s; i < e; i++) {
    const c = bytes[i];
    if (c === 0x3c || c === 0x3e || c === 0x22 || c === 0x27) {
      if (i > start) {
        out.writeBytes(bytes.subarray(start, i));
      }
      if (c === 0x3c) out.writeBytes(TAG.lt); // <
      else if (c === 0x3e) out.writeBytes(TAG.gt); // >
      else if (c === 0x22) out.writeBytes(TAG.quot); // "
      else out.writeBytes(TAG.apos); // '
      start = i + 1;
    }
  }

  if (start < e) {
    out.writeBytes(bytes.subarray(start, e));
  }
}

function renderRawHtmlLine(
  u8: Uint8Array,
  s: number,
  e: number,
  out: HtmlArena,
  options: ParserOptions,
  rawHtmlState: RawHtmlState,
): void {
  if (!options.allowRawHtml) {
    out.writeEscaped(u8, s, e);
    return;
  }

  const urlAllowlist = options.urlAllowlist ?? defaultUrlAllowlist;
  const baseUrl = options.baseUrl;

  let i = s;
  let textStart = s;
  while (i < e) {
    if (u8[i] === 0x3c && i + 2 < e) { // <
      let probe = i + 1;
      if (u8[probe] === 0x2f) probe++; // optional /
      const first = probe < e ? u8[probe] : 0;
      if (isAsciiAlpha(first) || first === 0x21) {
        let close = probe + 1;
        while (close < e && u8[close] !== 0x3e) close++; // >
        if (close < e) {
          if (i > textStart) {
            writeEscapedHtmlTextInRawContext(out, u8, textStart, i);
          }
          const rawTag = decodeSpan(u8, i, close + 1);
          const sanitizedTag = sanitizeRawHtmlTag(
            rawTag,
            urlAllowlist,
            baseUrl,
            rawHtmlState,
          );
          if (sanitizedTag) {
            out.writeUtf8(sanitizedTag);
          }
          i = close + 1;
          textStart = i;
          continue;
        }
      }
    }
    i++;
  }

  if (textStart < e) {
    writeEscapedHtmlTextInRawContext(out, u8, textStart, e);
  }
}

/**
 * Renders inline tokens to HTML
 */
function renderInline(
  u8: Uint8Array,
  s: number,
  e: number,
  out: HtmlArena,
  options: ParserOptions = {},
  rawHtmlState: RawHtmlState = { suppressedTag: null },
): void {
  const urlAllowlist = options.urlAllowlist ?? defaultUrlAllowlist;
  const baseUrl = options.baseUrl;

  const inlineParseOptions = options.allowRawHtml ? { allowRawHtml: true } : undefined;
  for (const tok of inlineTokens(u8, s, e, inlineParseOptions)) {
    if (rawHtmlState.suppressedTag && tok.kind !== 'rawHtml') {
      continue;
    }

    switch (tok.kind) {
      case 'text':
        out.writeEscaped(u8, tok.s, tok.e);
        break;
        
      case 'code':
        out.writeBytes(TAG.codeOpen);
        out.writeEscaped(u8, tok.s, tok.e);
        out.writeBytes(TAG.codeClose);
        break;
        
      case 'img': {
        out.writeBytes(TAG.imgPre);
        out.writeEscaped(u8, tok.altS, tok.altE);
        out.writeBytes(TAG.imgMid);
        const srcText = decodeSpan(u8, tok.srcS, tok.srcE);
        const resolvedSrc = resolveUrlRelativeToBase(srcText, baseUrl);
        if (urlAllowlist(resolvedSrc)) {
          const encoded = TE.encode(resolvedSrc);
          out.writeEscaped(encoded, 0, encoded.length);
        }
        out.writeBytes(TAG.imgClose);
        break;
      }

      case 'link': {
        const hrefText = decodeSpan(u8, tok.hrefS, tok.hrefE);
        const resolvedHref = resolveUrlRelativeToBase(hrefText, baseUrl);
        const allowed = urlAllowlist(resolvedHref);
        if (allowed) {
          out.writeBytes(TAG.aOpenPre);
          const encoded = TE.encode(resolvedHref);
          out.writeEscaped(encoded, 0, encoded.length);
          out.writeBytes(TAG.aMid);
          renderInline(u8, tok.textS, tok.textE, out, options, rawHtmlState);
          out.writeBytes(TAG.aClose);
        } else {
          // Fallback to plain text if URL is not allowed
          renderInline(u8, tok.textS, tok.textE, out, options, rawHtmlState);
        }
        break;
      }

      case 'rawHtml': {
        if (!options.allowRawHtml) {
          out.writeEscaped(u8, tok.s, tok.e);
          break;
        }
        const rawTag = decodeSpan(u8, tok.s, tok.e);
        const sanitizedTag = sanitizeRawHtmlTag(
          rawTag,
          urlAllowlist,
          baseUrl,
          rawHtmlState,
        );
        if (sanitizedTag) {
          out.writeUtf8(sanitizedTag);
        }
        break;
      }

      case 'footnoteRef': {
        out.writeAscii('<sup class="footnote-ref"><a href="#fn-');
        out.writeEscaped(u8, tok.idS, tok.idE);
        out.writeAscii('" id="fnref-');
        out.writeEscaped(u8, tok.idS, tok.idE);
        out.writeAscii('">');
        out.writeEscaped(u8, tok.idS, tok.idE);
        out.writeAscii('</a></sup>');
        break;
      }

      case 'autolink': {
        const hrefText = tok.isWww
          ? 'https://' + decodeSpan(u8, tok.s, tok.e)
          : decodeSpan(u8, tok.s, tok.e);
        const resolvedHref = resolveUrlRelativeToBase(hrefText, baseUrl);
        const allowed = urlAllowlist(resolvedHref);
        if (allowed) {
          out.writeBytes(TAG.aOpenPre);
          const encoded = TE.encode(resolvedHref);
          out.writeEscaped(encoded, 0, encoded.length);
          out.writeBytes(TAG.aMid);
          out.writeEscaped(u8, tok.s, tok.e);
          out.writeBytes(TAG.aClose);
        } else {
          out.writeEscaped(u8, tok.s, tok.e);
        }
        break;
      }
        
      case 'emOpen':
        out.writeBytes(TAG.emOpen);
        break;
        
      case 'emClose':
        out.writeBytes(TAG.emClose);
        break;
        
      case 'strongOpen':
        out.writeBytes(TAG.strongOpen);
        break;
        
      case 'strongClose':
        out.writeBytes(TAG.strongClose);
        break;
      case 'strikeOpen':
        out.writeAscii('<del>');
        break;
      case 'strikeClose':
        out.writeAscii('</del>');
        break;
    }
  }
}

/**
 * Renders blocks to HTML string
 */
export async function renderHTMLFromBlocks(u8: Uint8Array, options: ParserOptions = {}): Promise<string> {
  const out = new HtmlArena();
  // Heuristic: output is usually within ~1.2x of input plus tags
  const reserveApprox = (u8.length + (u8.length >>> 2) + 1024) | 0;
  out.reserve(reserveApprox);
  // Lightweight list/bq tracking to add structure around items
  const listStack: ListStackItem[] = [];
  let paraOpen = false;
  let bqDepth = 0;
  let inCode = false;
  let codeBuffer: Array<{ s: number; e: number }> | null = null;
  let codeLang: string | undefined;
  const footnotes: Array<{ idS: number; idE: number; contentS: number; contentE: number }> = [];
  const rawHtmlState: RawHtmlState = { suppressedTag: null };

  const closePara = (): void => {
    if (paraOpen) {
      out.writeBytes(TAG.pClose);
      paraOpen = false;
    }
  };

  const flushCodeBlock = async (): Promise<void> => {
    if (!codeBuffer) return;

    let totalLen = 0;
    for (const span of codeBuffer) {
      totalLen += span.e - span.s;
      totalLen += 1;
    }

    const codeBytes = totalLen > 0 ? new Uint8Array(totalLen) : new Uint8Array(0);

    if (totalLen > 0) {
      let offset = 0;
      for (const span of codeBuffer) {
        const slice = u8.subarray(span.s, span.e);
        codeBytes.set(slice, offset);
        offset += slice.length;
        codeBytes[offset++] = 0x0a;
      }
    }
    const highlighted = await highlightCodeBlock(codeBytes, codeLang);
    out.writeBytes(highlighted);

    codeBuffer = null;
    codeLang = undefined;
  };
  
  const closeListsAll = (): void => {
    while (listStack.length) {
      const top = listStack.pop()!;
      if (top.liOpen) out.writeBytes(TAG.liClose);
      out.writeBytes(top.kind === 'ul' ? TAG.ulClose : TAG.olClose);
    }
  };
  
  const openList = (kind: 'ul' | 'ol'): void => {
    listStack.push({ kind, liOpen: false });
    out.writeBytes(kind === 'ul' ? TAG.ulOpen : TAG.olOpen);
  };
  
  const startLi = (): void => {
    const top = listStack[listStack.length - 1];
    if (!top) return;
    if (top.liOpen) out.writeBytes(TAG.liClose);
    out.writeBytes(TAG.liOpen);
    top.liOpen = true;
  };

  const blockParseOptions = options.allowRawHtml ? { allowRawHtml: true } : undefined;
  for (const ev of blocks(u8, blockParseOptions)) {
    switch (ev.type) {
      case 'bqOpen':
        closePara();
        closeListsAll();
        out.writeBytes(TAG.bqOpen);
        bqDepth++;
        break;

      case 'bqClose':
        closePara();
        closeListsAll();
        out.writeBytes(TAG.bqClose);
        bqDepth = Math.max(0, bqDepth - 1);
        break;

      case 'hr':
        closePara();
        closeListsAll();
        out.writeBytes(TAG.hr);
        break;

      case 'heading':
        closePara();
        closeListsAll();
        out.writeBytes(TAG.hPre[ev.level - 1]);
        renderInline(u8, ev.s, ev.e, out, options, rawHtmlState);
        out.writeBytes(TAG.hClose[ev.level - 1]);
        break;

      case 'listOpen':
        closePara();
        openList(ev.kind);
        break;

      case 'listItem':
        startLi();
        if (ev.task) {
          out.writeAscii('<input type="checkbox" disabled');
          if (ev.checked) out.writeAscii(' checked');
          out.writeAscii('> ');
        }
        renderInline(u8, ev.s, ev.e, out, options, rawHtmlState);
        out.writeBytes(TAG.lf);
        break;

      case 'listClose':
        closePara();
        // Pop until matching kind (blocks() guarantees well-formedness)
        while (listStack.length) {
          const top = listStack.pop()!;
          if (top.liOpen) out.writeBytes(TAG.liClose);
          out.writeBytes(top.kind === 'ul' ? TAG.ulClose : TAG.olClose);
          if (top.kind === ev.kind) break;
        }
        break;

      case 'paraLine':
        if (!paraOpen) {
          closeListsAll();
          out.writeBytes(TAG.pOpen);
          paraOpen = true;
        } else {
          out.writeBytes(TAG.br);
        }
        renderInline(u8, ev.s, ev.e, out, options, rawHtmlState);
        break;

      case 'rawHtmlLine':
        closePara();
        closeListsAll();
        renderRawHtmlLine(u8, ev.s, ev.e, out, options, rawHtmlState);
        out.writeBytes(TAG.lf);
        break;

      case 'codeOpen':
        closePara();
        closeListsAll();
        inCode = true;
        codeBuffer = [];
        codeLang = ev.info?.lang ?? ev.info?.rawLang;
        break;

      case 'codeText':
        if (inCode && codeBuffer) {
          codeBuffer.push({ s: ev.s, e: ev.e });
        }
        break;

      case 'codeClose':
        if (inCode) {
          await flushCodeBlock();
          inCode = false;
        }
        break;

      case 'tableOpen':
        closePara();
        closeListsAll();
        out.writeBytes(TAG.tableOpen);
        break;

      case 'tableHeader':
        out.writeBytes(TAG.theadOpen);
        for (const cell of ev.cells) {
          const thTag = cell.align === 'center' ? TAG.thCenter : 
                        cell.align === 'right' ? TAG.thRight : TAG.thLeft;
          out.writeBytes(thTag);
          renderInline(u8, cell.s, cell.e, out, options, rawHtmlState);
          out.writeBytes(TAG.thClose);
        }
        out.writeBytes(TAG.theadClose);
        break;

      case 'tableRow':
        out.writeBytes(TAG.trOpen);
        for (const cell of ev.cells) {
          out.writeBytes(TAG.tdOpen);
          renderInline(u8, cell.s, cell.e, out, options, rawHtmlState);
          out.writeBytes(TAG.tdClose);
        }
        out.writeBytes(TAG.trClose);
        break;

      case 'tableClose':
        out.writeBytes(TAG.tbodyClose);
        out.writeBytes(TAG.tableClose);
        break;

      case 'infoOpen':
        closePara();
        closeListsAll();
        switch (ev.infoType) {
          case 'info':
            out.writeBytes(TAG.infoBlockInfo);
            break;
          case 'warning':
            out.writeBytes(TAG.infoBlockWarning);
            break;
          case 'error':
            out.writeBytes(TAG.infoBlockError);
            break;
          case 'success':
            out.writeBytes(TAG.infoBlockSuccess);
            break;
        }
        break;

      case 'infoClose':
        closePara();
        out.writeBytes(TAG.infoBlockClose);
        break;

      case 'footnoteDef':
        // Collect footnote definitions to render at the end
        footnotes.push({
          idS: ev.idS,
          idE: ev.idE,
          contentS: ev.contentS,
          contentE: ev.contentE,
        });
        break;
    }
  }

  closePara();
  closeListsAll();
  if (inCode) {
    await flushCodeBlock();
    inCode = false;
  }

  // Render footnotes section if any exist
  if (footnotes.length > 0) {
    out.writeAscii('<div class="footnotes"><hr><ol>');
    for (const fn of footnotes) {
      out.writeAscii('<li id="fn-');
      out.writeEscaped(u8, fn.idS, fn.idE);
      out.writeAscii('">');
      renderInline(u8, fn.contentS, fn.contentE, out, options, rawHtmlState);
      out.writeAscii(' <a href="#fnref-');
      out.writeEscaped(u8, fn.idS, fn.idE);
      out.writeAscii('" class="footnote-backref">');
      out.writeUtf8('↩');
      out.writeAscii('</a></li>');
    }
    out.writeAscii('</ol></div>');
  }

  return out.toString();
}

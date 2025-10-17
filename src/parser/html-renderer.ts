/**
 * HTML renderer - converts parsed blocks and inline tokens to HTML
 */

import { HtmlArena } from './arena';
import { TAG } from './constants';
import { blocks } from './block-parser';
import { inlineTokens } from './inline-parser';
import type { ListStackItem } from './types';
import { highlightCodeBlock } from '../highlight';

/**
 * Renders inline tokens to HTML
 */
function renderInline(
  u8: Uint8Array,
  s: number,
  e: number,
  out: HtmlArena,
): void {
  for (const tok of inlineTokens(u8, s, e)) {
    switch (tok.kind) {
      case 'text':
        out.writeEscaped(u8, tok.s, tok.e);
        break;
        
      case 'code':
        out.writeBytes(TAG.codeOpen);
        out.writeEscaped(u8, tok.s, tok.e);
        out.writeBytes(TAG.codeClose);
        break;
        
      case 'img':
        out.writeBytes(TAG.imgPre);
        out.writeEscaped(u8, tok.altS, tok.altE);
        out.writeBytes(TAG.imgMid);
        // Minimal attribute escaping for URL; percent-encoding left to caller input
        out.writeEscaped(u8, tok.srcS, tok.srcE);
        out.writeBytes(TAG.imgClose);
        break;
        
      case 'link':
        out.writeBytes(TAG.aOpenPre);
        out.writeEscaped(u8, tok.hrefS, tok.hrefE);
        out.writeBytes(TAG.aMid);
        renderInline(u8, tok.textS, tok.textE, out); // Localized pass; no allocations
        out.writeBytes(TAG.aClose);
        break;
        
      case 'autolink':
        out.writeBytes(TAG.aOpenPre);
        if (tok.isWww) out.writeAscii('https://'); // Modern default
        out.writeEscaped(u8, tok.s, tok.e);
        out.writeBytes(TAG.aMid);
        out.writeEscaped(u8, tok.s, tok.e);
        out.writeBytes(TAG.aClose);
        break;
        
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
    }
  }
}

/**
 * Renders blocks to HTML string
 */
export function renderHTMLFromBlocks(u8: Uint8Array): string {
  const out = new HtmlArena();
  // Lightweight list/bq tracking to add structure around items
  const listStack: ListStackItem[] = [];
  let paraOpen = false;
  let bqDepth = 0;
  let inCode = false;
  let codeBuffer: Array<{ s: number; e: number }> | null = null;
  let codeLang: string | undefined;

  const closePara = (): void => {
    if (paraOpen) {
      out.writeBytes(TAG.pClose);
      paraOpen = false;
    }
  };

  const flushCodeBlock = (): void => {
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

    const highlighted = highlightCodeBlock(codeBytes, codeLang);
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

  for (const ev of blocks(u8)) {
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
        renderInline(u8, ev.s, ev.e, out);
        out.writeBytes(TAG.hClose[ev.level - 1]);
        break;

      case 'listOpen':
        closePara();
        openList(ev.kind);
        break;

      case 'listItem':
        startLi();
        renderInline(u8, ev.s, ev.e, out);
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
          out.writeBytes(TAG.lf);
        }
        renderInline(u8, ev.s, ev.e, out);
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
          flushCodeBlock();
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
          renderInline(u8, cell.s, cell.e, out);
          out.writeBytes(TAG.thClose);
        }
        out.writeBytes(TAG.theadClose);
        break;

      case 'tableRow':
        out.writeBytes(TAG.trOpen);
        for (const cell of ev.cells) {
          out.writeBytes(TAG.tdOpen);
          renderInline(u8, cell.s, cell.e, out);
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
    }
  }

  closePara();
  closeListsAll();
  if (inCode) {
    flushCodeBlock();
    inCode = false;
  }

  return out.toString();
}


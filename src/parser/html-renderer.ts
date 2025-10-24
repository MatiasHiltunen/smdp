/**
 * HTML renderer - converts parsed blocks and inline tokens to HTML
 */

import { HtmlArena } from './arena';
import { TAG, TE } from './constants';
import { blocks } from './block-parser';
import { inlineTokens } from './inline-parser';
import type { BlockEvent, ListStackItem } from './types';
import { highlightCodeBlock } from '../highlight';
import type { ParserOptions } from './index';
import { defaultUrlAllowlist, resolveUrlRelativeToBase } from './utils';
import { decodeBlockSection } from './block-serializer';
import { createRenderPipeline } from './render-pipeline';

/**
 * Renders inline tokens to HTML
 */
function renderInline(
  u8: Uint8Array,
  s: number,
  e: number,
  out: HtmlArena,
  options: ParserOptions = {},
): void {
  const urlAllowlist = options.urlAllowlist ?? defaultUrlAllowlist;
  const baseUrl = options.baseUrl;

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
        
      case 'img': {
        out.writeBytes(TAG.imgPre);
        out.writeEscaped(u8, tok.altS, tok.altE);
        out.writeBytes(TAG.imgMid);
        const srcText = new TextDecoder().decode(u8.subarray(tok.srcS, tok.srcE));
        if (urlAllowlist(srcText)) {
          const resolvedSrc = resolveUrlRelativeToBase(srcText, baseUrl);
          if (resolvedSrc !== srcText) {
            const encoded = TE.encode(resolvedSrc);
            out.writeEscaped(encoded, 0, encoded.length);
          } else {
            out.writeEscaped(u8, tok.srcS, tok.srcE);
          }
        }
        out.writeBytes(TAG.imgClose);
        break;
      }

      case 'link': {
        const hrefText = new TextDecoder().decode(u8.subarray(tok.hrefS, tok.hrefE));
        const allowed = urlAllowlist(hrefText);
        if (allowed) {
          out.writeBytes(TAG.aOpenPre);
          const resolvedHref = resolveUrlRelativeToBase(hrefText, baseUrl);
          if (resolvedHref !== hrefText) {
            const encoded = TE.encode(resolvedHref);
            out.writeEscaped(encoded, 0, encoded.length);
          } else {
            out.writeEscaped(u8, tok.hrefS, tok.hrefE);
          }
          out.writeBytes(TAG.aMid);
          renderInline(u8, tok.textS, tok.textE, out, options);
          out.writeBytes(TAG.aClose);
        } else {
          // Fallback to plain text if URL is not allowed
          renderInline(u8, tok.textS, tok.textE, out, options);
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
        // Build effective href span including implicit protocol for www
        const hrefStart = tok.s - (tok.isWww ? 0 : 0);
        const hrefEnd = tok.e;
        const hrefText = tok.isWww ? 'https://' + new TextDecoder().decode(u8.subarray(tok.s, tok.e)) : new TextDecoder().decode(u8.subarray(hrefStart, hrefEnd));
        if (tok.isWww) {
          // Only allow if http(s) when prefixed; we synthesize https://www...
          out.writeBytes(TAG.aOpenPre);
          out.writeAscii('https://');
          out.writeEscaped(u8, tok.s, tok.e);
          out.writeBytes(TAG.aMid);
          out.writeEscaped(u8, tok.s, tok.e);
          out.writeBytes(TAG.aClose);
        } else {
          const allowed = urlAllowlist(hrefText);
          if (allowed) {
            out.writeBytes(TAG.aOpenPre);
            out.writeEscaped(u8, hrefStart, hrefEnd);
            out.writeBytes(TAG.aMid);
            out.writeEscaped(u8, tok.s, tok.e);
            out.writeBytes(TAG.aClose);
          } else {
            out.writeEscaped(u8, tok.s, tok.e);
          }
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
async function renderHTMLFromEventStream(
  u8: Uint8Array,
  events: Iterable<BlockEvent>,
  options: ParserOptions = {},
): Promise<string> {
  const out = new HtmlArena();
  const reserveApprox = (u8.length + (u8.length >>> 2) + 1024) | 0;
  out.reserve(reserveApprox);

  const listStack: ListStackItem[] = [];
  const footnotes: Array<{ idS: number; idE: number; contentS: number; contentE: number }> = [];
  let paraOpen = false;
  let lastParaEnd: number | null = null;
  let blockquoteDepth = 0;
  let inCode = false;
  let codeBuffer: Array<{ s: number; e: number }> | null = null;
  let codeLang: string | undefined;

  const closePara = () => {
    if (paraOpen) {
      out.writeBytes(TAG.pClose);
      paraOpen = false;
    }
    lastParaEnd = null;
  };

  const closeListsAll = () => {
    while (listStack.length) {
      const top = listStack.pop()!;
      if (top.liOpen) out.writeBytes(TAG.liClose);
      out.writeBytes(top.kind === 'ul' ? TAG.ulClose : TAG.olClose);
    }
  };

  const openList = (kind: 'ul' | 'ol') => {
    listStack.push({ kind, liOpen: false });
    out.writeBytes(kind === 'ul' ? TAG.ulOpen : TAG.olOpen);
  };

  const startLi = () => {
    const top = listStack[listStack.length - 1];
    if (!top) return;
    if (top.liOpen) out.writeBytes(TAG.liClose);
    out.writeBytes(TAG.liOpen);
    top.liOpen = true;
  };

  const flushCodeBlock = async () => {
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

  const pipeline = createRenderPipeline([
    {
      bqOpen() {
        closePara();
        closeListsAll();
        out.writeBytes(TAG.bqOpen);
        blockquoteDepth++;
      },
      bqClose() {
        closePara();
        closeListsAll();
        if (blockquoteDepth > 0) {
          out.writeBytes(TAG.bqClose);
          blockquoteDepth--;
        }
      },
      hr() {
        closePara();
        closeListsAll();
        out.writeBytes(TAG.hr);
      },
      heading(ev) {
        closePara();
        closeListsAll();
        out.writeBytes(TAG.hPre[ev.level - 1]);
        renderInline(u8, ev.s, ev.e, out, options);
        out.writeBytes(TAG.hClose[ev.level - 1]);
      },
      listOpen(ev) {
        closePara();
        openList(ev.kind);
      },
      listItem(ev) {
        startLi();
        if (ev.task) {
          out.writeAscii('<input type="checkbox" disabled');
          if (ev.checked) out.writeAscii(' checked');
          out.writeAscii('> ');
        }
        renderInline(u8, ev.s, ev.e, out, options);
        out.writeBytes(TAG.lf);
      },
      listClose(ev) {
        closePara();
        while (listStack.length) {
          const top = listStack.pop()!;
          if (top.liOpen) out.writeBytes(TAG.liClose);
          out.writeBytes(top.kind === 'ul' ? TAG.ulClose : TAG.olClose);
          if (top.kind === ev.kind) break;
        }
      },
      paraLine(ev) {
        if (ev.s === ev.e) {
          closePara();
          return;
        }

        let newlineCount = 0;
        if (lastParaEnd !== null) {
          for (let idx = lastParaEnd; idx < ev.s; idx++) {
            if (u8[idx] === 0x0a) newlineCount++;
          }
        }
        const hasBlankLine = newlineCount >= 2;
        if (hasBlankLine) {
          closePara();
        }

        if (!paraOpen) {
          closeListsAll();
          out.writeBytes(TAG.pOpen);
          paraOpen = true;
        } else if (!hasBlankLine) {
          out.writeBytes(TAG.br);
        }

        renderInline(u8, ev.s, ev.e, out, options);
        lastParaEnd = ev.e;
      },
      codeOpen(ev) {
        closePara();
        closeListsAll();
        inCode = true;
        codeBuffer = [];
        codeLang = ev.info?.lang ?? ev.info?.rawLang;
      },
      codeText(ev) {
        if (inCode && codeBuffer) {
          codeBuffer.push({ s: ev.s, e: ev.e });
        }
      },
      async codeClose() {
        if (inCode) {
          await flushCodeBlock();
          inCode = false;
        }
      },
      tableOpen() {
        closePara();
        closeListsAll();
        out.writeBytes(TAG.tableOpen);
      },
      tableHeader(ev) {
        out.writeBytes(TAG.theadOpen);
        for (const cell of ev.cells) {
          const thTag = cell.align === 'center' ? TAG.thCenter : cell.align === 'right' ? TAG.thRight : TAG.thLeft;
          out.writeBytes(thTag);
          renderInline(u8, cell.s, cell.e, out, options);
          out.writeBytes(TAG.thClose);
        }
        out.writeBytes(TAG.theadClose);
      },
      tableRow(ev) {
        out.writeBytes(TAG.trOpen);
        for (const cell of ev.cells) {
          out.writeBytes(TAG.tdOpen);
          renderInline(u8, cell.s, cell.e, out, options);
          out.writeBytes(TAG.tdClose);
        }
        out.writeBytes(TAG.trClose);
      },
      tableClose() {
        out.writeBytes(TAG.tbodyClose);
        out.writeBytes(TAG.tableClose);
      },
      infoOpen(ev) {
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
      },
      infoClose() {
        closePara();
        out.writeBytes(TAG.infoBlockClose);
      },
      footnoteDef(ev) {
        footnotes.push({
          idS: ev.idS,
          idE: ev.idE,
          contentS: ev.contentS,
          contentE: ev.contentE,
        });
      },
      async finalize() {
        closePara();
        closeListsAll();
        while (blockquoteDepth > 0) {
          out.writeBytes(TAG.bqClose);
          blockquoteDepth--;
        }
        if (inCode) {
          await flushCodeBlock();
          inCode = false;
        }
        if (footnotes.length > 0) {
          out.writeAscii('<div class="footnotes"><hr><ol>');
          for (const fn of footnotes) {
            out.writeAscii('<li id="fn-');
            out.writeEscaped(u8, fn.idS, fn.idE);
            out.writeAscii('">');
            renderInline(u8, fn.contentS, fn.contentE, out, options);
            out.writeAscii(' <a href="#fnref-');
            out.writeEscaped(u8, fn.idS, fn.idE);
            out.writeAscii('" class="footnote-backref">↩</a></li>');
          }
          out.writeAscii('</ol></div>');
        }
      },
    },
  ]);

  await pipeline.run(events, { source: u8 });
  return out.toString();
}
export async function renderHTMLFromBlocks(u8: Uint8Array, options: ParserOptions = {}): Promise<string> {
  return renderHTMLFromEventStream(u8, blocks(u8), options);
}

export async function renderHTMLFromBlockEvents(
  u8: Uint8Array,
  events: Iterable<BlockEvent>,
  options: ParserOptions = {},
): Promise<string> {
  return renderHTMLFromEventStream(u8, events, options);
}

export async function renderHTMLFromSerializedBlocks(
  u8: Uint8Array,
  blockBytes: Uint8Array,
  options: ParserOptions = {},
): Promise<string> {
  const events = decodeBlockSection(blockBytes);
  return renderHTMLFromEventStream(u8, events, options);
}

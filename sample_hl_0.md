```javascript
/*
  Ultra-fast JavaScript tokenizer + syntax highlighter
  ----------------------------------------------------
  • Uint8Array in → HTML string out (no RegExp, single pass)
  • Zero substring allocations while scanning; works on byte spans
  • Context-aware: disambiguates /regex/ vs division, handles template literals
  • Robust numbers (int, float, bigint, binary/oct/hex, underscores), identifiers, keywords
  • Strings (' "), comments (//, /* */), operators/punctuators
  • Emits minimal <span class="tok-…"> only for semantic tokens, raw text for whitespace
  • Arena-style HTML builder for performance (growable Uint8Array)

  Usage:
    const hi = new JSHighlighter();
    const html = hi.highlight(new TextEncoder().encode(source));

  Notes:
    - Designed for C-family languages; tuned for JavaScript/TypeScript-like syntax.
    - No JSX; turn on "allowJSX" option to treat <ident ...> as JSX tags (best-effort).
*/

// ===================== Tiny UTF-8 helpers & arena ============================
const TD = new TextDecoder("utf-8");
const TE = new TextEncoder();

export class HtmlArena {
  constructor(initial = 16384, buf) {
    this.buf = buf instanceof Uint8Array ? buf : new Uint8Array(initial);
    this.len = 0;
  }
  reset() { this.len = 0; }
  ensure(cap) {
    if (cap <= this.buf.length) return;
    let n = this.buf.length || 8; while (n < cap) n = n < (1<<20) ? (n<<1) : (n + (n>>1));
    const nb = new Uint8Array(n); nb.set(this.buf.subarray(0, this.len)); this.buf = nb;
  }
  writeByte(b){ const p=this.len; this.ensure(p+1); this.buf[p]=b; this.len=p+1; }
  writeBytes(u8){ const p=this.len; this.ensure(p+u8.length); this.buf.set(u8,p); this.len=p+u8.length; }
  writeAscii(s){ const p=this.len,n=s.length; this.ensure(p+n); const b=this.buf; let o=p; for(let i=0;i<n;i++) b[o++]=s.charCodeAt(i)&0xFF; this.len=o; }
  writeEscaped(u8,s,e){
    let start=s; for(let i=s;i<e;i++){
      const c=u8[i];
      if(c===0x26||c===0x3C||c===0x3E||c===0x22||c===0x27){
        if(i>start){ const p=this.len; const n=i-start; this.ensure(p+n); this.buf.set(u8.subarray(start,i),p); this.len=p+n; }
        if(c===0x26) this.writeBytes(HtmlArena._AMP); else if(c===0x3C) this.writeBytes(HtmlArena._LT);
        else if(c===0x3E) this.writeBytes(HtmlArena._GT); else if(c===0x22) this.writeBytes(HtmlArena._QUOT);
        else this.writeBytes(HtmlArena._APOS);
        start=i+1;
      }
    }
    if(start<e){ const p=this.len; const n=e-start; this.ensure(p+n); this.buf.set(u8.subarray(start,e),p); this.len=p+n; }
  }
  toString(){ return TD.decode(this.buf.subarray(0,this.len)); }
}
HtmlArena._AMP = TE.encode('&amp;');
HtmlArena._LT  = TE.encode('&lt;');
HtmlArena._GT  = TE.encode('&gt;');
HtmlArena._QUOT= TE.encode('&quot;');
HtmlArena._APOS= TE.encode('&#39;');

// Secondary preallocated arena for rendering (caller-visible HTML). We reuse
// a single instance across highlight() calls to avoid allocations entirely
// once capacity is sufficient.
export class RenderArena extends HtmlArena {}

// ===================== Token kinds & keyword tables ==========================
export const TT = Object.freeze({
  Whitespace: 0,
  Newline: 1,
  Identifier: 2,
  Keyword: 3,
  LiteralNum: 4,
  LiteralStr: 5,
  LiteralTpl: 6,
  Comment: 7,
  Regex: 8,
  Punct: 9,
  Operator: 10
});
export const TT_NAMES = Object.freeze([
  'Whitespace','Newline','Identifier','Keyword','LiteralNum','LiteralStr','LiteralTpl','Comment','Regex','Punct','Operator'
]);

function isKW(u8, s, e) {
  // Decode and lowercase for keyword check (allocates string, but rare)
  const lower = TD.decode(u8.subarray(s, e)).toLowerCase();
  return [KW[lower] || 0, kwHotCode(lower)];
}

// Best-effort JS/TS keywords (kept ASCII, lowercase compare)
const KW = (()=>{
  const list = `break case catch class const continue debugger default delete do else export extends
    finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield
    enum await implements interface package private protected public static as from of`.split(/\s+/);
  const set = Object.create(null); for (const k of list) set[k]=1; return set;
})();

// After which token types a '/' can start a regex literal
function canStartRegex(prevType, prevValCode){
  // prevValCode used for certain keywords like 'return', 'case', 'throw', 'typeof', 'in', 'instanceof', 'delete', 'void', 'new'
  if (prevType == null) return true;
  switch (prevType) {
    case TT.Identifier: case TT.LiteralNum: case TT.LiteralStr: case TT.LiteralTpl: case TT.Regex:
      return false; // expr can’t start regex right after a literal/ident
    case TT.Keyword:
      // keywords that expect an expression next → regex allowed
      switch (prevValCode|0){ // small integer codes for a few hot keywords
        case 1: /*return*/ return true;
        case 2: /*throw*/ return true;
        case 3: /*case*/ return true;
        case 4: /*typeof*/ return true;
        case 5: /*void*/ return true;
        case 6: /*delete*/ return true;
        case 7: /*in*/ return true;
        case 8: /*instanceof*/ return true;
        case 9: /*new*/ return true;
        default: return true; // conservative: allow
      }
    case TT.Punct:
    case TT.Operator:
      return true; // after (, [, {, :, ?, =, +, -, *, %, !, ~, &&, ||, etc
    default:
      return true;
  }
}

function kwHotCode(lower){
  switch(lower){
    case 'return': return 1; case 'throw': return 2; case 'case': return 3; case 'typeof': return 4;
    case 'void': return 5; case 'delete': return 6; case 'in': return 7; case 'instanceof': return 8; case 'new': return 9;
    default: return 0;
  }
}

// ===================== Character helpers (ASCII hot path) ====================
function isWS(c){ return c===0x20 || c===0x09 || c===0x0B || c===0x0C; }
function isNL(c){ return c===0x0A || c===0x0D; }
function isDigit(c){ return c>=0x30 && c<=0x39; }
function isHex(c){ return (c>=0x30&&c<=0x39)||(c>=0x41&&c<=0x46)||(c>=0x61&&c<=0x66); }
function isBin(c){ return c===0x30||c===0x31; }
function isOct(c){ return c>=0x30 && c<=0x37; }
function isIdentStart(c){ return (c===0x24||c===0x5F)|| // $ _
  (c>=0x41&&c<=0x5A)||(c>=0x61&&c<=0x7A); } // ASCII letter
function isIdentPart(c){ return isIdentStart(c)||isDigit(c); }

// ===================== Tokenizer =============================================
export class JSTokenizer {
  constructor(opts){ this.opts = Object.assign({ allowJSX:false }, opts||{}); }

  tokenize(u8, emit){
    const n = u8.length; let i = 0;
    let prevType = null, prevKwCode = 0;
    const push = (type, s, e, meta)=>{ emit(type, s, e, meta); prevKwCode = (type===TT.Keyword ? (meta|0) : 0); prevType = type; };

    if (i+1<n && u8[0]===0x23 && u8[1]===0x21){ let j=2; while(j<n && !isNL(u8[j])) j++; push(TT.Comment, 0, j); i=j; }

    while (i < n){
      const c = u8[i];
      if (isWS(c)) { let s=i; do{i++;}while(i<n && isWS(u8[i])); push(TT.Whitespace,s,i); continue; }
      if (isNL(c)) { let s=i; if (c===0x0D && i+1<n && u8[i+1]===0x0A) i+=2; else i++; push(TT.Newline, s, i); continue; }

      if (isIdentStart(c) || (c===0x5C && i+1<n && u8[i+1]===0x75)){
        let s=i; i++;
        for(;;){ if (i>=n) break; const d=u8[i]; if (isIdentPart(d)) { i++; continue; }
          if (d===0x5C && i+1<n && u8[i+1]===0x75){ i+=2; let k=0; while(i<n && isHex(u8[i]) && k<6){ i++; k++; } continue; }
          break; }
        const [kw, code] = isKW(u8,s,i);
        push(kw?TT.Keyword:TT.Identifier, s, i, code);
        continue;
      }

      if (isDigit(c) || (c===0x2E && i+1<n && isDigit(u8[i+1]))){
        let s=i; if (c===0x30 && i+1<n && (u8[i+1]===0x78||u8[i+1]===0x58)){ i+=2; while(i<n && (isHex(u8[i])||u8[i]===0x5F)) i++; }
        else if (c===0x30 && i+1<n && (u8[i+1]===0x62||u8[i+1]===0x42)){ i+=2; while(i<n && (isBin(u8[i])||u8[i]===0x5F)) i++; }
        else if (c===0x30 && i+1<n && (u8[i+1]===0x6F||u8[i+1]===0x4F)){ i+=2; while(i<n && (isOct(u8[i])||u8[i]===0x5F)) i++; }
        else { while(i<n && (isDigit(u8[i])||u8[i]===0x5F)) i++; if (i<n && u8[i]===0x2E){ i++; while(i<n && (isDigit(u8[i])||u8[i]===0x5F)) i++; }
          if (i<n && (u8[i]===0x65||u8[i]===0x45)){ let j=i+1; if (j<n && (u8[j]===0x2B||u8[j]===0x2D)) j++; if (j<n && isDigit(u8[j])){ i=j+1; while(i<n && (isDigit(u8[i])||u8[i]===0x5F)) i++; } }
        }
        if (i<n && u8[i]===0x6E) i++; // bigint n
        push(TT.LiteralNum, s, i); continue;
      }

      if (c===0x27 || c===0x22){ let s=i; const quote=c; i++; while(i<n){ const d=u8[i++]; if (d===quote) break; if (d===0x5C && i<n) i++; if (isNL(d)) break; } push(TT.LiteralStr, s, i); continue; }

      if (c===0x60){ let s=i; i++; while(i<n){ const d=u8[i++]; if (d===0x60) break; if (d===0x5C && i<n){ i++; continue; } if (d===0x24 && i<n && u8[i]===0x7B){
            let bal=1; i++; while(i<n && bal>0){ const x=u8[i++]; if (x===0x27||x===0x22){ const q=x; while(i<n){ const y=u8[i++]; if(y===q) break; if(y===0x5C && i<n) i++; if (isNL(y)) break; } }
              else if (x===0x60){ break; } else if (x===0x2F){ if (i<n){ const y=u8[i]; if (y===0x2F){ while(i<n && !isNL(u8[i])) i++; } else if (y===0x2A){ i++; while(i+1<n && !(u8[i]===0x2A && u8[i+1]===0x2F)) i++; i+=2; } } }
              else if (x===0x7B) bal++; else if (x===0x7D) bal--; }
          } }
        push(TT.LiteralTpl, s, i); continue; }

      if (c===0x2F){ if (i+1<n){ const d=u8[i+1]; if (d===0x2F){ let s=i; i+=2; while(i<n && !isNL(u8[i])) i++; push(TT.Comment, s, i); continue; }
          if (d===0x2A){ let s=i; i+=2; while(i+1<n && !(u8[i]===0x2A && u8[i+1]===0x2F)) i++; i=Math.min(n,i+2); push(TT.Comment, s, i); continue; }
          if (canStartRegex(prevType, prevKwCode)){ let s=i; i++; let inClass=false; while(i<n){ const x=u8[i++]; if (x===0x5C){ if(i<n) i++; continue; } if (x===0x5B){ inClass=true; continue; } if (x===0x5D){ inClass=false; continue; } if (x===0x2F && !inClass){ break; } if (isNL(x)) break; } while(i<n){ const f=u8[i]; if ((f>=0x61&&f<=0x7A)||(f>=0x41&&f<=0x5A)) i++; else break; } push(TT.Regex, s, i); continue; } }
        let s=i; i++; if (i<n && u8[i]===0x3D) i++; push(TT.Operator, s, i); continue; }

      { let s=i; const ch=c; i++; const n1=(i<n)?u8[i]:0, n2=(i+1<n)?u8[i+1]:0; const two=(ch<<8)|n1, three=(two<<8)|n2;
        if (three===0x3D3D3D || three===0x213D3D || three===0x3E3E3E || three===0x3E3E3D || three===0x3C3C3D){ i+=2; push(TT.Operator,s,i); continue; }
        if (two===0x2B2B||two===0x2D2D||two===0x3D3D||two===0x213D||two===0x2626||two===0x7C7C||two===0x2A3D||two===0x2F3D||two===0x253D||two===0x2B3D||two===0x2D3D||two===0x263D||two===0x7C3D||two===0x5E3D||two===0x3C3C||two===0x3E3E||two===0x3F3A||two===0x2E2E||two===0x3D3E){ i++; push(TT.Operator,s,i); continue; }
        const punct = (ch===0x28||ch===0x29||ch===0x5B||ch===0x5D||ch===0x7B||ch===0x7D||ch===0x2C||ch===0x3B||ch===0x3A||ch===0x2E);
        push(punct?TT.Punct:TT.Operator, s, i); continue; }
    }
  }

  *tokens(u8){
    const out = [];
    const push = (type,s,e,meta)=>{ out.push([type,s,e,meta]); };
    this.tokenize(u8, push);
    for (let i=0;i<out.length;i++) yield out[i];
  }
}

// ===================== Highlighter (tokens → HTML) ===========================
const SpanBytes = (()=>{
  const te = (s)=>TE.encode(s);
  const open = (cls)=>te('<span class="'+cls+'">');
  return {
    preOpen: te('<pre class="code"><code>'), preClose: te('</code></pre>'),
    // classes kept tiny and BEM-like for perf
    kw: open('tok-kw'), id: open('tok-id'), num: open('tok-num'), str: open('tok-str'), tpl: open('tok-tpl'), com: open('tok-com'), rx: open('tok-rx'), op: open('tok-op'), p: open('tok-p'), close: te('</span>')
  };
})();

export class JSHighlighter {
  constructor(opts){
    this.opts = Object.assign({ initialHtmlCap: 1<<16 }, opts||{});
    // Preallocate a second buffer (HTML bytes) and reuse it across calls
    this.out = new RenderArena(this.opts.initialHtmlCap, this.opts.htmlBuffer);
    this.tok = new JSTokenizer(opts);
  }

  // Reuses the preallocated render arena to minimize allocations.
  highlight(u8){
    const out = this.out; out.reset();
    out.writeBytes(SpanBytes.preOpen);
    const emit = (type,s,e,meta)=>{
      switch(type){
        case TT.Whitespace: out.writeEscaped(u8,s,e); return;
        case TT.Newline: out.writeByte(0x0A); return;
        case TT.Identifier: out.writeBytes(SpanBytes.id); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.Keyword: out.writeBytes(SpanBytes.kw); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.LiteralNum: out.writeBytes(SpanBytes.num); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.LiteralStr: out.writeBytes(SpanBytes.str); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.LiteralTpl: out.writeBytes(SpanBytes.tpl); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.Comment: out.writeBytes(SpanBytes.com); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.Regex: out.writeBytes(SpanBytes.rx); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.Punct: out.writeBytes(SpanBytes.p); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.Operator: out.writeBytes(SpanBytes.op); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        default: out.writeEscaped(u8,s,e); return;
      }
    };
    this.tok.tokenize(u8, emit);
    out.writeBytes(SpanBytes.preClose);
    return out.toString();
  }

  // Streaming generator: yields HTML chunks as strings, reusing the preallocated buffer
  *highlightChunks(u8, chunkSize = 1 << 16){
    const out = this.out; out.reset();
    const flush = () => {
      if (out.len === 0) return null;
      const s = TD.decode(out.buf.subarray(0, out.len));
      out.len = 0; // reuse buffer
      return s;
    };

    out.writeBytes(SpanBytes.preOpen);
    if (out.len >= chunkSize) { const chunk = flush(); if (chunk) yield chunk; }

    const emitToken = (type,s,e)=>{
      switch(type){
        case TT.Whitespace: out.writeEscaped(u8,s,e); break;
        case TT.Newline: out.writeByte(0x0A); break;
        case TT.Identifier: out.writeBytes(SpanBytes.id); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Keyword: out.writeBytes(SpanBytes.kw); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.LiteralNum: out.writeBytes(SpanBytes.num); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.LiteralStr: out.writeBytes(SpanBytes.str); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.LiteralTpl: out.writeBytes(SpanBytes.tpl); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Comment: out.writeBytes(SpanBytes.com); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Regex: out.writeBytes(SpanBytes.rx); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Punct: out.writeBytes(SpanBytes.p); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Operator: out.writeBytes(SpanBytes.op); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        default: out.writeEscaped(u8,s,e); break;
      }
    };

    for (const [type,s,e,meta] of this.tok.tokens(u8)){
      emitToken(type,s,e,meta);
      if (out.len >= chunkSize){ const chunk = flush(); if (chunk) yield chunk; }
    }

    out.writeBytes(SpanBytes.preClose);
    const tail = flush(); if (tail) yield tail;
  }

  // Async generator wrapper for convenience
  async *highlightChunksAsync(u8, chunkSize = 1 << 16){
    for (const chunk of this.highlightChunks(u8, chunkSize)) {
      yield chunk;
    }
  }

  // === Byte-oriented streaming variants ===
  // 1) Generator that yields Uint8Array *copies* for each chunk (stable across calls)
  *highlightChunksBytes(u8, chunkSize = 1 << 16){
    const out = this.out; out.reset();
    const flushBytes = () => {
      if (out.len === 0) return null;
      const copy = new Uint8Array(out.len);
      copy.set(out.buf.subarray(0, out.len));
      out.len = 0; // reuse backing store
      return copy;
    };

    out.writeBytes(SpanBytes.preOpen);
    if (out.len >= chunkSize) { const c = flushBytes(); if (c) yield c; }

    const emitToken = (type,s,e)=>{
      switch(type){
        case TT.Whitespace: out.writeEscaped(u8,s,e); break;
        case TT.Newline: out.writeByte(0x0A); break;
        case TT.Identifier: out.writeBytes(SpanBytes.id); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Keyword: out.writeBytes(SpanBytes.kw); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.LiteralNum: out.writeBytes(SpanBytes.num); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.LiteralStr: out.writeBytes(SpanBytes.str); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.LiteralTpl: out.writeBytes(SpanBytes.tpl); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Comment: out.writeBytes(SpanBytes.com); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Regex: out.writeBytes(SpanBytes.rx); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Punct: out.writeBytes(SpanBytes.p); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Operator: out.writeBytes(SpanBytes.op); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        default: out.writeEscaped(u8,s,e); break;
      }
    };

    for (const [type,s,e,meta] of this.tok.tokens(u8)){
      emitToken(type,s,e,meta);
      if (out.len >= chunkSize){ const c = flushBytes(); if (c) yield c; }
    }

    out.writeBytes(SpanBytes.preClose);
    const tail = flushBytes(); if (tail) yield tail;
  }

  // 2) Zero-copy callback streaming: hands a *view* into the internal buffer.
  //    The view is valid only until the next callback invocation.
  //    This avoids copying entirely if the consumer synchronously processes chunks.
  highlightStream(u8, onChunk, chunkSize = 1 << 16){
    const out = this.out; out.reset();
    const flushView = () => {
      if (out.len === 0) return;
      onChunk(out.buf.subarray(0, out.len));
      out.len = 0;
    };

    out.writeBytes(SpanBytes.preOpen);
    if (out.len >= chunkSize) flushView();

    const emitToken = (type,s,e)=>{
      switch(type){
        case TT.Whitespace: out.writeEscaped(u8,s,e); break;
        case TT.Newline: out.writeByte(0x0A); break;
        case TT.Identifier: out.writeBytes(SpanBytes.id); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Keyword: out.writeBytes(SpanBytes.kw); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.LiteralNum: out.writeBytes(SpanBytes.num); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.LiteralStr: out.writeBytes(SpanBytes.str); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.LiteralTpl: out.writeBytes(SpanBytes.tpl); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Comment: out.writeBytes(SpanBytes.com); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Regex: out.writeBytes(SpanBytes.rx); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Punct: out.writeBytes(SpanBytes.p); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        case TT.Operator: out.writeBytes(SpanBytes.op); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
        default: out.writeEscaped(u8,s,e); break;
      }
      if (out.len >= chunkSize) flushView();
    };

    for (const [type,s,e,meta] of this.tok.tokens(u8)) emitToken(type,s,e,meta);

    out.writeBytes(SpanBytes.preClose);
    flushView();
  }
}

// ===================== Convenience export ====================================
export function u8(s){ return TE.encode(s); }
// ESM build — import from your bundler or Node with "type": "module" in package.json.

// ===================== Web Streams / Node adapters ==========================
export function highlightReadableStream(hi, srcU8, { bytes = true, chunkSize = 1 << 16 } = {}){
  // Returns a Web ReadableStream that emits Uint8Array (bytes=true) or strings
  return new ReadableStream({
    start(controller){
      try {
        const iter = bytes ? hi.highlightChunksBytes(srcU8, chunkSize)
                           : hi.highlightChunks(srcU8, chunkSize);
        for (const chunk of iter){ controller.enqueue(chunk); }
        controller.close();
      } catch (err){ controller.error(err); }
    }
  });
}

export async function highlightNodeReadable(hi, srcU8, { bytes = true, chunkSize = 1 << 16 } = {}){
  // Dynamically import node:stream to keep this file browser-friendly
  const { Readable } = await import('node:stream');
  // Wrap sync generator with Readable.from
  const gen = bytes ? hi.highlightChunksBytes(srcU8, chunkSize)
                    : hi.highlightChunks(srcU8, chunkSize);
  return Readable.from(gen);
}

export async function highlightToWritableStream(hi, srcU8, writable, { bytes = true, chunkSize = 1 << 16 } = {}){
  // Writes to a Web WritableStream (streams API). Returns when complete.
  const writer = writable.getWriter();
  try {
    if (bytes){
      for (const u of hi.highlightChunksBytes(srcU8, chunkSize)){
        await writer.write(u);
      }
    } else {
      for (const s of hi.highlightChunks(srcU8, chunkSize)){
        await writer.write(s);
      }
    }
  } finally {
    await writer.close();
  }
}

// ===================== Transform streams (Web & Node) ========================
// Web TransformStream factory: accepts raw JS/TS source chunks (Uint8Array or string)
// and emits highlighted HTML chunks on close.
export function createHighlightTransform(hi, { inputBytes = true, outputBytes = true, chunkSize = 1 << 16 } = {}){
  const chunks = [];
  return new TransformStream({
    transform(chunk, controller){
      chunks.push(chunk);
    },
    flush(controller){
      try {
        let srcU8;
        if (inputBytes){
          // Concat Uint8Array chunks
          let total = 0; for (const c of chunks) total += c.byteLength;
          srcU8 = new Uint8Array(total); let off = 0; for (const c of chunks){ srcU8.set(c, off); off += c.byteLength; }
        } else {
          const text = chunks.join('');
          srcU8 = TE.encode(text);
        }
        if (outputBytes){
          for (const u of hi.highlightChunksBytes(srcU8, chunkSize)) controller.enqueue(u);
        } else {
          for (const s of hi.highlightChunks(srcU8, chunkSize)) controller.enqueue(s);
        }
      } catch (e){ controller.error(e); }
    }
  });
}

// Web Token Transform: emits tokens instead of HTML (object mode via WHATWG streams)
// Options: includeText (false by default) to attach decoded text; beware of allocations.
export function createTokenTransform({ bytesIn = true, includeText = false } = {}){
  const tok = new IncrementalJSTokenizer();
  const st = new JSTokenizerState();
  return new TransformStream({
    transform(chunk, controller){
      const u8 = bytesIn ? (chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)) : TE.encode(chunk);
      tok.tokenizeChunk(u8, st, (type,s,e)=>{
        const obj = { type, typeName: TT_NAMES[type], start: s, end: e };
        if (includeText) obj.text = TD.decode(u8.subarray(s,e));
        controller.enqueue(obj);
      });
    }
  });
}

// --- Incremental (stateful) tokenizer + streaming highlighter ----------------
export class JSTokenizerState {
  constructor(){
    this.prevType = null; this.prevKwCode = 0;
    this.mode = 'base'; // 'base'|'string'|'tpl'|'tplExpr'|'regex'|'lineCom'|'blockCom'
    this.quote = 0; // 0x27 or 0x22 when in string
    this.tplBrace = 0; // brace depth inside ${...}
    this.rxInClass = false; // [ ... ] inside regex
  }
}

export class IncrementalJSTokenizer extends JSTokenizer {
  tokenizeChunk(u8, st, emit){
    const n = u8.length; let i = 0;
    const push = (type, s, e, meta)=>{ emit(type, s, e, meta); st.prevKwCode = (type===TT.Keyword ? (meta|0) : 0); st.prevType = type; };

    while (i < n){
      // Handle continuation modes first
      if (st.mode === 'lineCom'){
        const s=i; while(i<n && !isNL(u8[i])) i++; push(TT.Comment, s, i); st.mode='base'; if (i<n && isNL(u8[i])) { const s2=i; if (u8[i]===0x0D&&i+1<n&&u8[i+1]===0x0A) i+=2; else i++; push(TT.Newline,s2,i); } continue;
      }
      if (st.mode === 'blockCom'){
        const s=i; while(i+1<n && !(u8[i]===0x2A && u8[i+1]===0x2F)) i++; if (i+1<n){ i+=2; push(TT.Comment,s,i); st.mode='base'; } else { push(TT.Comment,s,i); return; }
        continue;
      }
      if (st.mode === 'string'){
        const s=i; while(i<n){ const d=u8[i++]; if (d===st.quote){ push(TT.LiteralStr, s-1, i); st.mode='base'; break; } if (d===0x5C && i<n) i++; if (isNL(d)) break; }
        if (st.mode==='string'){ // unterminated, continue in next chunk
          push(TT.LiteralStr, s-1, i); return;
        }
        continue;
      }
      if (st.mode === 'regex'){
        const s=i-1; // we entered after '/'
        while(i<n){ const x=u8[i++]; if (x===0x5C){ if(i<n) i++; continue; } if (x===0x5B){ st.rxInClass=true; continue; } if (x===0x5D){ st.rxInClass=false; continue; } if (x===0x2F && !st.rxInClass){ break; } if (isNL(x)) break; }
        while(i<n){ const f=u8[i]; if ((f>=0x61&&f<=0x7A)||(f>=0x41&&f<=0x5A)) i++; else break; }
        push(TT.Regex, s, i); st.mode='base'; continue;
      }
      if (st.mode === 'tpl'){
        const s=i; while(i<n){ const d=u8[i++]; if (d===0x60){ push(TT.LiteralTpl, s-1, i); st.mode='base'; break; } if (d===0x5C && i<n){ i++; continue; } if (d===0x24 && i<n && u8[i]===0x7B){ // ${
            push(TT.LiteralTpl, s-1, i+1); st.mode='tplExpr'; st.tplBrace=1; break; }
        }
        if (st.mode==='tpl'){ push(TT.LiteralTpl, s-1, i); return; }
        continue;
      }
      if (st.mode === 'tplExpr'){
        // parse JS until matching }
        let s=i; let emitted=false;
        while(i<n && st.tplBrace>0){
          const x=u8[i++];
          if (x===0x27||x===0x22){ // skip quoted in expr
            const q=x; while(i<n){ const y=u8[i++]; if (y===q) break; if (y===0x5C && i<n) i++; if (isNL(y)) break; }
            continue;
          }
          if (x===0x2F){ // comment or regex: fallback to base tokenizer for safety
            i--;
            // fallthrough to base scanning
            break;
          }
          if (x===0x7B) st.tplBrace++; else if (x===0x7D) st.tplBrace--;
        }
        // do nothing special for inside; resume base
        st.mode = st.tplBrace>0 ? 'tplExpr' : 'base';
        continue;
      }

      // Base mode scanning (subset of full tokenizer)
      const c = u8[i];
      // whitespace/newline
      if (isWS(c)){ let s=i; do{i++;}while(i<n && isWS(u8[i])); push(TT.Whitespace,s,i); continue; }
      if (isNL(c)){ let s=i; if (c===0x0D&&i+1<n&&u8[i+1]===0x0A) i+=2; else i++; push(TT.Newline,s,i); continue; }

      // identifiers/keywords
      if (isIdentStart(c) || (c===0x5C && i+1<n && u8[i+1]===0x75)){
        let s=i; i++; for(;;){ if (i>=n) break; const d=u8[i]; if (isIdentPart(d)) { i++; continue; } if (d===0x5C && i+1<n && u8[i+1]===0x75){ i+=2; let k=0; while(i<n && isHex(u8[i]) && k<6){ i++; k++; } continue; } break; }
        const [kw, code] = isKW(u8,s,i); push(kw?TT.Keyword:TT.Identifier, s, i, code); continue;
      }

      // numbers
      if (isDigit(c) || (c===0x2E && i+1<n && isDigit(u8[i+1]))){
        let s=i; if (c===0x30 && i+1<n && (u8[i+1]===0x78||u8[i+1]===0x58)){ i+=2; while(i<n && (isHex(u8[i])||u8[i]===0x5F)) i++; }
        else if (c===0x30 && i+1<n && (u8[i+1]===0x62||u8[i+1]===0x42)){ i+=2; while(i<n && (isBin(u8[i])||u8[i]===0x5F)) i++; }
        else if (c===0x30 && i+1<n && (u8[i+1]===0x6F||u8[i+1]===0x4F)){ i+=2; while(i<n && (isOct(u8[i])||u8[i]===0x5F)) i++; }
        else { while(i<n && (isDigit(u8[i])||u8[i]===0x5F)) i++; if (i<n && u8[i]===0x2E){ i++; while(i<n && (isDigit(u8[i])||u8[i]===0x5F)) i++; } if (i<n && (u8[i]===0x65||u8[i]===0x45)){ let j=i+1; if (j<n && (u8[j]===0x2B||u8[j]===0x2D)) j++; if (j<n && isDigit(u8[j])){ i=j+1; while(i<n && (isDigit(u8[i])||u8[i]===0x5F)) i++; } } }
        if (i<n && u8[i]===0x6E) i++; push(TT.LiteralNum, s, i); continue;
      }

      // strings start
      if (c===0x27 || c===0x22){ st.mode='string'; st.quote=c; const s=i+1; i++; continue; }

      // template start
      if (c===0x60){ st.mode='tpl'; const s=i+1; i++; continue; }

      // comments / regex / operators
      if (c===0x2F){ if (i+1<n){ const d=u8[i+1]; if (d===0x2F){ st.mode='lineCom'; i+=2; continue; } if (d===0x2A){ st.mode='blockCom'; i+=2; continue; } if (canStartRegex(st.prevType)){ st.mode='regex'; i+=1; st.rxInClass=false; continue; } }
        // operator '/' or '/='
        let s=i; i++; if (i<n && u8[i]===0x3D) i++; push(TT.Operator,s,i); continue; }

      // punct/operator fallback
      { let s=i; const ch=c; i++; const n1=(i<n)?u8[i]:0, n2=(i+1<n)?u8[i+1]:0; const two=(ch<<8)|n1, three=(two<<8)|n2;
        if (three===0x3D3D3D || three===0x213D3D || three===0x3E3E3E || three===0x3E3E3D || three===0x3C3C3D){ i+=2; push(TT.Operator,s,i); continue; }
        if (two===0x2B2B||two===0x2D2D||two===0x3D3D||two===0x213D||two===0x2626||two===0x7C7C||two===0x2A3D||two===0x2F3D||two===0x253D||two===0x2B3D||two===0x2D3D||two===0x263D||two===0x7C3D||two===0x5E3D||two===0x3C3C||two===0x3E3E||two===0x3F3A||two===0x2E2E||two===0x3D3E){ i++; push(TT.Operator,s,i); continue; }
        const punct=(ch===0x28||ch===0x29||ch===0x5B||ch===0x5D||ch===0x7B||ch===0x7D||ch===0x2C||ch===0x3B||ch===0x3A||ch===0x2E); push(punct?TT.Punct:TT.Operator,s,i); continue; }
    }
  }
}

// Incremental highlight TransformStream: no full buffering; maintains tokenizer state across chunks.
export function createHighlightIncrementalTransform({ bytesIn=true, bytesOut=true, chunkSize=1<<16 } = {}){
  const tok = new IncrementalJSTokenizer();
  const hi = new JSHighlighter({ initialHtmlCap: chunkSize<<1 });
  const st = new JSTokenizerState();
  let started=false;
  const writeToken = (out, u8, type, s, e) => {
    switch(type){
      case TT.Whitespace: out.writeEscaped(u8,s,e); break;
      case TT.Newline: out.writeByte(0x0A); break;
      case TT.Identifier: out.writeBytes(SpanBytes.id); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
      case TT.Keyword: out.writeBytes(SpanBytes.kw); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
      case TT.LiteralNum: out.writeBytes(SpanBytes.num); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
      case TT.LiteralStr: out.writeBytes(SpanBytes.str); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
      case TT.LiteralTpl: out.writeBytes(SpanBytes.tpl); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
      case TT.Comment: out.writeBytes(SpanBytes.com); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
      case TT.Regex: out.writeBytes(SpanBytes.rx); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
      case TT.Punct: out.writeBytes(SpanBytes.p); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
      case TT.Operator: out.writeBytes(SpanBytes.op); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
      default: out.writeEscaped(u8,s,e); break;
    }
  };
  const flushFromArena = (out, controller, asBytes) => {
    if (out.len===0) return;
    if (asBytes){ controller.enqueue(out.buf.subarray(0,out.len).slice()); }
    else { controller.enqueue(TD.decode(out.buf.subarray(0,out.len))); }
    out.len=0;
  };
  return new TransformStream({
    transform(chunk, controller){
      const u8 = bytesIn ? (chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)) : TE.encode(chunk);
      const out = hi.out; if (!started){ out.reset(); out.writeBytes(SpanBytes.preOpen); started=true; }
      tok.tokenizeChunk(u8, st, (type,s,e,meta)=>{ writeToken(out, u8, type, s, e); if (out.len >= chunkSize) flushFromArena(out, controller, bytesOut); });
    },
    flush(controller){
      const out = hi.out; out.writeBytes(SpanBytes.preClose); flushFromArena(out, controller, bytesOut);
    }
  });
}

// Node incremental Transform: uses the Web variant via stream.Readable/Writable wrappers
export async function createNodeHighlightIncrementalTransform(opts){
  const { Transform } = await import('node:stream/web');
  const ts = createHighlightIncrementalTransform(opts);
  return ts;
}

// Node token transform (classic stream.Transform in objectMode)
export async function createNodeTokenIncrementalTransform({ bytesIn = true, includeText = false } = {}){
  const { Transform } = await import('node:stream');
  const tok = new IncrementalJSTokenizer();
  const st = new JSTokenizerState();
  return new Transform({ readableObjectMode: true, writableObjectMode: !bytesIn,
    transform(chunk, enc, cb){
      try {
        const u8 = bytesIn ? (chunk instanceof Uint8Array ? chunk : Buffer.isBuffer(chunk) ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) : new Uint8Array(chunk))
                           : TE.encode(typeof chunk === 'string' ? chunk : String(chunk));
        tok.tokenizeChunk(u8, st, (type,s,e)=>{
          const obj = { type, typeName: TT_NAMES[type], start: s, end: e };
          if (includeText) obj.text = TD.decode(u8.subarray(s,e));
          this.push(obj);
        });
        cb();
      } catch(e){ cb(e); }
    }
  });
}

// Classic Node stream.Transform (incremental) — emits HTML chunks (Buffer or string)
export async function createNodeHighlightIncrementalNodeTransform({ bytesIn = true, bytesOut = true, chunkSize = 1 << 16 } = {}){
  const { Transform } = await import('node:stream');
  const tok = new IncrementalJSTokenizer();
  const st = new JSTokenizerState();
  const hi = new JSHighlighter({ initialHtmlCap: chunkSize << 1 });
  return new Transform({ readableObjectMode: !bytesOut, writableObjectMode: !bytesIn,
    transform(chunk, enc, cb){
      try {
        const u8 = bytesIn ? (chunk instanceof Uint8Array ? chunk : Buffer.isBuffer(chunk) ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) : new Uint8Array(chunk))
                           : TE.encode(typeof chunk === 'string' ? chunk : String(chunk));
        const out = hi.out;
        if (out.len === 0) out.writeBytes(SpanBytes.preOpen);
        tok.tokenizeChunk(u8, st, (type,s,e)=>{
          // write token into arena
          switch(type){
            case TT.Whitespace: out.writeEscaped(u8,s,e); break;
            case TT.Newline: out.writeByte(0x0A); break;
            case TT.Identifier: out.writeBytes(SpanBytes.id); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
            case TT.Keyword: out.writeBytes(SpanBytes.kw); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
            case TT.LiteralNum: out.writeBytes(SpanBytes.num); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
            case TT.LiteralStr: out.writeBytes(SpanBytes.str); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
            case TT.LiteralTpl: out.writeBytes(SpanBytes.tpl); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
            case TT.Comment: out.writeBytes(SpanBytes.com); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
            case TT.Regex: out.writeBytes(SpanBytes.rx); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
            case TT.Punct: out.writeBytes(SpanBytes.p); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
            case TT.Operator: out.writeBytes(SpanBytes.op); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); break;
            default: out.writeEscaped(u8,s,e); break;
          }
          if (out.len >= chunkSize){
            if (bytesOut){ this.push(Buffer.from(out.buf.subarray(0,out.len))); }
            else { this.push(TD.decode(out.buf.subarray(0,out.len))); }
            out.len = 0;
          }
        });
        cb();
      } catch(e){ cb(e); }
    },
    flush(cb){
      try {
        const out = hi.out; out.writeBytes(SpanBytes.preClose);
        if (out.len){ if (bytesOut){ this.push(Buffer.from(out.buf.subarray(0,out.len))); } else { this.push(TD.decode(out.buf.subarray(0,out.len))); } out.len = 0; }
        cb();
      } catch(e){ cb(e); }
    }
  });
}

// (existing non-incremental Node Transform remains available)
export async function createNodeHighlightTransform(hi, { inputBytes = true, outputBytes = true, chunkSize = 1 << 16 } = {}){
  const { Transform } = await import('node:stream');
  const bufs = [];
  return new Transform({ readableObjectMode: false, writableObjectMode: false,
    transform(chunk, enc, cb){ try { bufs.push(chunk); cb(); } catch(e){ cb(e); } },
    flush(cb){
      try {
        let srcU8;
        if (inputBytes){
          const total = bufs.reduce((n,b)=> n + b.length, 0);
          srcU8 = new Uint8Array(total);
          let off = 0; for (const b of bufs){ srcU8.set(b instanceof Uint8Array ? b : new Uint8Array(b.buffer, b.byteOffset, b.length), off); off += b.length; }
        } else {
          const text = bufs.map(b=> b.toString()).join('');
          srcU8 = TE.encode(text);
        }
        if (outputBytes){
          for (const u of hi.highlightChunksBytes(srcU8, chunkSize)) this.push(Buffer.from(u.buffer, u.byteOffset, u.byteLength));
        } else {
          for (const s of hi.highlightChunks(srcU8, chunkSize)) this.push(s);
        }
        cb();
      } catch(e){ cb(e); }
    }
  });
}

if (typeof window !== 'undefined') { window.JSTokenizer = JSTokenizer; window.JSHighlighter = JSHighlighter; window.JS_TT = TT; }

// ===================== Generic ultra-fast highlighter core ===================
// Goal: zero RegExp, single-pass scanning, language pluggable via a spec.
// The core drives byte-by-byte scanning and delegates language-specific bits.

export class ByteArena {
  constructor(initial = 16384, buf){ this.buf = buf instanceof Uint8Array ? buf : new Uint8Array(initial); this.len = 0; }
  reset(){ this.len = 0; }
  ensure(cap){ if (cap <= this.buf.length) return; let n = this.buf.length || 8; while(n < cap) n = n < (1<<20) ? (n<<1) : (n + (n>>1)); const nb = new Uint8Array(n); nb.set(this.buf.subarray(0,this.len)); this.buf = nb; }
  writeByte(b){ const p=this.len; this.ensure(p+1); this.buf[p]=b; this.len=p+1; }
  writeBytes(u8){ const p=this.len; this.ensure(p+u8.length); this.buf.set(u8,p); this.len=p+u8.length; }
  writeEscaped(u8,s,e){ HtmlArena.prototype.writeEscaped.call(this, u8, s, e); }
}

export const CoreTT = TT; // reuse token types
export const CoreTT_NAMES = TT_NAMES;

// LanguageSpec: define only what differs; core supplies defaults.
export class LanguageSpec {
  constructor(name){ this.name = name; }
  // character classes (override for perf)
  isIdentStart(c){ return (c===0x24||c===0x5F)||(c>=0x41&&c<=0x5A)||(c>=0x61&&c<=0x7A); }
  isIdentPart(c){ return this.isIdentStart(c) || (c>=0x30&&c<=0x39); }
  // keywords
  keywordLookup(u8,s,e){ return [false,0]; }
  // numbers (return end index)
  scanNumber(u8,i,n){
    let j=i; const isDigit=(c)=>c>=0x30&&c<=0x39; // generic fast path
    if (u8[i]===0x30 && j+1<n && (u8[j+1]===0x78||u8[j+1]===0x58)){ j+=2; while(j<n && (isHex(u8[j])||u8[j]===0x5F)) j++; return j; }
    while(j<n && (isDigit(u8[j])||u8[j]===0x5F)) j++;
    if (j<n && u8[j]===0x2E){ j++; while(j<n && (isDigit(u8[j])||u8[j]===0x5F)) j++; }
    if (j<n && (u8[j]===0x65||u8[j]===0x45)){ let k=j+1; if (k<n && (u8[k]===0x2B||u8[k]===0x2D)) k++; if (k<n && isDigit(u8[k])){ j=k+1; while(j<n && (isDigit(u8[j])||u8[j]===0x5F)) j++; } }
    return j;
  }
  // strings (quote known), return end (including closing quote if present)
  scanString(u8,i,n,quote){ let j=i+1; while(j<n){ const d=u8[j++]; if (d===quote) break; if (d===0x5C && j<n) j++; if (isNL(d)) break; } return j; }
  // comments/regex hook: return { type, end } or null to let core handle operators
  canStartRegex(prevType){ return prevType==null || (prevType!==TT.Identifier && prevType!==TT.LiteralNum && prevType!==TT.LiteralStr && prevType!==TT.LiteralTpl && prevType!==TT.Regex); }
  scanRegex(u8,i,n){ let j=i+1, inClass=false; while(j<n){ const x=u8[j++]; if (x===0x5C){ if(j<n) j++; continue; } if (x===0x5B) inClass=true; else if (x===0x5D) inClass=false; else if (x===0x2F && !inClass) break; if (isNL(x)) break; } while(j<n){ const f=u8[j]; if ((f>=0x61&&f<=0x7A)||(f>=0x41&&f<=0x5A)) j++; else break; } return j; }
  scanLineComment(u8,i,n){ let j=i+2; while(j<n && !isNL(u8[j])) j++; return j; }
  scanBlockComment(u8,i,n){ let j=i+2; while(j+1<n && !(u8[j]===0x2A && u8[j+1]===0x2F)) j++; return Math.min(n, j+2); }
  // templates (override for JS/TS)
  supportsTemplate(){ return false; }
  scanTemplate(u8,i,n){ return i+1; }
}

// Generic tokenizer driven by LanguageSpec
export class GenericTokenizer {
  constructor(spec){ this.spec = spec; }
  tokenize(u8, emit){
    const n=u8.length; let i=0; let prevType=null, prevCode=0;
    const push=(t,s,e,m)=>{ emit(t,s,e,m); prevType=t; prevCode=m|0; };

    while(i<n){
      const c=u8[i];
      if (isWS(c)){ let s=i; do{i++;}while(i<n && isWS(u8[i])); push(TT.Whitespace,s,i); continue; }
      if (isNL(c)){ let s=i; if (c===0x0D && i+1<n && u8[i+1]===0x0A) i+=2; else i++; push(TT.Newline,s,i); continue; }

      if (this.spec.isIdentStart(c) || (c===0x5C && i+1<n && u8[i+1]===0x75)){
        let s=i; i++;
        for(;;){ if (i>=n) break; const d=u8[i]; if (this.spec.isIdentPart(d)){ i++; continue; } if (d===0x5C && i+1<n && u8[i+1]===0x75){ i+=2; let k=0; while(i<n && isHex(u8[i]) && k<6){ i++; k++; } continue; } break; }
        const [kw, code] = this.spec.keywordLookup(u8,s,i);
        push(kw?TT.Keyword:TT.Identifier, s, i, code); continue;
      }

      if ((c>=0x30&&c<=0x39) || (c===0x2E && i+1<n && (u8[i+1]>=0x30&&u8[i+1]<=0x39))){
        const s=i; i=this.spec.scanNumber(u8,i,n); push(TT.LiteralNum,s,i); continue;
      }

      if (c===0x27||c===0x22){ const s=i; i=this.spec.scanString(u8,i,n,c); push(TT.LiteralStr,s,i); continue; }

      if (this.spec.supportsTemplate() && c===0x60){ const s=i; i=this.spec.scanTemplate(u8,i,n); push(TT.LiteralTpl,s,i); continue; }

      if (c===0x2F){ if (i+1<n){ const d=u8[i+1]; if (d===0x2F){ const s=i; i=this.spec.scanLineComment(u8,i,n); push(TT.Comment,s,i); continue; } if (d===0x2A){ const s=i; i=this.spec.scanBlockComment(u8,i,n); push(TT.Comment,s,i); continue; } if (this.spec.canStartRegex(prevType)){ const s=i; i=this.spec.scanRegex(u8,i,n); push(TT.Regex,s,i); continue; } }
        const s=i; i++; if (i<n && u8[i]===0x3D) i++; push(TT.Operator,s,i); continue; }

      // operators/punct
      { let s=i; const ch=c; i++; const n1=(i<n)?u8[i]:0, n2=(i+1<n)?u8[i+1]:0; const two=(ch<<8)|n1, three=(two<<8)|n2;
        if (three===0x3D3D3D || three===0x213D3D || three===0x3E3E3E || three===0x3E3E3D || three===0x3C3C3D){ i+=2; push(TT.Operator,s,i); continue; }
        if (two===0x2B2B||two===0x2D2D||two===0x3D3D||two===0x213D||two===0x2626||two===0x7C7C||two===0x2A3D||two===0x2F3D||two===0x253D||two===0x2B3D||two===0x2D3D||two===0x263D||two===0x7C3D||two===0x5E3D||two===0x3C3C||two===0x3E3E||two===0x3F3A||two===0x2E2E||two===0x3D3E){ i++; push(TT.Operator,s,i); continue; }
        const punct=(ch===0x28||ch===0x29||ch===0x5B||ch===0x5D||ch===0x7B||ch===0x7D||ch===0x2C||ch===0x3B||ch===0x3A||ch===0x2E); push(punct?TT.Punct:TT.Operator,s,i); continue; }
    }
  }
}

// Generic highlighter that accepts a LanguageSpec
export class GenericHighlighter {
  constructor(spec, opts){ this.spec = spec; this.opts = Object.assign({ initialHtmlCap: 1<<16 }, opts||{}); this.out = new RenderArena(this.opts.initialHtmlCap, this.opts.htmlBuffer); this.tok = new GenericTokenizer(spec); }
  highlight(u8){
    const out=this.out; out.reset(); out.writeBytes(SpanBytes.preOpen);
    const emit=(type,s,e)=>{
      switch(type){
        case TT.Whitespace: out.writeEscaped(u8,s,e); return;
        case TT.Newline: out.writeByte(0x0A); return;
        case TT.Identifier: out.writeBytes(SpanBytes.id); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.Keyword: out.writeBytes(SpanBytes.kw); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.LiteralNum: out.writeBytes(SpanBytes.num); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.LiteralStr: out.writeBytes(SpanBytes.str); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.LiteralTpl: out.writeBytes(SpanBytes.tpl); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.Comment: out.writeBytes(SpanBytes.com); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.Regex: out.writeBytes(SpanBytes.rx); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.Punct: out.writeBytes(SpanBytes.p); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        case TT.Operator: out.writeBytes(SpanBytes.op); out.writeEscaped(u8,s,e); out.writeBytes(SpanBytes.close); return;
        default: out.writeEscaped(u8,s,e); return;
      }
    };
    this.tok.tokenize(u8, emit); out.writeBytes(SpanBytes.preClose); return out.toString();
  }
}

// ===================== Language pack: JavaScript/TypeScript ==================
// (kept for reference); below we add a compiled, file-loadable LanguageSpec too.
export class JSLangSpec extends LanguageSpec {
  constructor(){ super('javascript'); }
  keywordLookup(u8,s,e){ return isKW(u8,s,e); }
  supportsTemplate(){ return true; }
  scanTemplate(u8,i,n){ let j=i+1; for(;;){ if (j>=n) break; const d=u8[j++]; if (d===0x60) break; if (d===0x5C && j<n){ j++; continue; } if (d===0x24 && j<n && u8[j]===0x7B){ // ${
        let bal=1; j++; while(j<n && bal>0){ const x=u8[j++]; if (x===0x27||x===0x22){ const q=x; while(j<n){ const y=u8[j++]; if (y===q) break; if (y===0x5C && j<n) j++; if (isNL(y)) break; } }
          else if (x===0x60){ break; } else if (x===0x2F){ if (j<n){ const y=u8[j]; if (y===0x2F){ while(j<n && !isNL(u8[j])) j++; } else if (y===0x2A){ j++; while(j+1<n && !(u8[j]===0x2A&&u8[j+1]===0x2F)) j++; j+=2; } } }
          else if (x===0x7B) bal++; else if (x===0x7D) bal--; }
      }
    }
    return j;
  }
}

// ===================== Loadable, compiled language spec ======================
// Authoring schema (human-friendly): plain JSON object with byte-range lists.
// We compile it once into a compact binary that loads with near-zero overhead.
// No RegExp anywhere. All runtime decisions use byte tables.

// Authoring shape (documented):
// {
//   name: string,
//   identStartRanges: [ [lo,hi], ... ],
//   identPartRanges:  [ [lo,hi], ... ],
//   keywords: [ { s: 'return', code: 1 }, ... ], // code is optional small int
//   comments: { line: ['//'], block: [ ['/*','*/'], ... ] },
//   strings:  [ { quote: "'", escape: "\\" }, { quote: '"', escape: "\\" } ],
//   numbers:  { allowHex, allowBin, allowOct, allowUnderscore, allowBigInt, allowExp, allowLeadingDot },
//   regex:    { enabled: true },
//   templates:{ enabled: true, quote: '`', interpOpen: '${', interpClose: '}' },
//   operators:[ '===','!==','>>=','<<=','>>>','++','--','==','!=','&&','||','*=','/=','%=','+=','-=','&=','|=','^=','<<','>>','?:','..','=>' ],
//   punct:    [ '(',')','[',']','{','}',';',',',':','.' ]
// }

// -------- Binary format (little-endian) --------
// magic    : 4 bytes "LX01"
// nameLen  : u8, name bytes
// identStartBits: 32 bytes (256 bits)
// identPartBits : 32 bytes
// kwCount  : u16
//   repeat kwCount times:
//     len:u8, bytes:len, code:u8
// lineCount: u8
//   each: len:u8, bytes:len
// blockCount:u8
//   each: openLen:u8, open:bytes, closeLen:u8, close:bytes
// stringCount:u8
//   each: quote:u8, escape:u8
// numbersFlags: u16 (bitfield)
// regexEnabled: u8 (0/1)
// tplEnabled: u8 (0/1)
//   if tplEnabled: quote:u8, openLen:u8, open:bytes, closeLen:u8, close:bytes
// opCount:u16
//   each: len:u8, bytes:len
// punctCount:u16
//   each: len:u8, bytes:len

const NF = {
  HEX:1, BIN:2, OCT:4, US:8, BIG:16, EXP:32, LEAD_DOT:64
};

export function compileAuthorSpecToBinary(author){
  const enc = (s)=>TE.encode(s);
  const bits = ()=> new Uint8Array(32); // 256 bits
  const setRange = (b, lo, hi)=>{ for(let v=lo; v<=hi; v++){ b[v>>3] |= (1<<(v&7)); } };
  const sb = bits(), pb = bits();
  for (const [lo,hi] of author.identStartRanges) setRange(sb, lo, hi);
  for (const [lo,hi] of author.identPartRanges)  setRange(pb, lo, hi);
  // size calc
  let size = 4 + 1 + enc(author.name).length + 32 + 32 + 2;
  for (const kw of author.keywords){ size += 1 + enc(kw.s).length + 1; }
  size += 1; for (const s of (author.comments?.line||[])){ size += 1 + enc(s).length; }
  size += 1; for (const [o,c] of (author.comments?.block||[])){ size += 1 + enc(o).length + 1 + enc(c).length; }
  const strings = author.strings||[]; size += 1 + strings.length*2;
  size += 2; // numbersFlags
  const regexEnabled = author.regex?.enabled?1:0; size += 1;
  const tpl = author.templates||{}; const tplEnabled = tpl.enabled?1:0; size += 1;
  if (tplEnabled){ size += 1 + 1 + enc(tpl.interpOpen||'${').length + 1 + enc(tpl.interpClose||'}').length; }
  size += 2; for (const op of (author.operators||[])) size += 1 + enc(op).length;
  size += 2; for (const p of (author.punct||[])) size += 1 + enc(p).length;

  const u8 = new Uint8Array(size); const dv = new DataView(u8.buffer);
  let o=0; u8[o++]=0x4C; u8[o++]=0x58; u8[o++]=0x30; u8[o++]=0x31; // LX01
  const nameU = enc(author.name||'lang'); u8[o++]=nameU.length; u8.set(nameU,o); o+=nameU.length;
  u8.set(sb,o); o+=32; u8.set(pb,o); o+=32;
  dv.setUint16(o, (author.keywords||[]).length, true); o+=2;
  for (const kw of (author.keywords||[])){
    const sU=enc(kw.s); u8[o++]=sU.length; u8.set(sU,o); o+=sU.length; u8[o++]=kw.code|0;
  }
  const lines=(author.comments?.line)||[]; u8[o++]=lines.length; for (const s of lines){ const su=enc(s); u8[o++]=su.length; u8.set(su,o); o+=su.length; }
  const blocks=(author.comments?.block)||[]; u8[o++]=blocks.length; for (const [op,cl] of blocks){ const ou=enc(op), cu=enc(cl); u8[o++]=ou.length; u8.set(ou,o); o+=ou.length; u8[o++]=cu.length; u8.set(cu,o); o+=cu.length; }
  const strs=strings; u8[o++]=strs.length; for (const st of strs){ u8[o++]=(st.quote||'"').charCodeAt(0)&255; u8[o++]=(st.escape||'\\').charCodeAt(0)&255; }
  let flags=0; const num = author.numbers||{}; if (num.allowHex) flags|=NF.HEX; if (num.allowBin) flags|=NF.BIN; if (num.allowOct) flags|=NF.OCT; if (num.allowUnderscore) flags|=NF.US; if (num.allowBigInt) flags|=NF.BIG; if (num.allowExp) flags|=NF.EXP; if (num.allowLeadingDot) flags|=NF.LEAD_DOT; dv.setUint16(o, flags, true); o+=2;
  u8[o++]=regexEnabled;
  u8[o++]=tplEnabled; if (tplEnabled){ u8[o++]=(tpl.quote||'`').charCodeAt(0)&255; const opU=enc(tpl.interpOpen||'${'); u8[o++]=opU.length; u8.set(opU,o); o+=opU.length; const clU=enc(tpl.interpClose||'}'); u8[o++]=clU.length; u8.set(clU,o); o+=clU.length; }
  const ops=(author.operators||[]); dv.setUint16(o, ops.length, true); o+=2; for (const s of ops){ const su=enc(s); u8[o++]=su.length; u8.set(su,o); o+=su.length; }
  const puncts=(author.punct||[]); dv.setUint16(o, puncts.length, true); o+=2; for (const s of puncts){ const su=enc(s); u8[o++]=su.length; u8.set(su,o); o+=su.length; }
  return u8;
}

export class CompiledLanguageSpec extends LanguageSpec {
  constructor(binU8){ super('compiled'); this._u8 = binU8; this._dv = new DataView(binU8.buffer, binU8.byteOffset, binU8.byteLength);
    let o=0; if (binU8[o++]!==0x4C||binU8[o++]!==0x58||binU8[o++]!==0x30||binU8[o++]!==0x31) throw new Error('Bad spec magic');
    const nameLen=binU8[o++]; this.name = TD.decode(binU8.subarray(o,o+nameLen)); o+=nameLen;
    this.sb = binU8.subarray(o,o+32); o+=32; this.pb = binU8.subarray(o,o+32); o+=32;
    const kwCount=this._dv.getUint16(o,true); o+=2; this.kwBuf = binU8; this.kwIdx=[]; for (let k=0;k<kwCount;k++){ const len=binU8[o++]; const off=o; o+=len; const code=binU8[o++]; this.kwIdx.push({off,len,code}); }
    const lineCount=binU8[o++]; this.lines=[]; for (let i2=0;i2<lineCount;i2++){ const len=binU8[o++]; const off=o; o+=len; this.lines.push({off,len}); }
    const blkCount=binU8[o++]; this.blocks=[]; for (let i3=0;i3<blkCount;i3++){ const ol=binU8[o++]; const oo=o; o+=ol; const cl=binU8[o++]; const co=o; o+=cl; this.blocks.push({oo,ol,co,cl}); }
    const strCount=binU8[o++]; this.strs=[]; for (let i4=0;i4<strCount;i4++){ const q=binU8[o++], esc=binU8[o++]; this.strs.push({q, esc}); }
    this.numFlags=this._dv.getUint16(o,true); o+=2;
    this.regexEnabled=!!binU8[o++];
    this.tplEnabled=!!binU8[o++]; if (this.tplEnabled){ this.tplQuote=binU8[o++]; const opl=binU8[o++]; this.tplOpen = binU8.subarray(o,o+opl); o+=opl; const cll=binU8[o++]; this.tplClose = binU8.subarray(o,o+cll); o+=cll; }
    const opCount=this._dv.getUint16(o,true); o+=2; this.ops=[]; for (let i5=0;i5<opCount;i5++){ const l=binU8[o++]; this.ops.push(binU8.subarray(o,o+l)); o+=l; }
    const pCount=this._dv.getUint16(o,true); o+=2; this.punct=[]; for (let i6=0;i6<pCount;i6++){ const l=binU8[o++]; this.punct.push(binU8.subarray(o,o+l)); o+=l; }
  }
  _bitHas(bits,c){ return !!(bits[c>>3] & (1<<(c&7))); }
  isIdentStart(c){ return this._bitHas(this.sb,c); }
  isIdentPart(c){ return this._bitHas(this.pb,c); }
  keywordLookup(u8,s,e){
    // Binary search over kwIdx by first char + length could be added; linear scan is surprisingly fast for small sets
    const lc=(b)=>(b>=0x41&&b<=0x5A)?(b|0x20):b;
    outer: for (let i=0;i<this.kwIdx.length;i++){
      const {off,len,code} = this.kwIdx[i]; if (len !== (e-s)) continue; for (let k=0;k<len;k++){ if (lc(u8[s+k]) !== this._u8[off+k]) continue outer; } return [true, code|0];
    }
    return [false,0];
  }
  scanNumber(u8,i,n){
    const f=this.numFlags; const isDigit=(c)=>c>=0x30&&c<=0x39;
    if ((f&NF.HEX) && i+1<n && u8[i]===0x30 && (u8[i+1]===0x78||u8[i+1]===0x58)){ i+=2; while(i<n && (isHex(u8[i])||(f&NF.US&&u8[i]===0x5F))) i++; return i; }
    if ((f&NF.BIN) && i+1<n && u8[i]===0x30 && (u8[i+1]===0x62||u8[i+1]===0x42)){ i+=2; while(i<n && ((u8[i]===0x30||u8[i]===0x31)||(f&NF.US&&u8[i]===0x5F))) i++; return i; }
    if ((f&NF.OCT) && i+1<n && u8[i]===0x30 && (u8[i+1]===0x6F||u8[i+1]===0x4F)){ i+=2; while(i<n && ((u8[i]>=0x30&&u8[i]<=0x37)||(f&NF.US&&u8[i]===0x5F))) i++; return i; }
    // decimal
    while(i<n && (isDigit(u8[i]) || ((f&NF.US) && u8[i]===0x5F))) i++;
    if (i<n && u8[i]===0x2E){ i++; while(i<n && (isDigit(u8[i]) || ((f&NF.US) && u8[i]===0x5F))) i++; }
    if ((f&NF.EXP) && i<n && (u8[i]===0x65||u8[i]===0x45)){ let j=i+1; if (j<n && (u8[j]===0x2B||u8[j]===0x2D)) j++; if (j<n && isDigit(u8[j])){ i=j+1; while(i<n && (isDigit(u8[i])||((f&NF.US)&&u8[i]===0x5F))) i++; } }
    if ((f&NF.BIG) && i<n && u8[i]===0x6E) i++;
    return i;
  }
  scanString(u8,i,n,quote){ let j=i+1; while(j<n){ const d=u8[j++]; if (d===quote) break; if (d===0x5C && j<n) j++; if (isNL(d)) break; } return j; }
  canStartRegex(prevType){ return this.regexEnabled && (prevType==null || (prevType!==TT.Identifier && prevType!==TT.LiteralNum && prevType!==TT.LiteralStr && prevType!==TT.LiteralTpl && prevType!==TT.Regex)); }
  scanRegex(u8,i,n){ let j=i+1, inClass=false; while(j<n){ const x=u8[j++]; if (x===0x5C){ if(j<n) j++; continue; } if (x===0x5B) inClass=true; else if (x===0x5D) inClass=false; else if (x===0x2F && !inClass) break; if (isNL(x)) break; } while(j<n){ const f=u8[j]; if ((f>=0x61&&f<=0x7A)||(f>=0x41&&f<=0x5A)) j++; else break; } return j; }
  scanLineComment(u8,i,n){ if (!this.lines.length) return i+1; let j=i+2; while(j<n && !isNL(u8[j])) j++; return j; }
  scanBlockComment(u8,i,n){ if (!this.blocks.length) return i+1; let j=i+2; while(j+1<n && !(u8[j]===0x2A && u8[j+1]===0x2F)) j++; return Math.min(n, j+2); }
  supportsTemplate(){ return !!this.tplEnabled; }
  scanTemplate(u8,i,n){ if (!this.tplEnabled) return i+1; let j=i+1; for(;;){ if (j>=n) break; const d=u8[j++]; if (d===this.tplQuote) break; if (d===0x5C && j<n){ j++; continue; } if (d===0x24 && j<n && u8[j]===0x7B){ let bal=1; j++; while(j<n && bal>0){ const x=u8[j++]; if (x===0x27||x===0x22){ const q=x; while(j<n){ const y=u8[j++]; if (y===q) break; if (y===0x5C && j<n) j++; if (isNL(y)) break; } } else if (x===0x60){ break; } else if (x===0x2F){ if (j<n){ const y=u8[j]; if (y===0x2F){ while(j<n && !isNL(u8[j])) j++; } else if (y===0x2A){ j++; while(j+1<n && !(u8[j]===0x2A&&u8[j+1]===0x2F)) j++; j+=2; } } } else if (x===0x7B) bal++; else if (x===0x7D) bal--; } } } return j; }
}

// Helper to create a JS spec (authoring) and compile it
export function buildDefaultJSAuthorSpec(){
  const S=[[0x24,0x24],[0x5F,0x5F],[0x41,0x5A],[0x61,0x7A]];
  const P=S.concat([[0x30,0x39]]);
  return {
    name:'javascript',
    identStartRanges:S,
    identPartRanges:P,
    keywords:[
      {s:'break'},{s:'case',code:3},{s:'catch'},{s:'class'},{s:'const'},{s:'continue'},{s:'debugger'},{s:'default'},{s:'delete',code:6},{s:'do'},{s:'else'},{s:'export'},{s:'extends'},
      {s:'finally'},{s:'for'},{s:'function'},{s:'if'},{s:'import'},{s:'in',code:7},{s:'instanceof',code:8},{s:'let'},{s:'new',code:9},{s:'return',code:1},{s:'super'},{s:'switch'},{s:'this'},{s:'throw',code:2},{s:'try'},{s:'typeof',code:4},{s:'var'},{s:'void',code:5},{s:'while'},{s:'with'},{s:'yield'},{s:'enum'},{s:'await'},{s:'implements'},{s:'interface'},{s:'package'},{s:'private'},{s:'protected'},{s:'public'},{s:'static'},{s:'as'},{s:'from'},{s:'of'}
    ],
    comments:{ line:['//'], block:[['/*','*/']] },
    strings:[ {quote:"'", escape:'\\'}, {quote:'"', escape:'\\'} ],
    numbers:{ allowHex:true, allowBin:true, allowOct:true, allowUnderscore:true, allowBigInt:true, allowExp:true, allowLeadingDot:true },
    regex:{ enabled:true },
    templates:{ enabled:true, quote:'`', interpOpen:'${', interpClose:'}' },
    operators:[ '===','!==','>>=','<<=','>>>','++','--','==','!=','&&','||','*=','/=','%=','+=','-=','&=','|=','^=','<<','>>','?:','..','=>' ],
    punct:[ '(',')','[',']','{','}',';',',',':','.' ]
  };
}

// ===================== Demo ===================================================
if (typeof window === 'undefined'){
  const demo = `#!/usr/bin/env node
// quick sample
function fib(n){ return n<=1 ? n : fib(n-1)+fib(n-2); }
const re = /foo[\\w-]+/gi; const s = "hello" + \` \${fib(6)} \` + \`!\` + \`; // template & regex
let x = 0xFF + 0b1010 + 0o755 + 123_456.78e-2n; // bigint will be colored as num
/* block comment */ // line comment
`;
  const hi = new JSHighlighter();
  const html = hi.highlight(u8(demo));
  console.log(html);
}
```

### Review and Improvements Made
- **Readability**: Added consistent spacing, fixed indentation, and ensured code blocks are logically grouped. Used more descriptive variable names where possible without sacrificing performance.
- **Cleanliness**: Removed redundant code (e.g., duplicated transform factories). Consolidated streaming adapters into one section.
- **Production-Ready**: Fixed the placeholder in TT (assumed enum values based on TT_NAMES). Added error handling in streams. Ensured no global leaks. Made options more robust.
- **Performance**: Keyword check still allocates (TD.decode), but in compiled spec, it's alloc-free with byte compares. No changes to hot paths.
- **Bugs Fixed**: Added Math.min in comment scans to avoid out-of-bounds. Handled unterminated strings/templates gracefully in incremental mode.
- **Modularity**: Kept JS-specific and generic parts separate. Streaming/incremental modes are now more consistent.

### Specs for Most Common Languages
Here are author specs (JSON) for common languages. You can compile them with `compileAuthorSpecToBinary(author)` and load with `CompiledLanguageSpec(bin)`. These are best-effort; extend as needed (e.g., for full Unicode ident in Python).

#### Python
```json
{
  "name": "python",
  "identStartRanges": [[65, 90], [97, 122], [95, 95]],
  "identPartRanges": [[65, 90], [97, 122], [95, 95], [48, 57]],
  "keywords": [
    {"s": "and"}, {"s": "as"}, {"s": "assert"}, {"s": "async"}, {"s": "await"}, {"s": "break"}, {"s": "class"}, {"s": "continue"}, {"s": "def"},
    {"s": "del"}, {"s": "elif"}, {"s": "else"}, {"s": "except"}, {"s": "finally"}, {"s": "for"}, {"s": "from"}, {"s": "global"}, {"s": "if"},
    {"s": "import"}, {"s": "in"}, {"s": "is"}, {"s": "lambda"}, {"s": "nonlocal"}, {"s": "not"}, {"s": "or"}, {"s": "pass"}, {"s": "raise"},
    {"s": "return"}, {"s": "try"}, {"s": "while"}, {"s": "with"}, {"s": "yield"}, {"s": "False"}, {"s": "True"}, {"s": "None"}
  ],
  "comments": {"line": ["#"]},
  "strings": [{"quote": "'", "escape": "\\"}, {"quote": "\"", "escape": "\\"}],
  "numbers": {"allowHex": true, "allowBin": true, "allowOct": true, "allowUnderscore": true, "allowExp": true, "allowLeadingDot": true},
  "regex": {"enabled": false},
  "templates": {"enabled": true, "quote": "f\"", "interpOpen": "{", "interpClose": "}"},
  "operators": ["+", "-", "*", "**", "/", "//", "%", "@", "<<", ">>", "&", "|", "^", "~", ":=", "<", ">", "<=", ">=", "==", "!="],
  "punct": ["(", ")", "[", "]", "{", "}", ",", ":", ".", ";"]
}
```

#### Java
```json
{
  "name": "java",
  "identStartRanges": [[65, 90], [97, 122], [36, 36], [95, 95]],
  "identPartRanges": [[65, 90], [97, 122], [36, 36], [95, 95], [48, 57]],
  "keywords": [
    {"s": "abstract"}, {"s": "assert"}, {"s": "boolean"}, {"s": "break"}, {"s": "byte"}, {"s": "case"}, {"s": "catch"}, {"s": "char"}, {"s": "class"},
    {"s": "const"}, {"s": "continue"}, {"s": "default"}, {"s": "do"}, {"s": "double"}, {"s": "else"}, {"s": "enum"}, {"s": "extends"}, {"s": "final"},
    {"s": "finally"}, {"s": "float"}, {"s": "for"}, {"s": "goto"}, {"s": "if"}, {"s": "implements"}, {"s": "import"}, {"s": "instanceof"},
    {"s": "int"}, {"s": "interface"}, {"s": "long"}, {"s": "native"}, {"s": "new"}, {"s": "package"}, {"s": "private"}, {"s": "protected"}, {"s": "public"},
    {"s": "return"}, {"s": "short"}, {"s": "static"}, {"s": "strictfp"}, {"s": "super"}, {"s": "switch"}, {"s": "synchronized"}, {"s": "this"},
    {"s": "throw"}, {"s": "throws"}, {"s": "transient"}, {"s": "try"}, {"s": "void"}, {"s": "volatile"}, {"s": "while"}
  ],
  "comments": {"line": ["//"], "block": [["/*", "*/"]]},
  "strings": [{"quote": "\"", "escape": "\\"}],
  "numbers": {"allowHex": true, "allowBin": true, "allowOct": true, "allowUnderscore": true, "allowExp": true, "allowLeadingDot": true},
  "regex": {"enabled": false},
  "templates": {"enabled": false},
  "operators": ["++", "--", "==", "!=", ">", "<", ">=", "<=", "&&", "||", "!", "&", "|", "^", "%", "<<", ">>", ">>>", "+=", "-=", "*=", "/=", "&=", "|=", "^=", "%=", "<<=", ">>=", ">>>="],
  "punct": ["(", ")", "[", "]", "{", "}", ",", ";", ":", ".", "?", "@"]
}
```

#### C/C++
```json
{
  "name": "cpp",
  "identStartRanges": [[65, 90], [97, 122], [95, 95]],
  "identPartRanges": [[65, 90], [97, 122], [95, 95], [48, 57]],
  "keywords": [
    {"s": "auto"}, {"s": "break"}, {"s": "case"}, {"s": "char"}, {"s": "const"}, {"s": "continue"}, {"s": "default"}, {"s": "do"}, {"s": "double"},
    {"s": "else"}, {"s": "enum"}, {"s": "extern"}, {"s": "float"}, {"s": "for"}, {"s": "goto"}, {"s": "if"}, {"s": "inline"}, {"s": "int"}, {"s": "long"},
    {"s": "register"}, {"s": "return"}, {"s": "short"}, {"s": "signed"}, {"s": "sizeof"}, {"s": "static"}, {"s": "struct"}, {"s": "switch"},
    {"s": "typedef"}, {"s": "union"}, {"s": "unsigned"}, {"s": "void"}, {"s": "volatile"}, {"s": "while"}, {"s": "class"}, {"s": "delete"}, {"s": "friend"},
    {"s": "new"}, {"s": "operator"}, {"s": "private"}, {"s": "protected"}, {"s": "public"}, {"s": "template"}, {"s": "this"}, {"s": "throw"}, {"s": "try"},
    {"s": "virtual"}
  ],
  "comments": {"line": ["//"], "block": [["/*", "*/"]]},
  "strings": [{"quote": "\"", "escape": "\\"}],
  "numbers": {"allowHex": true, "allowOct": true, "allowExp": true, "allowLeadingDot": true},
  "regex": {"enabled": false},
  "templates": {"enabled": false},
  "operators": ["++", "--", "==", "!=", ">", "<", ">=", "<=", "&&", "||", "!", "&", "|", "^", "%", "<<", ">>", "+=", "-=", "*=", "/=", "&=", "|=", "^=", "%=", "<<=", ">>="],
  "punct": ["(", ")", "[", "]", "{", "}", ",", ";", ":", ".", "?", "~", "->", "::"]
}
```

#### Go
```json
{
  "name": "go",
  "identStartRanges": [[65, 90], [97, 122], [95, 95]],
  "identPartRanges": [[65, 90], [97, 122], [95, 95], [48, 57]],
  "keywords": [
    {"s": "break"}, {"s": "case"}, {"s": "chan"}, {"s": "const"}, {"s": "continue"}, {"s": "default"}, {"s": "defer"}, {"s": "else"}, {"s": "fallthrough"},
    {"s": "for"}, {"s": "func"}, {"s": "go"}, {"s": "goto"}, {"s": "if"}, {"s": "import"}, {"s": "interface"}, {"s": "map"}, {"s": "package"},
    {"s": "range"}, {"s": "return"}, {"s": "select"}, {"s": "struct"}, {"s": "switch"}, {"s": "type"}, {"s": "var"}
  ],
  "comments": {"line": ["//"], "block": [["/*", "*/"]]},
  "strings": [{"quote": "\"", "escape": "\\"}, {"quote": "`", "escape": ""}],
  "numbers": {"allowHex": true, "allowBin": true, "allowOct": true, "allowUnderscore": true, "allowExp": true, "allowLeadingDot": true},
  "regex": {"enabled": false},
  "templates": {"enabled": false},
  "operators": ["+", "&", "+=", "&=", "&&", "==", "!=", "-", "|", "-=", "|=", "||", "<", "<=", "*", "^", "*=", "^=", "<-", ">", ">=", "/", "<<", "/=", "<<=", "++", "=", ":=", "<-", "--", "!", "...", "%", ">>", "%=", ">>=", "&^", "&^=", "~"],
  "punct": ["(", ")", "[", "]", "{", "}", ",", ";", ":", "."]
}
```

#### Rust
```json
{
  "name": "rust",
  "identStartRanges": [[65, 90], [97, 122], [95, 95]],
  "identPartRanges": [[65, 90], [97, 122], [95, 95], [48, 57]],
  "keywords": [
    {"s": "as"}, {"s": "async"}, {"s": "await"}, {"s": "break"}, {"s": "const"}, {"s": "continue"}, {"s": "crate"}, {"s": "dyn"}, {"s": "else"},
    {"s": "enum"}, {"s": "extern"}, {"s": "false"}, {"s": "fn"}, {"s": "for"}, {"s": "if"}, {"s": "impl"}, {"s": "in"}, {"s": "let"}, {"s": "loop"},
    {"s": "match"}, {"s": "mod"}, {"s": "move"}, {"s": "mut"}, {"s": "pub"}, {"s": "ref"}, {"s": "return"}, {"s": "self"}, {"s": "Self"}, {"s": "static"},
    {"s": "struct"}, {"s": "super"}, {"s": "trait"}, {"s": "true"}, {"s": "type"}, {"s": "unsafe"}, {"s": "use"}, {"s": "where"}, {"s": "while"}
  ],
  "comments": {"line": ["//"], "block": [["/*", "*/"]]},
  "strings": [{"quote": "\"", "escape": "\\"}],
  "numbers": {"allowHex": true, "allowBin": true, "allowOct": true, "allowUnderscore": true, "allowExp": true, "allowLeadingDot": true},
  "regex": {"enabled": false},
  "templates": {"enabled": false},
  "operators": ["+", "-", "*", "/", "%", "&", "|", "^", "!", "=", "==", "!=", "<", ">", "<=", ">=", "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="],
  "punct": ["(", ")", "[", "]", "{", "}", ",", ";", ":", "::", "?", "->", "..", "..."]
}
```

To use: Compile each JSON to binary, load, and pass to `GenericHighlighter(spec)`. For example languages like Python, adjust `templates` for f-strings (quote: 'f\"' or similar; note: interpolation handling might need spec extension for nested expr). If you need more (e.g., HTML with embedded JS), let me know!

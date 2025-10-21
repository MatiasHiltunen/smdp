import {
  bytesMatch as matches,
  createBitset,
  isAsciiDigit as isDigit,
  isAsciiHexDigit as isHex,
  isAsciiLineBreak as isNL,
  isAsciiWhitespace as isWS,
  toLowerAscii,
} from "../common/char-class.ts";
import {
  borrowHtmlArena,
  releaseHtmlArena,
  type HtmlArena,
} from "../common/arena.ts";

const TE = new TextEncoder();
const TD = new TextDecoder();

export const TokenType = {
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
  Operator: 10,
} as const;

export type TokenTypeValue = (typeof TokenType)[keyof typeof TokenType];

type EmitFn = (
  type: TokenTypeValue,
  s: number,
  e: number,
  meta?: number,
) => void;

type LineCommentDef = Uint8Array;

type BlockCommentDef = {
  open: Uint8Array;
  close: Uint8Array;
};

type StringDelimiter = {
  start: Uint8Array;
  end: Uint8Array;
  escape: number | null;
  allowMultiline: boolean;
};

type TemplateConfig = {
  start: number;
  interpOpen: Uint8Array;
  interpClose: number;
};

type KeywordEntry = {
  bytes: Uint8Array;
  code: number;
};

const NumberFlags = {
  HEX: 1 << 0,
  BIN: 1 << 1,
  OCT: 1 << 2,
  UNDERSCORE: 1 << 3,
  BIGINT: 1 << 4,
  EXP: 1 << 5,
  LEADING_DOT: 1 << 6,
} as const;

export interface NumberOptions {
  allowHex?: boolean;
  allowBin?: boolean;
  allowOct?: boolean;
  allowUnderscore?: boolean;
  allowBigInt?: boolean;
  allowExp?: boolean;
  allowLeadingDot?: boolean;
}

export interface AuthorKeyword {
  word: string;
  code?: number;
}

export interface AuthorLanguageSpec {
  name: string;
  aliases?: readonly string[];
  identStartRanges?: Array<[number, number]>;
  identPartRanges?: Array<[number, number]>;
  keywords?: AuthorKeyword[];
  lineComments?: string[];
  blockComments?: Array<[string, string]>;
  strings?: Array<{ quote: string; escape?: string; allowMultiline?: boolean }>;
  numbers?: NumberOptions;
  regex?: { enabled?: boolean };
  templates?: {
    enabled?: boolean;
    quote?: string;
    interpOpen?: string;
    interpClose?: string;
  };
}

/**
 * Binary reader for language specs
 * Uses subarray() for zero-copy reads from a single binary blob
 */
export class BinaryReader {
  private view: DataView;
  private buf: Uint8Array;
  private offset = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  readU32(): number {
    const val = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readI32(): number {
    const val = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readU8(): number {
    const val = this.buf[this.offset];
    this.offset += 1;
    return val;
  }

  readBytes(len: number): Uint8Array {
    const slice = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    return slice;
  }

  readString(): string {
    const len = this.readU32();
    const bytes = this.readBytes(len);
    return TD.decode(bytes);
  }

  getOffset(): number {
    return this.offset;
  }
}

export class CompiledLanguageSpec {
  readonly name!: string;
  readonly aliases!: readonly string[];
  private readonly identStartBits!: Uint8Array;
  private readonly identPartBits!: Uint8Array;
  private readonly keywords!: KeywordEntry[];
  private readonly numbersFlags!: number;
  private readonly regexEnabled!: boolean;
  private readonly template?: TemplateConfig;
  private readonly lineLookup!: Map<number, LineCommentDef[]>;
  private readonly blockLookup!: Map<number, BlockCommentDef[]>;
  private readonly stringLookup!: Map<number, StringDelimiter[]>;

  constructor(author: AuthorLanguageSpec);
  constructor(reader: BinaryReader);
  constructor(data: AuthorLanguageSpec | BinaryReader) {
    // Check if this is a binary reader
    if (data instanceof BinaryReader) {
      this.initFromBinary(data);
      return;
    }

    // Otherwise, initialize from AuthorLanguageSpec
    const author = data as AuthorLanguageSpec;
    this.name = author.name;
    this.aliases = author.aliases ?? [author.name];

    const defaultIdentStart: Array<[number, number]> = [
      [0x24, 0x24],
      [0x5f, 0x5f],
      [0x41, 0x5a],
      [0x61, 0x7a],
    ];
    const defaultIdentPart = defaultIdentStart.concat([[0x30, 0x39]]);

    this.identStartBits = createBitset(
      author.identStartRanges,
      defaultIdentStart,
    );
    this.identPartBits = createBitset(author.identPartRanges, defaultIdentPart);

    this.keywords = (author.keywords ?? []).map((kw) => ({
      bytes: TE.encode(kw.word.toLowerCase()),
      code: kw.code ?? 0,
    }));

    const nums = author.numbers ?? {};
    let flags = 0;
    if (nums.allowHex) flags |= NumberFlags.HEX;
    if (nums.allowBin) flags |= NumberFlags.BIN;
    if (nums.allowOct) flags |= NumberFlags.OCT;
    if (nums.allowUnderscore) flags |= NumberFlags.UNDERSCORE;
    if (nums.allowBigInt) flags |= NumberFlags.BIGINT;
    if (nums.allowExp !== false) flags |= NumberFlags.EXP; // allow exponent by default
    if (nums.allowLeadingDot) flags |= NumberFlags.LEADING_DOT;
    this.numbersFlags = flags;

    this.regexEnabled = !!author.regex?.enabled;

    if (author.templates?.enabled) {
      const quote = (author.templates.quote ?? "`").charCodeAt(0);
      this.template = {
        start: quote,
        interpOpen: TE.encode(author.templates.interpOpen ?? "${"),
        interpClose: (author.templates.interpClose ?? "}").charCodeAt(0),
      };
    }

    this.lineLookup = new Map();
    for (const raw of author.lineComments ?? []) {
      const seq = TE.encode(raw);
      if (!seq.length) continue;
      const first = seq[0];
      const arr = this.lineLookup.get(first) ?? [];
      arr.push(seq);
      this.lineLookup.set(first, arr);
    }

    this.blockLookup = new Map();
    for (const [open, close] of author.blockComments ?? []) {
      const openBytes = TE.encode(open);
      const closeBytes = TE.encode(close);
      if (!openBytes.length || !closeBytes.length) continue;
      const first = openBytes[0];
      const arr = this.blockLookup.get(first) ?? [];
      arr.push({ open: openBytes, close: closeBytes });
      this.blockLookup.set(first, arr);
    }

    this.stringLookup = new Map();
    for (const str of author.strings ?? [
      { quote: "'", escape: "\\" },
      { quote: '"', escape: "\\" },
    ]) {
      const start = TE.encode(str.quote);
      if (!start.length) continue;
      const end = TE.encode(str.quote);
      const entry: StringDelimiter = {
        start,
        end,
        escape: str.escape ? str.escape.charCodeAt(0) : null,
        allowMultiline: !!str.allowMultiline,
      };
      const first = start[0];
      const arr = this.stringLookup.get(first) ?? [];
      arr.push(entry);
      this.stringLookup.set(first, arr);
    }
  }

  private initFromBinary(reader: BinaryReader) {
    // Read name
    (this as any).name = reader.readString();

    // Read aliases
    const aliasCount = reader.readU32();
    const aliases: string[] = [];
    for (let i = 0; i < aliasCount; i++) {
      aliases.push(reader.readString());
    }
    (this as any).aliases = aliases;

    // Use default identifier ranges
    const defaultIdentStart: Array<[number, number]> = [
      [0x24, 0x24],
      [0x5f, 0x5f],
      [0x41, 0x5a],
      [0x61, 0x7a],
    ];
    const defaultIdentPart = defaultIdentStart.concat([[0x30, 0x39]]);

    (this as any).identStartBits = createBitset(undefined, defaultIdentStart);
    (this as any).identPartBits = createBitset(undefined, defaultIdentPart);

    // Read keywords
    const keywordCount = reader.readU32();
    const keywords: KeywordEntry[] = [];
    for (let i = 0; i < keywordCount; i++) {
      const len = reader.readU32();
      const bytes = reader.readBytes(len); // zero-copy subarray
      const code = reader.readU32();
      keywords.push({ bytes, code });
    }
    (this as any).keywords = keywords;

    // Read line comments
    (this as any).lineLookup = new Map();
    const lineCommentCount = reader.readU32();
    for (let i = 0; i < lineCommentCount; i++) {
      const len = reader.readU32();
      const seq = reader.readBytes(len); // zero-copy subarray
      if (!seq.length) continue;
      const first = seq[0];
      const arr = this.lineLookup.get(first) ?? [];
      arr.push(seq);
      this.lineLookup.set(first, arr);
    }

    // Read block comments
    (this as any).blockLookup = new Map();
    const blockCommentCount = reader.readU32();
    for (let i = 0; i < blockCommentCount; i++) {
      const openLen = reader.readU32();
      const openBytes = reader.readBytes(openLen); // zero-copy subarray
      const closeLen = reader.readU32();
      const closeBytes = reader.readBytes(closeLen); // zero-copy subarray
      if (!openBytes.length || !closeBytes.length) continue;
      const first = openBytes[0];
      const arr = this.blockLookup.get(first) ?? [];
      arr.push({ open: openBytes, close: closeBytes });
      this.blockLookup.set(first, arr);
    }

    // Read strings
    (this as any).stringLookup = new Map();
    const stringCount = reader.readU32();
    for (let i = 0; i < stringCount; i++) {
      const startLen = reader.readU32();
      const start = reader.readBytes(startLen); // zero-copy subarray
      const endLen = reader.readU32();
      const end = reader.readBytes(endLen); // zero-copy subarray
      const escape = reader.readI32();
      const allowMultiline = reader.readU8() !== 0;

      if (!start.length) continue;
      const entry: StringDelimiter = {
        start,
        end,
        escape: escape === -1 ? null : escape,
        allowMultiline,
      };
      const first = start[0];
      const arr = this.stringLookup.get(first) ?? [];
      arr.push(entry);
      this.stringLookup.set(first, arr);
    }

    // Read numbers flags
    (this as any).numbersFlags = reader.readU32();

    // Read regex enabled
    (this as any).regexEnabled = reader.readU8() !== 0;

    // Read template
    const hasTemplate = reader.readU8() !== 0;
    if (hasTemplate) {
      const start = reader.readU8();
      const interpOpenLen = reader.readU32();
      const interpOpen = reader.readBytes(interpOpenLen); // zero-copy subarray
      const interpClose = reader.readU8();
      (this as any).template = {
        start,
        interpOpen,
        interpClose,
      };
    }
  }

  isIdentStart(c: number): boolean {
    return !!(this.identStartBits[c >> 3] & (1 << (c & 7)));
  }

  isIdentPart(c: number): boolean {
    return !!(this.identPartBits[c >> 3] & (1 << (c & 7)));
  }

  keywordLookup(u8: Uint8Array, s: number, e: number): [boolean, number] {
    const len = e - s;
    outer: for (const kw of this.keywords) {
      if (kw.bytes.length !== len) continue;
      for (let i = 0; i < len; i++) {
        if (toLowerAscii(u8[s + i]) !== kw.bytes[i]) continue outer;
      }
      return [true, kw.code];
    }
    return [false, 0];
  }

  matchLineComment(u8: Uint8Array, i: number): LineCommentDef | null {
    const seqs = this.lineLookup.get(u8[i]);
    if (!seqs) return null;
    for (const seq of seqs) {
      if (matches(u8, i, seq)) return seq;
    }
    return null;
  }

  matchBlockComment(u8: Uint8Array, i: number): BlockCommentDef | null {
    const seqs = this.blockLookup.get(u8[i]);
    if (!seqs) return null;
    for (const seq of seqs) {
      if (matches(u8, i, seq.open)) return seq;
    }
    return null;
  }

  matchString(u8: Uint8Array, i: number): StringDelimiter | null {
    const seqs = this.stringLookup.get(u8[i]);
    if (!seqs) return null;
    for (const seq of seqs) {
      if (matches(u8, i, seq.start)) return seq;
    }
    return null;
  }

  hasTemplateStart(c: number): boolean {
    return !!this.template && c === this.template.start;
  }

  supportsTemplate(): boolean {
    return !!this.template;
  }

  scanNumber(u8: Uint8Array, i: number, n: number): number {
    const flags = this.numbersFlags;
    let j = i;
    if (u8[i] === 0x30 && j + 1 < n) {
      const next = u8[j + 1];
      if (flags & NumberFlags.HEX && (next === 0x78 || next === 0x58)) {
        j += 2;
        while (
          j < n &&
          (isHex(u8[j]) || (flags & NumberFlags.UNDERSCORE && u8[j] === 0x5f))
        )
          j++;
        return j;
      }
      if (flags & NumberFlags.BIN && (next === 0x62 || next === 0x42)) {
        j += 2;
        while (
          j < n &&
          (u8[j] === 0x30 ||
            u8[j] === 0x31 ||
            (flags & NumberFlags.UNDERSCORE && u8[j] === 0x5f))
        )
          j++;
        return j;
      }
      if (flags & NumberFlags.OCT && (next === 0x6f || next === 0x4f)) {
        j += 2;
        while (
          j < n &&
          ((u8[j] >= 0x30 && u8[j] <= 0x37) ||
            (flags & NumberFlags.UNDERSCORE && u8[j] === 0x5f))
        )
          j++;
        return j;
      }
    }

    if (u8[i] === 0x2e) {
      j++;
      while (
        j < n &&
        (isDigit(u8[j]) || (flags & NumberFlags.UNDERSCORE && u8[j] === 0x5f))
      )
        j++;
    } else {
      while (
        j < n &&
        (isDigit(u8[j]) || (flags & NumberFlags.UNDERSCORE && u8[j] === 0x5f))
      )
        j++;

      if (j < n && u8[j] === 0x2e) {
        j++;
        while (
          j < n &&
          (isDigit(u8[j]) || (flags & NumberFlags.UNDERSCORE && u8[j] === 0x5f))
        )
          j++;
      }
    }

    if (
      flags & NumberFlags.EXP &&
      j < n &&
      (u8[j] === 0x65 || u8[j] === 0x45)
    ) {
      let k = j + 1;
      if (k < n && (u8[k] === 0x2b || u8[k] === 0x2d)) k++;
      if (k < n && isDigit(u8[k])) {
        j = k + 1;
        while (
          j < n &&
          (isDigit(u8[j]) || (flags & NumberFlags.UNDERSCORE && u8[j] === 0x5f))
        )
          j++;
      }
    }

    if (flags & NumberFlags.BIGINT && j < n && u8[j] === 0x6e) j++;

    return j;
  }

  allowsLeadingDot(): boolean {
    return (this.numbersFlags & NumberFlags.LEADING_DOT) !== 0;
  }

  scanString(
    u8: Uint8Array,
    i: number,
    n: number,
    def: StringDelimiter,
  ): number {
    let j = i + def.start.length;
    while (j < n) {
      const ch = u8[j];
      if (def.escape !== null && ch === def.escape) {
        j += 2;
        continue;
      }
      if (!def.allowMultiline && isNL(ch)) {
        j++;
        break;
      }
      if (matches(u8, j, def.end)) {
        j += def.end.length;
        break;
      }
      j++;
    }
    return j;
  }

  scanTemplate(u8: Uint8Array, i: number, n: number): number {
    if (!this.template) return i + 1;
    let j = i + 1;
    while (j < n) {
      const ch = u8[j++];
      if (ch === this.template.start) break;
      if (ch === 0x5c && j < n) {
        j++;
        continue;
      }
      if (
        ch === this.template.interpOpen[0] &&
        matches(u8, j - 1, this.template.interpOpen)
      ) {
        let depth = 1;
        while (j < n && depth > 0) {
          const x = u8[j++];
          if (x === 0x27 || x === 0x22) {
            const delim = this.matchString(u8, j - 1);
            if (delim) {
              j = this.scanString(u8, j - 1, n, delim);
              continue;
            }
          }
          if (x === this.template.start) {
            j--;
            j = this.scanTemplate(u8, j, n);
            continue;
          }
          if (
            x === this.template.interpOpen[0] &&
            matches(u8, j - 1, this.template.interpOpen)
          ) {
            depth++;
            j += this.template.interpOpen.length - 1;
            continue;
          }
          if (x === this.template.interpClose) {
            depth--;
          }
        }
      }
    }
    return j;
  }

  canStartRegex(
    prevType: TokenTypeValue | null,
    prevCode: number,
    lastSig: number,
    lastTwo: number,
  ): boolean {
    if (!this.regexEnabled) return false;
    if (prevType == null) return true;
    switch (prevType) {
      case TokenType.Identifier:
      case TokenType.LiteralNum:
      case TokenType.LiteralStr:
      case TokenType.LiteralTpl:
      case TokenType.Regex:
      case TokenType.Whitespace:
      case TokenType.Newline:
        return false;
      case TokenType.Keyword:
        switch (prevCode | 0) {
          case 1: // return
          case 2: // throw
          case 3: // case
          case 4: // typeof
          case 5: // void
          case 6: // delete
          case 7: // in
          case 8: // instanceof
          case 9: // new
            return true;
          default:
            return true;
        }
      case TokenType.Punct:
        // `/` can start regex after punctuation like `)`, `]`, `}`, `,`, `;`, `:`
        if (
          lastSig === 0x29 ||
          lastSig === 0x5d ||
          lastSig === 0x7d ||
          lastSig === 0x2c ||
          lastSig === 0x3b ||
          lastSig === 0x3a
        ) {
          return true;
        }
        return false; // Don't start regex after other punctuation
      case TokenType.Operator:
        // `/` should NOT start regex after arithmetic operators
        // This prevents `a / b` from being interpreted as regex
        if (
          lastSig === 0x2b ||
          lastSig === 0x2d ||
          lastSig === 0x2a ||
          lastSig === 0x2f ||
          lastSig === 0x25 ||
          lastSig === 0x2a
        ) {
          return false; // Arithmetic operators - don't start regex
        }
        // `/` can start regex after other operators like `=`, `!`, `?`, etc.
        if (
          lastSig === 0x3d ||
          lastSig === 0x21 ||
          lastSig === 0x3f ||
          lastSig === 0x7c ||
          lastSig === 0x26 ||
          lastSig === 0x5e
        ) {
          return true;
        }
        // Check for `++` and `--`
        if (lastTwo === 0x2b2b || lastTwo === 0x2d2d) return false;
        return true; // Default for other operators
      default:
        return true;
    }
  }

  scanRegex(u8: Uint8Array, i: number, n: number): number {
    let j = i + 1;
    let inClass = false;
    while (j < n) {
      const x = u8[j++];
      if (x === 0x5c) {
        if (j < n) j++;
        continue;
      }
      if (x === 0x5b) {
        inClass = true;
        continue;
      }
      if (x === 0x5d) {
        inClass = false;
        continue;
      }
      if (x === 0x2f && !inClass) break;
      if (isNL(x)) break;
    }
    while (j < n) {
      const f = u8[j];
      if ((f >= 0x41 && f <= 0x5a) || (f >= 0x61 && f <= 0x7a)) {
        j++;
      } else {
        break;
      }
    }
    return j;
  }

  scanLineComment(
    u8: Uint8Array,
    i: number,
    n: number,
    seq: LineCommentDef,
  ): number {
    let j = i + seq.length;
    while (j < n && !isNL(u8[j])) j++;
    return j;
  }

  scanBlockComment(
    u8: Uint8Array,
    i: number,
    n: number,
    seq: BlockCommentDef,
  ): number {
    let j = i + seq.open.length;
    while (j + seq.close.length <= n) {
      if (matches(u8, j, seq.close)) {
        return j + seq.close.length;
      }
      j++;
    }
    return n;
  }
}

export class GenericTokenizer {
  private readonly spec: CompiledLanguageSpec;

  constructor(spec: CompiledLanguageSpec) {
    this.spec = spec;
  }

  tokenize(u8: Uint8Array, emit: EmitFn): void {
    const n = u8.length;
    let i = 0;
    let prevType: TokenTypeValue | null = null;
    let prevCode = 0;
    let lastSig = 0;
    let lastTwo = 0;

    const push = (
      type: TokenTypeValue,
      s: number,
      e: number,
      meta?: number,
    ): void => {
      emit(type, s, e, meta);
      if (type !== TokenType.Whitespace) {
        prevType = type;
        prevCode = type === TokenType.Keyword ? (meta ?? 0) : 0;
      }
      if (
        type !== TokenType.Whitespace &&
        type !== TokenType.Newline &&
        type !== TokenType.Comment
      ) {
        lastSig = u8[e - 1];
        lastTwo = ((lastTwo & 0xff) << 8) | lastSig;
      }
    };

    if (i + 1 < n && u8[0] === 0x23 && u8[1] === 0x21) {
      let j = 2;
      while (j < n && !isNL(u8[j])) j++;
      push(TokenType.Comment, 0, j);
      i = j;
    }

    while (i < n) {
      const c = u8[i];

      if (isWS(c)) {
        const s = i;
        do {
          i++;
        } while (i < n && isWS(u8[i]));
        push(TokenType.Whitespace, s, i);
        continue;
      }

      if (isNL(c)) {
        const s = i;
        if (c === 0x0d && i + 1 < n && u8[i + 1] === 0x0a) {
          i += 2;
        } else {
          i++;
        }
        emit(TokenType.Newline, s, i);
        prevType = TokenType.Newline;
        prevCode = 0;
        lastSig = 0;
        lastTwo = 0;
        continue;
      }

      const line = this.spec.matchLineComment(u8, i);
      if (line) {
        const s = i;
        i = this.spec.scanLineComment(u8, i, n, line);
        push(TokenType.Comment, s, i);
        continue;
      }

      const block = this.spec.matchBlockComment(u8, i);
      if (block) {
        const s = i;
        i = this.spec.scanBlockComment(u8, i, n, block);
        push(TokenType.Comment, s, i);
        continue;
      }

      if (this.spec.isIdentStart(c)) {
        const s = i;
        i++;
        for (;;) {
          if (i >= n) break;
          const d = u8[i];
          if (this.spec.isIdentPart(d)) {
            i++;
            continue;
          }
          break;
        }
        const [isKw, code] = this.spec.keywordLookup(u8, s, i);
        push(isKw ? TokenType.Keyword : TokenType.Identifier, s, i, code);
        continue;
      }

      if (
        isDigit(c) ||
        (c === 0x2e &&
          this.spec.allowsLeadingDot() &&
          i + 1 < n &&
          isDigit(u8[i + 1]))
      ) {
        const s = i;
        i = this.spec.scanNumber(u8, i, n);
        push(TokenType.LiteralNum, s, i);
        continue;
      }

      const str = this.spec.matchString(u8, i);
      if (str) {
        const s = i;
        i = this.spec.scanString(u8, i, n, str);
        push(TokenType.LiteralStr, s, i);
        continue;
      }

      if (this.spec.hasTemplateStart(c)) {
        const s = i;
        i = this.spec.scanTemplate(u8, i, n);
        push(TokenType.LiteralTpl, s, i);
        continue;
      }

      if (
        c === 0x2f &&
        this.spec.canStartRegex(prevType, prevCode, lastSig, lastTwo)
      ) {
        const s = i;
        i = this.spec.scanRegex(u8, i, n);
        push(TokenType.Regex, s, i);
        continue;
      }

      const s = i;
      i++;
      const a = c;
      const b = i < n ? u8[i] : 0;
      const c3 = i + 1 < n ? u8[i + 1] : 0;
      const two = (a << 8) | b;
      const three = (two << 8) | c3;
      if (
        three === 0x3d3d3d ||
        three === 0x213d3d ||
        three === 0x3e3e3e ||
        three === 0x3e3e3d ||
        three === 0x3c3c3d
      ) {
        i += 2;
        push(TokenType.Operator, s, i);
        continue;
      }
      if (
        two === 0x2b2b ||
        two === 0x2d2d ||
        two === 0x3d3d ||
        two === 0x213d ||
        two === 0x2626 ||
        two === 0x7c7c ||
        two === 0x2a3d ||
        two === 0x2f3d ||
        two === 0x253d ||
        two === 0x2b3d ||
        two === 0x2d3d ||
        two === 0x263d ||
        two === 0x7c3d ||
        two === 0x5e3d ||
        two === 0x3c3c ||
        two === 0x3e3e ||
        two === 0x3f3a ||
        two === 0x2e2e ||
        two === 0x3d3e
      ) {
        i++;
        push(TokenType.Operator, s, i);
        continue;
      }
      // Check for single-character operators
      if (
        a === 0x2b || // +
        a === 0x2d || // -
        a === 0x2a || // *
        a === 0x2f || // /
        a === 0x25 || // %
        a === 0x3d || // =
        a === 0x21 || // !
        a === 0x3f || // ?
        a === 0x7c || // |
        a === 0x26 || // &
        a === 0x5e || // ^
        a === 0x7e || // ~
        a === 0x3c || // <
        a === 0x3e // >
      ) {
        push(TokenType.Operator, s, i);
        continue;
      }

      const punct =
        a === 0x28 ||
        a === 0x29 ||
        a === 0x5b ||
        a === 0x5d ||
        a === 0x7b ||
        a === 0x7d ||
        a === 0x2c ||
        a === 0x3b ||
        a === 0x3a ||
        a === 0x2e;
      push(punct ? TokenType.Punct : TokenType.Operator, s, i);
    }
  }
}

import { SPAN_BINARY, fromBase64 as fromBase64Span } from "./precompiled";

// Read span bytes from binary using arena-style reading
const spanBuf = fromBase64Span(SPAN_BINARY);
const spanReader = new BinaryReader(spanBuf);
const spanCount = spanReader.readU32();
const spanArray: Uint8Array[] = [];
for (let i = 0; i < spanCount; i++) {
  const len = spanReader.readU32();
  spanArray.push(spanReader.readBytes(len)); // zero-copy subarray
}

const SPAN_BYTES = {
  kw: spanArray[0],
  id: spanArray[1],
  num: spanArray[2],
  str: spanArray[3],
  tpl: spanArray[4],
  com: spanArray[5],
  rx: spanArray[6],
  op: spanArray[7],
  p: spanArray[8],
  close: spanArray[9],
};

export class GenericHighlighter {
  private readonly tokenizer: GenericTokenizer;
  private readonly spec: CompiledLanguageSpec;

  constructor(spec: CompiledLanguageSpec) {
    this.spec = spec;
    this.tokenizer = new GenericTokenizer(spec);
  }

  async highlight(
    u8: Uint8Array,
    languageClass?: string,
    onToken?: (info: {
      lang?: string;
      type: number;
      text: string;
      line: number;
    }) => void,
  ): Promise<Uint8Array> {
    const arena: HtmlArena = borrowHtmlArena();
    try {
      const langClass = languageClass ?? this.spec.name.toLowerCase();

      arena.writeAscii('<pre class="code-block"><code');
      if (langClass) {
        arena.writeAscii(' class="language-');
        arena.writeAscii(langClass);
        arena.writeAscii('"');
      }
      arena.writeAscii(">");

      let lineIndex = 0;
      const emit: EmitFn = (type, s, e) => {
        const tokenText = TD.decode(u8.subarray(s, e));
        if (type !== TokenType.Newline && tokenText.length) {
          onToken?.({
            lang: this.spec.name,
            type,
            text: tokenText,
            line: lineIndex,
          });
        }
        switch (type) {
          case TokenType.Whitespace:
            arena.writeEscaped(u8, s, e);
            return;
          case TokenType.Newline:
            arena.writeByte(0x0a);
            lineIndex++;
            return;
          case TokenType.Identifier:
            arena.writeBytes(SPAN_BYTES.id);
            arena.writeEscaped(u8, s, e);
            arena.writeBytes(SPAN_BYTES.close);
            return;
          case TokenType.Keyword:
            arena.writeBytes(SPAN_BYTES.kw);
            arena.writeEscaped(u8, s, e);
            arena.writeBytes(SPAN_BYTES.close);
            return;
          case TokenType.LiteralNum:
            arena.writeBytes(SPAN_BYTES.num);
            arena.writeEscaped(u8, s, e);
            arena.writeBytes(SPAN_BYTES.close);
            return;
          case TokenType.LiteralStr:
            arena.writeBytes(SPAN_BYTES.str);
            arena.writeEscaped(u8, s, e);
            arena.writeBytes(SPAN_BYTES.close);
            return;
          case TokenType.LiteralTpl:
            arena.writeBytes(SPAN_BYTES.tpl);
            arena.writeEscaped(u8, s, e);
            arena.writeBytes(SPAN_BYTES.close);
            return;
          case TokenType.Comment:
            arena.writeBytes(SPAN_BYTES.com);
            arena.writeEscaped(u8, s, e);
            arena.writeBytes(SPAN_BYTES.close);
            return;
          case TokenType.Regex:
            arena.writeBytes(SPAN_BYTES.rx);
            arena.writeEscaped(u8, s, e);
            arena.writeBytes(SPAN_BYTES.close);
            return;
          case TokenType.Punct:
            arena.writeBytes(SPAN_BYTES.p);
            arena.writeEscaped(u8, s, e);
            arena.writeBytes(SPAN_BYTES.close);
            return;
          case TokenType.Operator:
            arena.writeBytes(SPAN_BYTES.op);
            arena.writeEscaped(u8, s, e);
            arena.writeBytes(SPAN_BYTES.close);
            return;
          default:
            arena.writeEscaped(u8, s, e);
        }
      };

      this.tokenizer.tokenize(u8, emit);

      arena.writeAscii("</code></pre>\n");
      const out = arena.toUint8Array().slice();
      return out;
    } finally {
      releaseHtmlArena(arena);
    }
  }
}

export function compileLanguage(
  author: AuthorLanguageSpec,
): CompiledLanguageSpec {
  return new CompiledLanguageSpec(author);
}

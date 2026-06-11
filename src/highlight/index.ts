import type { AuthorLanguageSpec } from './language-core';
import {
  CompiledLanguageSpec,
  GenericHighlighter,
  GenericTokenizer,
  TokenType,
  type TokenTypeValue,
  compileLanguage,
  BinaryReader,
} from './language-core';
import { LANGUAGE_BINARY, fromBase64 } from './precompiled';
import { HtmlArena } from '../parser';

const NON_CLASS_RE = /[^a-z0-9+#-]+/g;

interface NormalizedLang {
  key: string;
  className: string;
}

function normalizeLanguage(lang?: string): NormalizedLang | undefined {
  if (!lang) return undefined;
  const trimmed = lang.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  const className = lower.replace(NON_CLASS_RE, '-');
  if (!className) return undefined;
  return { key: lower, className };
}

function basicHighlight(bytes: Uint8Array, className?: string): Uint8Array {
  const arena = new HtmlArena(1024);
  arena.writeAscii('<pre class="code-block"><code');
  if (className) {
    arena.writeAscii(' class="language-');
    arena.writeAscii(className);
    arena.writeAscii('"');
  }
  arena.writeAscii('>');
  if (bytes.length) {
    arena.writeEscaped(bytes, 0, bytes.length);
  }
  arena.writeAscii('</code></pre>\n');
  return arena.toUint8Array();
}

type HighlighterLike = {
  highlight: (bytes: Uint8Array, className?: string) => Uint8Array;
};

type LanguageEntry = {
  spec: CompiledLanguageSpec;
  highlighter: HighlighterLike;
};

export type HighlightTokenKind =
  | 'text'
  | 'kw'
  | 'id'
  | 'num'
  | 'str'
  | 'tpl'
  | 'com'
  | 'rx'
  | 'op'
  | 'punc';

export type HighlightTokenSpan = {
  kind: HighlightTokenKind;
  s: number;
  e: number;
};

const aliasRegistry = new Map<string, LanguageEntry>();
const aliasSet = new Set<string>();
const specSet = new Set<CompiledLanguageSpec>();

function registerEntry(entry: LanguageEntry, aliasList: readonly string[]): void {
  specSet.add(entry.spec);
  for (const alias of aliasList) {
    const lower = alias.toLowerCase();
    aliasRegistry.set(lower, entry);
    aliasSet.add(lower);
  }
}

export interface RegisterLanguageOptions {
  spec: AuthorLanguageSpec | CompiledLanguageSpec;
  aliases?: readonly string[];
}

export function registerHighlightLanguage(options: RegisterLanguageOptions): CompiledLanguageSpec {
  const compiled = options.spec instanceof CompiledLanguageSpec ? options.spec : compileLanguage(options.spec);
  const entry: LanguageEntry = {
    spec: compiled,
    highlighter: new GenericHighlighter(compiled),
  };
  const aliasList = options.aliases ?? compiled.aliases ?? [compiled.name];
  registerEntry(entry, aliasList);
  return compiled;
}

let precompiledLoaded = false;
function ensurePrecompiledLoaded(): void {
  if (precompiledLoaded) return;
  const languageBinary = fromBase64(LANGUAGE_BINARY);
  const binaryReader = new BinaryReader(languageBinary);
  const languageCount = binaryReader.readU32();
  for (let i = 0; i < languageCount; i++) {
    const compiled = new CompiledLanguageSpec(binaryReader);
    const entry: LanguageEntry = {
      spec: compiled,
      highlighter: new GenericHighlighter(compiled),
    };
    registerEntry(entry, compiled.aliases);
  }
  precompiledLoaded = true;
}

export async function highlightCodeBlock(bytes: Uint8Array, lang?: string): Promise<Uint8Array> {
  ensurePrecompiledLoaded();
  const normalized = normalizeLanguage(lang);

  if (normalized) {
    const entry = aliasRegistry.get(normalized.key);
    if (entry) {
      return entry.highlighter.highlight(bytes, normalized.className);
    }
  }
  return basicHighlight(
    bytes,
    normalized?.className ?? (lang ? lang.toLowerCase() : undefined),
  );
}

function tokenKind(type: TokenTypeValue): HighlightTokenKind {
  switch (type) {
    case TokenType.Keyword:
      return 'kw';
    case TokenType.Identifier:
      return 'id';
    case TokenType.LiteralNum:
      return 'num';
    case TokenType.LiteralStr:
      return 'str';
    case TokenType.LiteralTpl:
      return 'tpl';
    case TokenType.Comment:
      return 'com';
    case TokenType.Regex:
      return 'rx';
    case TokenType.Operator:
      return 'op';
    case TokenType.Punct:
      return 'punc';
    default:
      return 'text';
  }
}

export function tokenizeCodeBlock(bytes: Uint8Array, lang?: string): HighlightTokenSpan[] | null {
  ensurePrecompiledLoaded();
  const normalized = normalizeLanguage(lang);
  if (!normalized) return null;

  const entry = aliasRegistry.get(normalized.key);
  if (!entry) return null;

  const tokens: HighlightTokenSpan[] = [];
  const tokenizer = new GenericTokenizer(entry.spec);
  tokenizer.tokenize(bytes, (type, s, e) => {
    if (s >= e) return;
    tokens.push({ kind: tokenKind(type), s, e });
  });
  return tokens;
}

export function getRegisteredHighlightLanguages(): string[] {
  ensurePrecompiledLoaded();
  return Array.from(aliasSet.values()).sort();
}

export function getRegisteredHighlightSpecs(): { name: string; aliases: readonly string[] }[] {
  ensurePrecompiledLoaded();
  return Array.from(specSet.values()).map((spec) => ({ name: spec.name, aliases: spec.aliases ?? [spec.name] }));
}

export function getLanguageSpec(lang?: string): CompiledLanguageSpec | undefined {
  ensurePrecompiledLoaded();
  const normalized = normalizeLanguage(lang);
  if (normalized) {
    const entry = aliasRegistry.get(normalized.key);
    return entry?.spec;
  }
  return undefined;
}

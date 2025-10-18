import { HtmlArena } from '../parser/arena';
import { builtinLanguageSpecs } from './builtins';
import type { AuthorLanguageSpec } from './language-core';
import { CompiledLanguageSpec, GenericHighlighter, compileLanguage } from './language-core';
import { JS_ALIASES, getJavaScriptSpec } from './js-highlighter';

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
  const arena = new HtmlArena();
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

type LanguageEntry = {
  spec: CompiledLanguageSpec;
  highlighter: GenericHighlighter;
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

const jsSpec = getJavaScriptSpec();
registerEntry(
  {
    spec: jsSpec,
    highlighter: new GenericHighlighter(jsSpec),
  },
  JS_ALIASES,
);

for (const spec of builtinLanguageSpecs) {
  registerHighlightLanguage({ spec });
}

export function highlightCodeBlock(bytes: Uint8Array, lang?: string): Uint8Array {
  const normalized = normalizeLanguage(lang);
  if (normalized) {
    const entry = aliasRegistry.get(normalized.key);
    if (entry) {
      return entry.highlighter.highlight(bytes, normalized.className);
    }
  }
  return basicHighlight(bytes, normalized?.className ?? (lang ? lang.toLowerCase() : undefined));
}

export function getRegisteredHighlightLanguages(): string[] {
  return Array.from(aliasSet.values()).sort();
}

export function getRegisteredHighlightSpecs(): { name: string; aliases: readonly string[] }[] {
  return Array.from(specSet.values()).map((spec) => ({ name: spec.name, aliases: spec.aliases ?? [spec.name] }));
}

export function getLanguageSpec(lang?: string): CompiledLanguageSpec | undefined {
  const normalized = normalizeLanguage(lang);
  if (normalized) {
    const entry = aliasRegistry.get(normalized.key);
    return entry?.spec;
  }
  return undefined;
}

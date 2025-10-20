import type { AuthorLanguageSpec } from './language-core';
import { CompiledLanguageSpec, GenericHighlighter, compileLanguage, BinaryReader } from './language-core';
import { LANGUAGE_BINARY, fromBase64 } from './precompiled';

// Lazy import for HtmlArena (only needed in browser contexts)
let HtmlArena: any;
async function getHtmlArena() {
  if (!HtmlArena) {
    try {
      // Dynamic import for browser environments
      const arenaModule = await import('../parser/arena');
      HtmlArena = arenaModule.HtmlArena;
    } catch (e) {
      // Fallback for environments where arena might not be available
      HtmlArena = class {
        writeAscii() {}
        writeEscaped() {}
        toUint8Array() { return new Uint8Array(); }
      };
    }
  }
  return HtmlArena;
}

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

async function basicHighlight(bytes: Uint8Array, className?: string): Promise<Uint8Array> {
  const ArenaClass = await getHtmlArena();
  const arena = new ArenaClass();
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
  return await basicHighlight(bytes, normalized?.className ?? (lang ? lang.toLowerCase() : undefined));
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

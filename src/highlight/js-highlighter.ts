import type { AuthorLanguageSpec, CompiledLanguageSpec } from './language-core';
import { GenericHighlighter, compileLanguage } from './language-core';

export const JS_ALIASES = [
  'js',
  'javascript',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'typescript',
  'jsx',
  'node',
] as const;

const JS_KEYWORDS: AuthorLanguageSpec['keywords'] = [
  { word: 'break' },
  { word: 'case', code: 3 },
  { word: 'catch' },
  { word: 'class' },
  { word: 'const' },
  { word: 'continue' },
  { word: 'debugger' },
  { word: 'default' },
  { word: 'delete', code: 6 },
  { word: 'do' },
  { word: 'else' },
  { word: 'enum' },
  { word: 'export' },
  { word: 'extends' },
  { word: 'finally' },
  { word: 'for' },
  { word: 'function' },
  { word: 'if' },
  { word: 'implements' },
  { word: 'import' },
  { word: 'in', code: 7 },
  { word: 'instanceof', code: 8 },
  { word: 'interface' },
  { word: 'let' },
  { word: 'new', code: 9 },
  { word: 'package' },
  { word: 'private' },
  { word: 'protected' },
  { word: 'public' },
  { word: 'return', code: 1 },
  { word: 'static' },
  { word: 'super' },
  { word: 'switch' },
  { word: 'this' },
  { word: 'throw', code: 2 },
  { word: 'try' },
  { word: 'typeof', code: 4 },
  { word: 'var' },
  { word: 'void', code: 5 },
  { word: 'while' },
  { word: 'with' },
  { word: 'yield' },
  { word: 'await' },
  { word: 'as' },
  { word: 'from' },
  { word: 'of' },
];

const JS_SPEC: AuthorLanguageSpec = {
  name: 'javascript',
  aliases: JS_ALIASES,
  keywords: JS_KEYWORDS,
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  strings: [
    { quote: "'", escape: '\\' },
    { quote: '"', escape: '\\' },
  ],
  numbers: {
    allowHex: true,
    allowBin: true,
    allowOct: true,
    allowUnderscore: true,
    allowBigInt: true,
    allowExp: true,
    allowLeadingDot: true,
  },
  regex: { enabled: true },
  templates: { enabled: true, quote: '`', interpOpen: '${', interpClose: '}' },
};

const compiled = compileLanguage(JS_SPEC);

export function getJavaScriptSpec(): CompiledLanguageSpec {
  return compiled;
}

export class JSHighlighter {
  private readonly highlighter: GenericHighlighter;

  constructor() {
    this.highlighter = new GenericHighlighter(compiled);
  }

  highlight(u8: Uint8Array, languageClass?: string): Uint8Array {
    return this.highlighter.highlight(u8, languageClass ?? 'javascript');
  }
}


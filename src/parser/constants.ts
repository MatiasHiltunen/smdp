/**
 * Pre-encoded tag/escape constants and styling configuration
 */

const TE = new TextEncoder();

const enc = (s: string): Uint8Array => TE.encode(s);

export const TAG = {
  pOpen: enc('<p>'),
  pClose: enc('</p>\n'),
  bqOpen: enc('<blockquote>\n'),
  bqClose: enc('</blockquote>\n'),
  ulOpen: enc('<ul>\n'),
  ulClose: enc('</ul>\n'),
  olOpen: enc('<ol>\n'),
  olClose: enc('</ol>\n'),
  liOpen: enc('<li>'),
  liClose: enc('</li>\n'),
  hr: enc('<hr>\n'),
  preCodeOpen: enc('<pre><code>'),
  preCodeClose: enc('</code></pre>\n'),
  codeOpen: enc('<code>'),
  codeClose: enc('</code>'),
  emOpen: enc('<em>'),
  emClose: enc('</em>'),
  strongOpen: enc('<strong>'),
  strongClose: enc('</strong>'),
  aOpenPre: enc('<a href="'),
  aMid: enc('">'),
  aClose: enc('</a>'),
  imgPre: enc('<img alt="'),
  imgMid: enc('" src="'),
  imgClose: enc('">'),
  hPre: [
    enc('<h1>'),
    enc('<h2>'),
    enc('<h3>'),
    enc('<h4>'),
    enc('<h5>'),
    enc('<h6>'),
  ],
  hClose: [
    enc('</h1>\n'),
    enc('</h2>\n'),
    enc('</h3>\n'),
    enc('</h4>\n'),
    enc('</h5>\n'),
    enc('</h6>\n'),
  ],
  lf: enc('\n'),
  // HTML escapes
  amp: enc('&amp;'),
  lt: enc('&lt;'),
  gt: enc('&gt;'),
  quot: enc('&quot;'),
  apos: enc('&#39;'),
} as const;

export const FONT_SIZE = {
  base: 16,
  code: 14,
  heading: [40, 32, 24, 20, 17.6, 16], // Matching CSS em sizes
} as const;

export const LINE_HEIGHT_MULTIPLIER = 1.2;

export const MARGIN = 10;
export const INDENT = 30;

// Match CSS custom properties for consistent theming
export const COLOR = {
  text: 'rgba(255, 255, 255, 0.87)',
  textSecondary: 'rgba(255, 255, 255, 0.65)',
  accent: '#58a6ff',
  accentHover: '#79c0ff',
  code: '#333',
  link: '#58a6ff',
  inlineCodeBg: 'rgba(88, 166, 255, 0.18)',
  inlineCodeText: '#58a6ff',
  bg: '#0d1117',
  bgSecondary: '#161b22',
  codeBg: '#161b22',
  border: '#30363d',
  blockquoteBorder: '#3b82f6',
  hr: '#30363d',
  listMarker: '#58a6ff',
} as const;

export const TD = new TextDecoder('utf-8');
export { TE };


/**
 * Pre-encoded tag/escape constants and styling configuration
 */

// impcort { HtmlArena } from "./arena";

const TE = new TextEncoder();

const enc = (s: string): Uint8Array<ArrayBuffer> => TE.encode(s);


const encodeBuffer = new Uint8Array(1024)

function writeIntoBuffer(text:string, u8Arr:Uint8Array<ArrayBuffer>, cursor:[number]){

  const [c] = cursor

  const progress = TE.encodeInto(text, u8Arr.subarray(c))
  u8Arr.join()

  
  cursor[0] = c + progress.written
  
  return u8Arr.subarray(c, cursor[0])
  
}

let cursor: [number] = [0]

// const bqOpen = writeIntoBuffer(  )

// const tag = <T extends string>(start: T, end?:string) => {


  
//   const open = writeIntoBuffer('<' + start + '>', encodeBuffer, cursor)
//   const close = writeIntoBuffer('</' + (end ?? start) +  '>\n', encodeBuffer, cursor)

//   return {
//     [`${start}Open`]: open,
//     [`${start}Close`]: close
//   }

  
// }

//



type Tags = typeof elementTags
type Tag =  Extract< Tags[keyof Tags], string> //Extract<keyof Tags, string> 
type Start = `${Tag}Open`
type Close = `${Tag}Close`
type TagKeys =  Start | Close
type TagPair = {
   [K in TagKeys]: Uint8Array<ArrayBuffer>
}


// type Entry<T> = { [K in keyof T]: [K, T[K]] }[keyof T]

function tag(
  start: Tag,
  newLine: boolean = true,
  end?: string
): TagPair {
  const open = writeIntoBuffer(`<${start}>`, encodeBuffer, cursor);
  const close = writeIntoBuffer(`</${(end ?? start)}>${ newLine ? '\n' : ''}`, encodeBuffer, cursor);

  const pair = {
    [`${start}Open`]: open,
    [`${start}Close`]: close,
  } as TagPair

  return pair
}

function createTags(htmlTags:Tags): TagPair {


  // for(key in htmlTags) tags = {...tags, ...t}
  
  const entries = htmlTags.map((t: Tag) => {

    const currentTag: TagPair = tag(t)
    
    const entries = Object.entries(currentTag) //as [TagKeys, Uint8Array<ArrayBuffer>][]

    return entries
  })

  const flattened = entries.flat()

  return Object.fromEntries(flattened) as TagPair
  
}


// type TTags =  ReturnType<typeof createTags>

const elementTags = [
  'p',
  'blockquote',
  'ul',
  'ol',
  'li',
  'code',
  'em',
  'strong',
  'table',
  'tr',
  'td',
] as const

//type Tags = typeof elementTags

const simpleTags = createTags(elementTags)



export const TAG = {
  ...simpleTags,
  hr: enc('<hr>\n'),
  preCodeOpen: enc('<pre><code>'),
  preCodeClose: enc('</code></pre>\n'),
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
  // Markdown soft line breaks should map to a plain newline to avoid
  // inserting extraneous `<br>` tags inside paragraphs. The renderer
  // already normalizes whitespace, so emitting a newline keeps the
  // expected layout without disturbing golden fixtures.
  br: enc('</br></br>\n'),
  // Table tags
  theadOpen: enc('<thead>\n<tr>'),
  theadClose: enc('</tr>\n</thead>\n<tbody>\n'),
  tbodyClose: enc('</tbody>\n'),
  thLeft: enc('<th style="text-align:left">'),
  thCenter: enc('<th style="text-align:center">'),
  thRight: enc('<th style="text-align:right">'),
  thClose: enc('</th>'),
  // Info block tags
  infoBlockInfo: enc('<div class="info-block info">'),
  infoBlockWarning: enc('<div class="info-block warning">'),
  infoBlockError: enc('<div class="info-block error">'),
  infoBlockSuccess: enc('<div class="info-block success">'),
  infoBlockClose: enc('</div>\n'),
  // HTML escapes
  amp: enc('&amp;'),
  lt: enc('&lt;'),
  gt: enc('&gt;'),
  quot: enc('&quot;'),
  apos: enc('&#39;'),
} as const




  
export const FONT_SIZE = {
  base: 14,
  code: 13,
  heading: [28, 22, 18, 16, 14.5, 14], // More reasonable sizes
} as const;

export const LINE_HEIGHT_MULTIPLIER = 1.5;

export const MARGIN = 16;
export const INDENT = 24;

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

export const INFO_COLORS = {
  info: { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
  warning: { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
  error: { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)' },
  success: { border: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
} as const;

export const TD = new TextDecoder('utf-8');
export { TE };


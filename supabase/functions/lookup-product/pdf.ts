// A PDF's words, read well enough to check a part number against.
//
// Pure on purpose, like `lookup.ts`: `run.ts` downloads the file and inflates
// its streams, and everything below is string work that jest can hold to.
//
// **Why this is more than reading the strings a page draws.** The first reader
// took every `(literal)` string a content stream drew. That works for a PDF
// whose fonts are plain single-byte fonts, and almost no manual is one: a
// manual typeset by InDesign or a documentation system embeds subset fonts and
// draws `<0041004C>` — glyph numbers, which mean nothing until the font's own
// `ToUnicode` map says which letters they are. Measured on 6 October 2026, the
// first reader got 3,838 characters out of a 56-page Bosch dishwasher manual,
// none of them the model number; a part code printed in such a manual could
// never be confirmed, however right the search was.
//
// So this reads the file's objects (object streams included), finds each
// page's fonts and their `ToUnicode` maps, and decodes what every text
// operator draws through the font in use at that moment. It is still best
// effort, and it is wrong only towards reading less: a font with no map reads
// as nothing, and nothing confirms nothing.

/** One stream, as `run.ts` hands it over: its dictionary and its bytes, inflated where they were compressed. */
export interface PdfStream {
  /** The object number the stream belongs to, when its `N G obj` header was found. */
  obj: number | null;
  dict: string;
  /** One character per byte. */
  data: string;
}

export interface StreamSpan {
  obj: number | null;
  dict: string;
  start: number;
  end: number;
  flate: boolean;
}

// Streams that hold no words and cost the most to inflate: pictures, and the
// font programs themselves (a subset font is tens of kilobytes, and a manual
// embeds dozens). The cross-reference stream says nothing either.
const WORDLESS = /\/Subtype\s*\/Image\b|\/Length[123]\b|\/Subtype\s*\/(?:Type1C|CIDFontType0C|OpenType)\b|\/Type\s*\/(?:XRef|Metadata)\b/;

/**
 * Where a PDF's streams are, and whether each is worth inflating.
 *
 * Given the file as latin1 (one character per byte), so offsets are byte
 * offsets. The dictionary is read from the object's own `N G obj` header, so
 * a nested dictionary (`/DecodeParms << … >>`) cannot hide its `/Filter`.
 */
export function pdfStreams(latin1: string): StreamSpan[] {
  const found: StreamSpan[] = [];
  const marker = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(latin1))) {
    const head = latin1.slice(Math.max(0, match.index - 4096), match.index);
    const header = [...head.matchAll(/(\d+)\s+\d+\s+obj\b/g)].pop();
    let obj: number | null = null;
    let dict: string;
    if (header) {
      obj = Number(header[1]);
      dict = head.slice((header.index ?? 0) + header[0].length);
    } else {
      const dictStart = latin1.lastIndexOf('<<', match.index);
      dict = dictStart >= 0 ? latin1.slice(dictStart, match.index) : '';
    }
    const start = match.index + match[0].length;
    const close = latin1.indexOf('endstream', start);
    if (close < 0) break;
    marker.lastIndex = close + 9;
    if (WORDLESS.test(dict)) continue;
    found.push({ obj, dict, start, end: streamEnd(latin1, dict, start, close), flate: /\/FlateDecode/.test(dict) });
  }
  return found;
}

/**
 * Bytes as one character per byte, each character's code the byte's value.
 * Not `new TextDecoder('latin1')`: the Encoding standard maps that label to
 * windows-1252, which turns bytes 0x80-0x9F into other characters (0x80 is
 * `€`, U+20AC), and a two-byte glyph code written as a literal string is
 * exactly where those bytes appear.
 */
export function latin1Of(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[]);
  }
  return out;
}

/**
 * Where a stream's own bytes end. Not at `endstream`: the line break before
 * it is not part of the data, and Deno's `DecompressionStream` answers a
 * compressed stream with anything after its end by throwing *failed to write
 * whole buffer* and keeping none of what it had inflated. Until this, every
 * compressed stream in the Bosch and Mitsubishi manuals read as nothing on the
 * server, whatever Node made of them. So the stream's `/Length` is used when it
 * is written as a number and agrees with the file, and otherwise the line
 * break is trimmed.
 */
function streamEnd(latin1: string, dict: string, start: number, close: number): number {
  const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
  if (length) {
    const end = start + Number(length[1]);
    if (end <= close && /^\s*$/.test(latin1.slice(end, close))) return end;
  }
  let end = close;
  if (latin1[end - 1] === '\n') end -= 1;
  if (latin1[end - 1] === '\r') end -= 1;
  return Math.max(start, end);
}

// ------------------------------------------------------------ reading values

const DELIMITER = /[\s/\[\]()<>{}%]/;

/** The extent of the balanced `<< … >>`, `[ … ]` or `( … )` that starts at `at`. */
function balanced(text: string, at: number): number {
  if (text.startsWith('<<', at)) {
    let depth = 0;
    for (let i = at; i < text.length - 1; i += 1) {
      if (text[i] === '(') i = balanced(text, i) - 1;
      else if (text.startsWith('<<', i)) { depth += 1; i += 1; }
      else if (text[i] === '<') { const close = text.indexOf('>', i); i = close < 0 ? text.length : close; }
      else if (text.startsWith('>>', i)) { depth -= 1; i += 1; if (depth === 0) return i + 1; }
    }
    return text.length;
  }
  if (text[at] === '[') {
    let depth = 0;
    for (let i = at; i < text.length; i += 1) {
      if (text[i] === '(') i = balanced(text, i) - 1;
      else if (text[i] === '[') depth += 1;
      else if (text[i] === ']') { depth -= 1; if (depth === 0) return i + 1; }
    }
    return text.length;
  }
  if (text[at] === '(') {
    let depth = 0;
    for (let i = at; i < text.length; i += 1) {
      if (text[i] === '\\') i += 1;
      else if (text[i] === '(') depth += 1;
      else if (text[i] === ')') { depth -= 1; if (depth === 0) return i + 1; }
    }
    return text.length;
  }
  return at;
}

/** The raw value of `/Key` in a dictionary's text — a reference, a dictionary, an array, a name or a string. */
export function valueOf(dict: string, key: string): string | null {
  const pattern = new RegExp(`/${key}(?=${DELIMITER.source})`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(dict))) {
    let at = match.index + match[0].length;
    while (at < dict.length && /\s/.test(dict[at])) at += 1;
    const c = dict[at];
    if (c === '<' || c === '[' || c === '(') return dict.slice(at, balanced(dict, at));
    if (c === '/') return /^\/[^\s/\[\]()<>{}%]*/.exec(dict.slice(at))?.[0] ?? null;
    const ref = /^(\d+)\s+(\d+)\s+R\b/.exec(dict.slice(at, at + 40));
    if (ref) return ref[0];
    const word = /^[^\s/\[\]()<>{}%]+/.exec(dict.slice(at));
    if (word) return word[0];
  }
  return null;
}

const refTo = (value: string | null): number | null => {
  const ref = value ? /^(\d+)\s+\d+\s+R$/.exec(value.trim()) : null;
  return ref ? Number(ref[1]) : null;
};

/** The bytes a literal `( … )` or hex `< … >` string stands for, one character per byte. */
export function stringBytes(token: string): string {
  if (token[0] === '<') {
    const hex = token.slice(1, -1).replace(/[^0-9A-Fa-f]/g, '');
    const even = hex.length % 2 ? `${hex}0` : hex;
    let out = '';
    for (let i = 0; i < even.length; i += 2) out += String.fromCharCode(parseInt(even.slice(i, i + 2), 16));
    return out;
  }
  return token.slice(1, -1).replace(/\\(\r\n|[\r\n]|[0-7]{1,3}|[\s\S])/g, (_, esc: string) => {
    if (/^[\r\n]/.test(esc)) return ''; // a line continued
    if (/^[0-7]+$/.test(esc)) return String.fromCharCode(parseInt(esc, 8) & 0xff);
    return ({ n: '\n', r: '\r', t: '\t', b: '', f: '' } as Record<string, string>)[esc] ?? esc;
  });
}

/** A document-information string: PDFDocEncoding, or UTF-16 behind its byte-order mark. */
function infoString(token: string): string {
  const bytes = stringBytes(token);
  if (bytes.startsWith('\xfe\xff')) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1));
    return out;
  }
  return bytes;
}

// ------------------------------------------------------------ fonts

/** How a font's codes become letters. */
export interface FontMap {
  /** Bytes per code. */
  width: 1 | 2;
  /** Code to text, from `ToUnicode`; null for a simple font read as its bytes. */
  map: Map<number, string> | null;
}

const utf16 = (hex: string): string => {
  if (hex.length <= 2) return String.fromCharCode(parseInt(hex || '0', 16));
  let out = '';
  for (let i = 0; i + 3 < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return out;
};

/** A `ToUnicode` CMap, as code to text. */
export function parseCMap(cmap: string): { width: 1 | 2; map: Map<number, string> } {
  const map = new Map<number, string>();
  const space = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(cmap);
  const width: 1 | 2 = space && space[1].length <= 2 ? 1 : 2;

  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      map.set(parseInt(pair[1], 16), utf16(pair[2]));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
      const low = parseInt(range[1], 16);
      const high = parseInt(range[2], 16);
      if (!(high >= low) || high - low > 0xffff) continue;
      if (range[3][0] === '[') {
        const each = [...range[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((one) => one[1]);
        each.forEach((hex, i) => { if (low + i <= high) map.set(low + i, utf16(hex)); });
      } else {
        const base = utf16(range[3].slice(1, -1));
        if (!base) continue;
        const head = base.slice(0, -1);
        const last = base.charCodeAt(base.length - 1);
        for (let code = low; code <= high; code += 1) map.set(code, head + String.fromCharCode(last + code - low));
      }
    }
  }
  return { width, map };
}

/** What a string drawn in `font` says. A font with no map reads as its bytes only when they are plain text. */
export function decodeWith(bytes: string, font: FontMap | null): string {
  if (!font || !font.map) {
    if (font?.width === 2) return '';
    return /^[\x20-\x7e\u00a0-\u00ff\t\r\n]*$/.test(bytes) ? bytes : '';
  }
  let out = '';
  for (let i = 0; i + font.width <= bytes.length; i += font.width) {
    const code = font.width === 2 ? (bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1) : bytes.charCodeAt(i);
    const said = font.map.get(code);
    if (said) out += said;
  }
  // Control characters, zero-width joiners and the private use area are a font's internals, not words.
  return out.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200d\u2060\ufeff\ue000-\uf8ff]/g, '');
}

// ------------------------------------------------------------ content streams

// One token of a content stream: a literal string (one level of unescaped
// nesting allowed), a hex string, a dictionary bracket, a name, a number, an
// array bracket, or an operator.
const TOKEN = /\((?:\\[\s\S]|[^\\()]|\((?:\\[\s\S]|[^\\()])*\))*\)|<<|>>|<[0-9A-Fa-f\s]*>|\/[^\s/\[\]()<>{}%]*|[-+]?(?:\d+\.?\d*|\.\d+)|\[|\]|[A-Za-z'"*]+[0-9]?|%[^\r\n]*/g;

type Operand = string | number | Operand[];

const isSpace = (c: string | undefined) => c === undefined || c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';

/** Where operator `op` next stands on its own, at or after `from`; -1 if nowhere. */
function findOperator(content: string, op: string, from: number): number {
  for (let at = content.indexOf(op, from); at >= 0; at = content.indexOf(op, at + 1)) {
    if (isSpace(content[at - 1]) && isSpace(content[at + op.length])) return at;
  }
  return -1;
}

/**
 * The words a content stream draws, decoded through the font each one is drawn
 * in. `fonts` maps a resource name (`/F1`) to its decoding; a name it does not
 * hold reads as plain bytes or nothing. Moving to a new line or a new place
 * on the page is a space, so words drawn apart do not run together.
 *
 * Only text objects (`BT` … `ET`) are read token by token: most of a manual's
 * page is drawing, and walking every number in it was nearly all the time this
 * took. A font chosen between text objects still counts.
 */
export function contentText(content: string, fonts: Record<string, FontMap | null> = {}): string {
  const out: string[] = [];
  let font: FontMap | null = null;
  let stack: Operand[] = [];
  const arrays: Operand[][] = [];
  const push = (value: Operand) => (arrays.length ? arrays[arrays.length - 1].push(value) : stack.push(value));
  const say = (bytes: string) => {
    const words = decodeWith(bytes, font);
    if (words) out.push(words);
  };
  const gap = () => {
    if (out.length && out[out.length - 1] !== ' ') out.push(' ');
  };

  for (let from = 0; ;) {
    const begin = findOperator(content, 'BT', from);
    if (begin < 0) break;
    // A font set outside a text object carries into it.
    const tf = content.lastIndexOf('Tf', begin);
    if (tf > from) {
      const set = /\/([^\s/\[\]()<>{}%]+)\s+[-+\d.]+\s*$/.exec(content.slice(Math.max(from, tf - 120), tf));
      if (set) font = fonts[set[1]] ?? null;
    }
    const finish = findOperator(content, 'ET', begin + 2);
    const stop = finish < 0 ? content.length : finish;
    gap();

    TOKEN.lastIndex = begin + 2;
    let match: RegExpExecArray | null;
    while ((match = TOKEN.exec(content)) && match.index < stop) {
      const token = match[0];
      const c = token.charCodeAt(0);
      if (c === 37 /* % */) continue;
      if (c === 40 /* ( */ || (c === 60 /* < */ && token[1] !== '<')) { push(token); continue; }
      if (token === '<<' || token === '>>') continue;
      if (c === 47 /* / */) { push(token); continue; }
      if (c === 91 /* [ */) { arrays.push([]); continue; }
      if (c === 93 /* ] */) { push(arrays.pop() ?? []); continue; }
      if ((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46) { push(Number(token)); continue; }

      // An operator: act on what is on the stack, then clear it.
      switch (token) {
        case 'Tf': {
          const name = stack[stack.length - 2];
          font = typeof name === 'string' && name[0] === '/' ? fonts[name.slice(1)] ?? null : null;
          break;
        }
        case 'Tj': {
          const one = stack[stack.length - 1];
          if (typeof one === 'string') say(stringBytes(one));
          break;
        }
        case "'":
        case '"': {
          gap();
          const one = stack[stack.length - 1];
          if (typeof one === 'string') say(stringBytes(one));
          break;
        }
        case 'TJ': {
          const list = stack[stack.length - 1];
          if (Array.isArray(list)) {
            for (const one of list) {
              if (typeof one === 'string') say(stringBytes(one));
              // A wide negative adjustment is the space between two words.
              else if (typeof one === 'number' && one < -200) gap();
            }
          }
          break;
        }
        case 'Td': case 'TD': case 'Tm': case 'T*':
          gap();
          break;
      }
      stack = [];
      arrays.length = 0;
    }
    stack = [];
    arrays.length = 0;
    gap();
    from = stop + 2;
  }
  return out.join('').replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------ the document

/**
 * Every word a PDF draws, page by page, through each page's own fonts — and
 * the document's title, subject and keywords, which often name the model when
 * nothing on the cover can be read.
 */
export function pdfText(latin1: string, streams: PdfStream[]): string {
  // ---- every object's dictionary, from the file and from object streams
  const bodies = new Map<number, string>();
  const objHeader = /(\d+)\s+\d+\s+obj\b/g;
  let match: RegExpExecArray | null;
  while ((match = objHeader.exec(latin1))) {
    const from = match.index + match[0].length;
    const stop = latin1.slice(from, from + 65536).search(/endobj|\bstream\r?\n/);
    bodies.set(Number(match[1]), latin1.slice(from, stop < 0 ? from + 4096 : from + stop));
    if (stop > 0) objHeader.lastIndex = from + stop;
  }
  const byObj = new Map<number, PdfStream>();
  for (const stream of streams) {
    if (stream.obj !== null) byObj.set(stream.obj, stream);
    if (!/\/Type\s*\/ObjStm\b/.test(stream.dict)) continue;
    const n = Number(valueOf(stream.dict, 'N'));
    const first = Number(valueOf(stream.dict, 'First'));
    if (!Number.isFinite(n) || !Number.isFinite(first) || n <= 0) continue;
    const numbers = stream.data.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n && 2 * i + 1 < numbers.length; i += 1) {
      const at = first + numbers[2 * i + 1];
      const next = 2 * i + 3 < numbers.length ? first + numbers[2 * i + 3] : stream.data.length;
      if (!bodies.has(numbers[2 * i])) bodies.set(numbers[2 * i], stream.data.slice(at, next));
    }
  }

  /** A dictionary, inline or behind a reference. */
  const dictOf = (value: string | null, depth = 0): string | null => {
    if (!value || depth > 4) return null;
    const ref = refTo(value);
    if (ref === null) return value.trim().startsWith('<<') ? value : null;
    const body = bodies.get(ref);
    if (!body) return null;
    const at = body.indexOf('<<');
    return at < 0 ? dictOf(body.trim(), depth + 1) : body.slice(at, balanced(body, at));
  };

  // ---- fonts, each decoded once
  const fontCache = new Map<string, FontMap | null>();
  const fontFrom = (value: string): FontMap | null => {
    const key = value.trim();
    if (fontCache.has(key)) return fontCache.get(key) ?? null;
    let font: FontMap | null = null;
    const dict = dictOf(value);
    if (dict) {
      const twoByte = /\/Subtype\s*\/Type0\b/.test(dict);
      const cmap = byObj.get(refTo(valueOf(dict, 'ToUnicode')) ?? -1);
      if (cmap) {
        const parsed = parseCMap(cmap.data);
        font = { width: parsed.width, map: parsed.map };
      } else {
        font = { width: twoByte ? 2 : 1, map: null };
      }
    }
    fontCache.set(key, font);
    return font;
  };
  const fontsOf = (resources: string | null): Record<string, FontMap | null> => {
    const fonts: Record<string, FontMap | null> = {};
    const dict = dictOf(resources);
    const fontDict = dict ? dictOf(valueOf(dict, 'Font')) : null;
    if (!fontDict) return fonts;
    for (const entry of fontDict.matchAll(/\/([^\s/\[\]()<>{}%]+)\s*(\d+\s+\d+\s+R|<<)/g)) {
      const value = entry[2] === '<<' ? fontDict.slice(entry.index! + entry[0].length - 2, balanced(fontDict, entry.index! + entry[0].length - 2)) : entry[2];
      fonts[entry[1]] = fontFrom(value);
    }
    return fonts;
  };

  // ---- pages, in the order the file holds them, through their own fonts
  const words: string[] = [];
  const read = new Set<number>();
  const drawn = (ref: number, resources: string | null, depth = 0) => {
    if (read.has(ref) || depth > 3) return;
    const stream = byObj.get(ref);
    if (!stream) return;
    read.add(ref);
    const own = valueOf(stream.dict, 'Resources') ?? resources;
    const said = contentText(stream.data, fontsOf(own));
    if (said) words.push(said);
    // Forms drawn inside it carry text of their own.
    const xobjects = dictOf(own) ? dictOf(valueOf(dictOf(own)!, 'XObject')) : null;
    for (const entry of xobjects?.matchAll(/\/[^\s/\[\]()<>{}%]+\s*(\d+)\s+\d+\s+R/g) ?? []) {
      const form = byObj.get(Number(entry[1]));
      if (form && /\/Subtype\s*\/Form\b/.test(form.dict)) drawn(Number(entry[1]), own, depth + 1);
    }
  };
  const pageNumbers = [...bodies.entries()]
    .filter(([, body]) => /\/Type\s*\/Page(?![A-Za-z])/.test(body))
    .map(([n]) => n)
    .sort((a, b) => a - b);
  for (const n of pageNumbers) {
    const body = bodies.get(n)!;
    let resources = valueOf(body, 'Resources');
    // Resources a page does not state are its parent's.
    for (let parent = refTo(valueOf(body, 'Parent')), hops = 0; !resources && parent !== null && hops < 10; hops += 1) {
      const up = bodies.get(parent);
      if (!up) break;
      resources = valueOf(up, 'Resources');
      parent = refTo(valueOf(up, 'Parent'));
    }
    const contents = valueOf(body, 'Contents');
    const refs = contents ? [...contents.matchAll(/(\d+)\s+\d+\s+R/g)].map((one) => Number(one[1])) : [];
    for (const ref of refs) drawn(ref, resources);
  }

  // ---- anything that draws text and belongs to no page found above
  for (const stream of streams) {
    if (stream.obj !== null && read.has(stream.obj)) continue;
    if (/\/Type\s*\/ObjStm\b/.test(stream.dict) || !/\bBT\b/.test(stream.data)) continue;
    const said = contentText(stream.data);
    if (said) words.push(said);
  }

  // ---- the document's own description of itself
  const info: string[] = [];
  for (const body of bodies.values()) {
    if (!/\/(?:Producer|Creator)\b/.test(body) || /\/Type\s*\/Page/.test(body)) continue;
    for (const key of ['Title', 'Subject', 'Keywords']) {
      const value = valueOf(body, key);
      if (value && (value[0] === '(' || value[0] === '<')) info.push(infoString(value));
    }
  }

  return [...info, ...words].join(' ').replace(/\s+/g, ' ').trim();
}

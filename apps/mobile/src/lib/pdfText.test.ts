import {
  contentText, decodeWith, latin1Of, parseCMap, pdfStreams, pdfText, stringBytes, valueOf, type PdfStream,
} from '../../../../supabase/functions/lookup-product/pdf';

// The PDF reader `lookup-product` checks a part number against. The first one
// read only the `(literal)` strings a page drew, and a manual set in embedded
// subset fonts draws glyph numbers instead: on 6 October 2026 it got 3,838
// characters out of a 56-page Bosch manual, none of them the model number.
// These pin the parts that fixed it — the fonts' `ToUnicode` maps, the page's
// own fonts, object streams, the document's title — against small files built
// here, since a maker's manual is not ours to commit.

/** The streams of an uncompressed file, the way `run.ts` hands them over. */
const streamsOf = (file: string): PdfStream[] =>
  pdfStreams(file).map((span) => ({ obj: span.obj, dict: span.dict, data: file.slice(span.start, span.end) }));

const read = (file: string) => pdfText(file, streamsOf(file));

// A two-byte font whose glyphs 0x0001-0x0003 are M, A and C, 0x0010-0x0019
// the digits, and 0x0020 a hyphen — the shape of an InDesign subset font.
const CMAP = `/CIDInit /ProcSet findresource begin
12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
3 beginbfchar
<0001> <004D>
<0002> <0041>
<0020> <002D>
endbfchar
2 beginbfrange
<0003> <0003> <0043>
<0010> <0019> <0030>
endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end`;

const hex = (codes: number[]) => `<${codes.map((c) => c.toString(16).padStart(4, '0')).join('')}>`;
// "MAC-408" in the subset font.
const MAC_408 = hex([0x01, 0x02, 0x03, 0x20, 0x14, 0x10, 0x18]);

describe('the strings a page draws', () => {
  it('reads a literal and a hex string as bytes', () => {
    expect(stringBytes('(MSZ\\(GS\\)60\\101)')).toBe('MSZ(GS)60A');
    expect(stringBytes('<4d 41 43>')).toBe('MAC');
    expect(stringBytes('<4d4>')).toBe('M@');
  });

  it('reads a ToUnicode map’s characters and its ranges', () => {
    const { width, map } = parseCMap(CMAP);
    expect(width).toBe(2);
    expect(map.get(0x01)).toBe('M');
    expect(map.get(0x03)).toBe('C');
    expect(map.get(0x14)).toBe('4');
    expect(parseCMap('begincodespacerange <00> <FF> endcodespacerange 1 beginbfrange <41> <42> [<0058> <00660069>] endbfrange').map)
      .toEqual(new Map([[0x41, 'X'], [0x42, 'fi']]));
  });

  it('decodes through the font, and reads a font with no map as nothing unless its bytes are plain text', () => {
    const font = { width: 2 as const, map: parseCMap(CMAP).map };
    expect(decodeWith(stringBytes(MAC_408), font)).toBe('MAC-408');
    expect(decodeWith('MSZ', null)).toBe('MSZ');
    expect(decodeWith('\x00\x01\x00\x02', { width: 2, map: null })).toBe('');
    expect(decodeWith('\x01\x02', null)).toBe('');
  });

  it('decodes each string through the font in use when it is drawn, and spaces what is drawn apart', () => {
    const fonts = { F1: { width: 2 as const, map: parseCMap(CMAP).map }, F2: null };
    const stream = `/F2 9 Tf 0 0 Td
BT /F2 9 Tf (Parts Number) Tj 0 -12 Td /F1 9 Tf [${MAC_408}] TJ ET
BT /F2 9 Tf [(FT) -20 (-E) -400 (GS71)] TJ ET
q 1 0 0 1 0 0 cm 0 0 m 10 10 l S Q`;
    expect(contentText(stream, fonts)).toBe('Parts Number MAC-408 FT-E GS71');
  });

  it('carries a font chosen between text objects into the next one', () => {
    const fonts = { F1: { width: 2 as const, map: parseCMap(CMAP).map } };
    expect(contentText(`/F1 9 Tf BT ${MAC_408} Tj ET`, fonts)).toBe('MAC-408');
  });

  it('reads one character per byte, never windows-1252', () => {
    expect(latin1Of(new Uint8Array([0x4d, 0x80, 0x9f, 0xff])).split('').map((c) => c.charCodeAt(0))).toEqual([0x4d, 0x80, 0x9f, 0xff]);
  });
});

describe('a document', () => {
  // A page whose resources name F1, a Type0 font with the map above.
  const pageFile = (contents: string) => `%PDF-1.7
1 0 obj
<< /Title (Information for Use MSZ-GS60VFD) /Producer (ST4) >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 5 0 R >> >> >>
endobj
3 0 obj
<< /Type/Page /Parent 2 0 R /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 99 >>
stream
${contents}
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Arial /ToUnicode 6 0 R >>
endobj
6 0 obj
<< /Length 99 >>
stream
${CMAP}
endstream
endobj
`;

  it('reads a page through its own fonts, inherited from its parent, with the title first', () => {
    const text = read(pageFile(`BT /F1 9 Tf ${MAC_408} Tj ET`));
    expect(text).toBe('Information for Use MSZ-GS60VFD MAC-408');
  });

  it('reads a font kept inside an object stream', () => {
    const objects = '<< /Type /Font /Subtype /Type0 /ToUnicode 6 0 R >>';
    const header = '5 0 ';
    const file = `%PDF-1.7
3 0 obj
<< /Type /Page /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 99 >>
stream
BT /F1 9 Tf ${MAC_408} Tj ET
endstream
endobj
6 0 obj
<< /Length 99 >>
stream
${CMAP}
endstream
endobj
7 0 obj
<< /Type /ObjStm /N 1 /First ${header.length} /Length 99 >>
stream
${header}${objects}
endstream
endobj
`;
    expect(read(file)).toBe('MAC-408');
  });

  it('reads a UTF-16 title', () => {
    const utf16 = '\xfe\xff\x00M\x00S\x00Z';
    expect(read(`1 0 obj\n<< /Title (${utf16}) /Creator (x) >>\nendobj\n`)).toBe('MSZ');
  });

  it('still reads a text stream that belongs to no page it could find', () => {
    expect(read('<< /Length 9 >>\nstream\nBT (MSZ-GS60VFD) Tj [(MAC-) -20 (100FT-E)] TJ ET\nendstream\n')).toBe('MSZ-GS60VFDMAC-100FT-E');
  });
});

describe('finding the streams', () => {
  it('skips pictures and font programs, and is not fooled by a nested dictionary', () => {
    const file = [
      '1 0 obj\n<< /Filter /FlateDecode /DecodeParms << /Columns 5 >> /Length 4 >>\nstream\nxxxx\nendstream\nendobj',
      '2 0 obj\n<< /Subtype /Image /Filter /FlateDecode >>\nstream\nyyyy\nendstream\nendobj',
      '3 0 obj\n<< /Length1 900 /Filter /FlateDecode >>\nstream\nfont\nendstream\nendobj',
      '4 0 obj\n<< /Length 4 >>\nstream\nzzzz\nendstream\nendobj',
    ].join('\n');
    expect(pdfStreams(file).map((one) => [one.obj, one.flate])).toEqual([[1, true], [4, false]]);
  });

  it('ends a stream at its own bytes, never at the line break before endstream', () => {
    // Deno's inflater throws away a whole stream that has anything after it.
    const file = [
      '1 0 obj\n<< /Length 4 /Filter /FlateDecode >>\nstream\r\nxxxx\r\nendstream\nendobj',
      '2 0 obj\n<< /Length 9 0 R >>\nstream\nyyyy\r\nendstream\nendobj',
      '3 0 obj\n<< /Length 99 >>\nstream\nzzzz\nendstream\nendobj',
    ].join('\n');
    expect(pdfStreams(file).map((one) => file.slice(one.start, one.end))).toEqual(['xxxx', 'yyyy', 'zzzz']);
  });

  it('reads a value out of a dictionary, whatever it is', () => {
    const dict = '<< /Font << /F1 5 0 R >> /Contents [4 0 R 8 0 R] /Type/Page /ToUnicode 6 0 R /N 3 >>';
    expect(valueOf(dict, 'Font')).toBe('<< /F1 5 0 R >>');
    expect(valueOf(dict, 'Contents')).toBe('[4 0 R 8 0 R]');
    expect(valueOf(dict, 'Type')).toBe('/Page');
    expect(valueOf(dict, 'ToUnicode')).toBe('6 0 R');
    expect(valueOf(dict, 'N')).toBe('3');
    expect(valueOf(dict, 'Missing')).toBeNull();
  });
});

// Small one-page PDF files for the demo's fictional evidence: a title and a few lines of text, Helvetica, with a
// footer that says the document is a fictional example. Pure.

const FOOTER = 'Fictional example document: Meridian Components Ltd (demo workspace).';

const esc = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\()]/g, (m) => `\\${m}`);

export function makePdf(lines: string[]): Buffer {
  const [title = 'Document', ...rest] = lines;
  const text = [
    'BT /F1 18 Tf 56 770 Td',
    `(${esc(title)}) Tj`,
    '/F1 11 Tf 0 -30 Td 15 TL',
    ...rest.map((l) => `(${esc(l)}) Tj T*`),
    'ET',
    'BT /F1 8 Tf 56 40 Td',
    `(${esc(FOOTER)}) Tj`,
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A plain-text evidence file, with the same footer. */
export function makeText(lines: string[]): Buffer {
  return Buffer.from([...lines, '', FOOTER, ''].join('\n'), 'utf8');
}

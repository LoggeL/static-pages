// =========================================================
// modules/ablage/pdf.js – winziges, gültiges Beispiel-PDF
// (eine Seite, Helvetica, WinAnsi), damit „Herunterladen“
// in der Demo eine echte Datei liefert.
// =========================================================

const WIN_ANSI = { '–': '\x96', '—': '\x97', '„': '\x84', '“': '\x93', '”': '\x94', '‚': '\x82', '‘': '\x91', '’': '\x92', '€': '\x80', '…': '\x85', '•': '\x95', '›': '\x9b', '‹': '\x8b' };
const toAnsi = s => String(s).replace(/[^\x00-\xff]/g, c => WIN_ANSI[c] || '?');
const escPdf = s => toAnsi(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** makePdf('Titel', ['Zeile 1', 'Zeile 2']) → Blob (application/pdf) */
export function makePdf(title, lines = []) {
  const ops = [
    '0.92 0.41 0 rg 0 806 595 36 re f',           // orangefarbener Balken oben
    'BT /F2 13 Tf 1 1 1 rg 40 818 Td (' + escPdf('Kolpingsfamilie Ramsen') + ') Tj ET',
    'BT /F2 20 Tf 0.11 0.1 0.09 rg 40 760 Td (' + escPdf(title) + ') Tj ET',
  ];
  lines.forEach((l, i) => ops.push(`BT /F1 12 Tf 0.2 0.2 0.2 rg 40 ${724 - i * 20} Td (${escPdf(l)}) Tj ET`));
  ops.push('0.85 0.85 0.85 RG 1 w 40 60 m 555 60 l S');
  ops.push('BT /F1 9 Tf 0.4 0.4 0.4 rg 40 44 Td (' + escPdf('Beispieldatei aus dem klickbaren Prototyp – kein echtes Vereinsdokument.') + ') Tj ET');
  const stream = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return new Blob([bytes], { type: 'application/pdf' });
}

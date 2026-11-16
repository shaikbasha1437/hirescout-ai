/* HireScout resume import: plain text, Markdown, PDF (vendored pdf.js, loaded on demand) and DOCX (a small ZIP
   reader plus the browser's built-in deflate decoder). Everything is parsed in the page; files are never uploaded.
   Hidden DOCX text (white, 1-2 point, or marked hidden) and near-invisible PDF text are kept but tagged
   "[hidden text]" so the guard flags it and the scorer ignores it. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.HS = root.HS || {}).docs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MAX_BYTES = 5 * 1024 * 1024;
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unxml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] != null ? ENT[e] : m));
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function zipEntries(bytes) {
    let eocd = -1; for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This file is not a valid DOCX (no ZIP directory found).');
    const n = u16(bytes, eocd + 10); let p = u32(bytes, eocd + 16); const out = {};
    for (let i = 0; i < n; i++) {
      if (u32(bytes, p) !== 0x02014b50) throw new Error('Damaged DOCX directory.');
      const method = u16(bytes, p + 10); const csize = u32(bytes, p + 20); const nameLen = u16(bytes, p + 28); const extra = u16(bytes, p + 30); const comment = u16(bytes, p + 32); const local = u32(bytes, p + 42);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      const lp = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
      out[name] = { method, data: bytes.subarray(lp, lp + csize) };
      p += 46 + nameLen + extra + comment;
    }
    return out;
  }
  async function inflateRaw(data, deps) {
    if (deps && deps.inflateRaw) return deps.inflateRaw(data);
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack DOCX files. Save the resume as PDF or text instead.');
    const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(data); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  const HIDDEN_RPR = /<w:vanish\/>|<w:vanish w:val="(?:true|1|on)"\/>|<w:color w:val="(?:FFFFFF|FEFEFE|FDFDFD|ffffff)"|<w:sz w:val="[1-4]"\/>|<w:highlight w:val="white"\/>.*<w:color w:val="FFFFFF"/;
  /* Paragraph text from document.xml; returns { text, hidden:[strings] }. */
  function docxXmlToText(xml) {
    const out = []; const hidden = [];
    const paras = String(xml).match(/<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g) || [];
    for (const p of paras) {
      const style = (/<w:pStyle w:val="([^"]+)"/.exec(p) || [])[1] || '';
      let line = ''; let hid = '';
      for (const r of p.match(/<w:r[\s>][\s\S]*?<\/w:r>/g) || []) {
        const rpr = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(r) || [''])[0];
        const t = unxml((r.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|\t|\n/g) || []).map((x) => x.replace(/<[^>]+>/g, '')).join(''));
        if (HIDDEN_RPR.test(rpr)) hid += t; else line += t;
      }
      if (hid.trim()) { hidden.push(hid.trim()); line = (line.trim() ? line.trim() + '\n' : '') + '[hidden text] ' + hid.trim(); }
      const txt = line.trim();
      if (!txt) { out.push(''); continue; }
      if (/^Heading\s?\d|^heading|^Title$/i.test(style)) out.push('', '## ' + txt); else if (/List/i.test(style)) out.push('- ' + txt); else out.push(txt);
    }
    return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), hidden };
  }
  async function docxToText(bytes, deps) {
    const z = zipEntries(bytes); const e = z['word/document.xml'];
    if (!e) throw new Error('No word/document.xml inside; is this really a DOCX?');
    const raw = e.method === 0 ? e.data : e.method === 8 ? await inflateRaw(e.data, deps) : null;
    if (!raw) throw new Error('Unsupported DOCX compression.');
    return docxXmlToText(new TextDecoder().decode(raw));
  }
  async function pdfToText(bytes, deps) {
    let lib = deps && deps.pdfjs;
    if (!lib) { const base = (typeof document !== 'undefined' && document.baseURI) || ''; lib = await import(new URL('vendor/pdfjs/pdf.min.mjs', base).href); lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', base).href; }
    const doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise; const pages = []; const hidden = [];
    for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
      const pg = await doc.getPage(i); const c = await pg.getTextContent(); let line = ''; let tiny = true; const lines = []; let lastY = null;
      const flush = () => { if (line.trim()) { if (tiny) { hidden.push(line.trim()); lines.push('[hidden text] ' + line.trim()); } else lines.push(line); } line = ''; tiny = true; };
      for (const it of c.items) {
        const y = it.transform ? Math.round(it.transform[5]) : null; if (lastY != null && y != null && Math.abs(y - lastY) > 2) flush();
        line += it.str; if (it.str.trim()) { const h = it.transform ? Math.hypot(it.transform[2], it.transform[3]) : 10; if (h >= 2.5) tiny = false; }
        if (it.hasEOL) flush(); lastY = y;
      }
      flush(); pages.push(lines.join('\n'));
    }
    const text = pages.join('\n\n').replace(/[ \u00a0]{2,}/g, ' ');
    if (!text.trim()) throw new Error('No text found in this PDF. Scanned PDFs need OCR first.');
    return { text, hidden };
  }
  function nameFrom(file) { return String(file || 'Candidate').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\b(resume|cv|curriculum vitae)\b/gi, '').replace(/\s+/g, ' ').trim(); }
  /* file: { name, size, bytes(Uint8Array) } -> { text, hidden, source } */
  async function parseFile(file, deps) {
    const name = file.name || 'resume.txt'; const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1] || 'txt';
    if (file.size > MAX_BYTES) throw new Error(name + ' is over 5 MB.');
    let r;
    if (/^(md|markdown|txt|text)$/i.test(ext)) r = { text: new TextDecoder().decode(file.bytes).replace(/\r\n?/g, '\n'), hidden: [] };
    else if (/^docx$/i.test(ext)) r = await docxToText(file.bytes, deps);
    else if (/^pdf$/i.test(ext)) r = await pdfToText(file.bytes, deps);
    else throw new Error(name + ': use .pdf, .docx, .txt or .md.');
    if (!r.text.trim()) throw new Error(name + ' has no readable text.');
    return { text: r.text.slice(0, 40000), hidden: r.hidden, source: name, fallbackName: nameFrom(name) };
  }
  return { MAX_BYTES, zipEntries, docxXmlToText, docxToText, pdfToText, parseFile, nameFrom, unxml };
});

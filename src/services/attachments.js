// Tekst uit bijlagen halen (pdf, txt, csv, html) zodat de AI facturen e.d. kan lezen.
let pdfjs = null;

async function pdfText(buf, { maxPages = 5 } = {}) {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, verbosity: 0,
  }).promise;
  let out = '';
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    out += c.items.map((x) => x.str + (x.hasEOL ? '\n' : ' ')).join('') + '\n';
  }
  await doc.destroy();
  return out.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

// attachments: [{ filename, contentType, content: Buffer }]
async function readAttachments(attachments, { maxFiles = 3, maxChars = 3000, maxBytes = 8 * 1024 * 1024 } = {}) {
  const out = [];
  for (const a of (attachments || []).slice(0, 10)) {
    if (out.length >= maxFiles) break;
    const name = a.filename || 'attachment';
    const type = String(a.contentType || '').toLowerCase();
    if (!a.content || a.content.length > maxBytes) continue;
    try {
      let text = '';
      if (type.includes('pdf') || /\.pdf$/i.test(name)) text = await withTimeout(pdfText(a.content), 20000);
      else if (/^text\/(plain|csv)/.test(type) || /\.(txt|csv)$/i.test(name)) text = a.content.toString('utf8');
      else if (type.includes('html')) text = a.content.toString('utf8').replace(/<[^>]+>/g, ' ');
      else continue;
      text = text.replace(/\s+\n/g, '\n').trim();
      if (text) out.push({ name, text: text.slice(0, maxChars) });
    } catch { /* onleesbare bijlage overslaan */ }
  }
  return out;
}

function attachmentsBlock(list) {
  if (!list || !list.length) return '';
  return '\n\n' + list.map((a) => `--- ATTACHMENT: ${a.name} ---\n${a.text}`).join('\n\n');
}

module.exports = { readAttachments, attachmentsBlock, pdfText };

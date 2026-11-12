// Hulpfuncties voor plugins.
const crypto = require('crypto');

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h\d>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function hash(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12); }

async function get(url, { headers = {}, ms = 15000 } = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Assistant22/1.0 (+https://github.com/mikeey77/Assistant22)', ...headers }, signal: c.signal });
    if (!r.ok) throw new Error(`${new URL(url).host}: HTTP ${r.status}`);
    return r;
  } finally { clearTimeout(t); }
}

function lines(s) { return String(s || '').split('\n').map((l) => l.trim()).filter(Boolean); }

function firstUrl(text, domain) {
  const re = new RegExp(`https?://[^\\s"'<>)]*${domain.replace('.', '\\.')}[^\\s"'<>)]*`, 'i');
  const m = String(text || '').match(re);
  return m ? m[0] : '';
}

module.exports = { htmlToText, hash, get, lines, firstUrl };

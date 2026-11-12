// Gmail via de Gmail API (zelfde Google-login als de agenda).
const { GoogleAuth } = require('./google');
const MailComposer = require('nodemailer/lib/mail-composer');
const { readAttachments, attachmentsBlock } = require('./attachments');

function attachmentParts(payload, out = []) {
  if (!payload) return out;
  if (payload.filename && payload.body && payload.body.attachmentId) out.push({ filename: payload.filename, contentType: payload.mimeType, id: payload.body.attachmentId, size: payload.body.size });
  for (const p of payload.parts || []) attachmentParts(p, out);
  return out;
}

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function b64urlDecode(s) {
  return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function findPart(payload, mime) {
  if (!payload) return null;
  if (payload.mimeType === mime && payload.body && payload.body.data) return payload.body.data;
  for (const p of payload.parts || []) {
    const f = findPart(p, mime);
    if (f) return f;
  }
  return null;
}

function parseAddress(v) {
  const m = String(v || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(v || '')).trim();
}

class Gmail extends GoogleAuth {
  async api(method, p, body) { return this._api(method, p, body, BASE); }

  async test() {
    const j = await this.api('GET', '/profile');
    return { email: j.emailAddress, messages: j.messagesTotal };
  }

  // Nieuwe inbox-mails sinds lastTs (ms). Eerste keer: alleen startpunt vastleggen.
  async fetchNew(lastTs, { max = 20, bodyChars = 3000 } = {}) {
    if (!lastTs) return { mails: [], lastTs: Date.now(), firstRun: true };
    const after = Math.floor((lastTs - 60000) / 1000);
    const list = await this.api('GET', `/messages?q=${encodeURIComponent('in:inbox after:' + after)}&maxResults=${max}`);
    const mails = [];
    let newest = lastTs;
    for (const { id } of list.messages || []) {
      const m = await this.api('GET', `/messages/${id}?format=full`);
      const ts = Number(m.internalDate);
      if (ts <= lastTs) continue;
      newest = Math.max(newest, ts);
      const h = Object.fromEntries((m.payload.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
      let body = findPart(m.payload, 'text/plain');
      body = body ? b64urlDecode(body) : (findPart(m.payload, 'text/html') ? b64urlDecode(findPart(m.payload, 'text/html')).replace(/<[^>]+>/g, ' ') : m.snippet || '');
      const parts = attachmentParts(m.payload).filter((a) => /pdf|text\/(plain|csv)/i.test(a.contentType) && a.size < 8 * 1024 * 1024).slice(0, 3);
      const files = [];
      for (const a of parts) {
        try {
          const d = await this.api('GET', `/messages/${m.id}/attachments/${a.id}`);
          files.push({ filename: a.filename, contentType: a.contentType, content: Buffer.from(String(d.data).replace(/-/g, '+').replace(/_/g, '/'), 'base64') });
        } catch { /* overslaan */ }
      }
      body = body + attachmentsBlock(await readAttachments(files));
      mails.push({
        id: m.id,
        gid: m.id,
        attachments: attachmentParts(m.payload).map((a) => a.filename),
        threadId: m.threadId,
        from: h.from || '',
        fromAddress: parseAddress(h.from),
        to: h.to || '',
        subject: h.subject || '(no subject)',
        date: new Date(ts).toISOString(),
        messageId: h['message-id'] || '',
        body: body.replace(/\s+\n/g, '\n').trim().slice(0, bodyChars + 9000),
      });
    }
    mails.sort((a, b) => new Date(a.date) - new Date(b.date));
    return { mails, lastTs: newest, firstRun: false };
  }

  async trash(ids) {
    for (const id of ids) await this.api('POST', `/messages/${id}/trash`);
    return ids.length;
  }

  async send({ to, subject, body, inReplyTo, threadId, fromName, from }) {
    const mail = new MailComposer({
      from: fromName ? `"${fromName}" <${from}>` : from,
      to,
      subject,
      text: body,
      inReplyTo: inReplyTo || undefined,
      references: inReplyTo || undefined,
    });
    const raw = (await mail.compile().build()).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return this.api('POST', '/messages/send', { raw, threadId: threadId || undefined });
  }
}

module.exports = { Gmail, _test: { b64urlDecode, parseAddress } };

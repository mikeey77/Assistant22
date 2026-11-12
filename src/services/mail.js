// IMAP (lezen) en SMTP (versturen na goedkeuring).
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { readAttachments, attachmentsBlock } = require('./attachments');

function imapClient(c) {
  return new ImapFlow({
    host: c.host,
    port: Number(c.port) || 993,
    secure: c.secure !== false,
    auth: { user: c.user, pass: c.pass },
    logger: false,
  });
}

async function testImap(c) {
  const client = imapClient(c);
  await client.connect();
  const box = await client.mailboxOpen(c.mailbox || 'INBOX', { readOnly: true });
  await client.logout();
  return { messages: box.exists };
}

// Haalt mails op met UID > lastUid. Markeert niets als gelezen.
// Eerste keer (lastUid null): alleen het startpunt vastleggen.
async function fetchNewMail(c, lastUid, uidValidity, { max = 20, bodyChars = 3000 } = {}) {
  const client = imapClient(c);
  await client.connect();
  const mails = [];
  let newLast = lastUid;
  let newValidity = uidValidity;
  try {
    const box = await client.mailboxOpen(c.mailbox || 'INBOX', { readOnly: true });
    const validity = String(box.uidValidity);
    if (lastUid == null || validity !== String(uidValidity)) {
      return { mails: [], lastUid: box.uidNext - 1, uidValidity: validity, firstRun: true };
    }
    newValidity = validity;
    if (box.uidNext - 1 > lastUid) {
      for await (const msg of client.fetch(`${lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (msg.uid <= lastUid) continue; // "x:*" geeft altijd minstens het laatste bericht
        newLast = Math.max(newLast, msg.uid);
        const p = await simpleParser(msg.source);
        const text = (p.text || (p.html ? p.html.replace(/<[^>]+>/g, ' ') : '') || '').replace(/\s+\n/g, '\n').trim();
        const att = await readAttachments(p.attachments);
        mails.push({
          id: String(msg.uid),
          uid: msg.uid,
          attachments: (p.attachments || []).map((a) => a.filename).filter(Boolean),
          from: p.from ? p.from.text : '',
          fromAddress: p.from && p.from.value[0] ? p.from.value[0].address : '',
          to: p.to ? p.to.text : '',
          subject: p.subject || '(geen onderwerp)',
          date: p.date ? p.date.toISOString() : '',
          messageId: p.messageId || '',
          body: text.slice(0, bodyChars) + attachmentsBlock(att),
        });
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }
  mails.sort((a, b) => Number(a.id) - Number(b.id));
  return { mails: mails.slice(-max), lastUid: newLast, uidValidity: newValidity, firstRun: false };
}

// Naar de prullenbak verplaatsen (spam opruimen). Valt terug op verwijderen als er geen prullenbak is.
async function trashMessages(c, uids) {
  if (!uids.length) return 0;
  const client = imapClient(c);
  await client.connect();
  try {
    const list = await client.list();
    const trash = list.find((f) => f.specialUse === '\\Trash') || list.find((f) => /trash|prullenbak|deleted|verwijderd|papierkorb/i.test(f.path));
    await client.mailboxOpen(c.mailbox || 'INBOX');
    const range = uids.join(',');
    if (trash) await client.messageMove(range, trash.path, { uid: true });
    else await client.messageDelete(range, { uid: true });
    return uids.length;
  } finally {
    await client.logout().catch(() => {});
  }
}

function smtpTransport(c) {
  return nodemailer.createTransport({
    host: c.host,
    port: Number(c.port) || 465,
    secure: c.secure !== false,
    auth: { user: c.user, pass: c.pass },
  });
}

async function testSmtp(c) {
  await smtpTransport(c).verify();
  return true;
}

async function sendReply(c, { to, subject, body, inReplyTo }) {
  const from = c.fromName ? `"${c.fromName}" <${c.user}>` : c.user;
  const subj = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  return smtpTransport(c).sendMail({
    from, to, subject: subj, text: body,
    inReplyTo: inReplyTo || undefined,
    references: inReplyTo || undefined,
  });
}

async function sendMail(c, { to, subject, body }) {
  const from = c.fromName ? `"${c.fromName}" <${c.user}>` : c.user;
  return smtpTransport(c).sendMail({ from, to, subject: subject || '', text: body });
}

module.exports = { testImap, fetchNewMail, testSmtp, sendReply, sendMail, trashMessages };

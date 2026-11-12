// WhatsApp-koppeling via Baileys (zoals WhatsApp Web: QR-code scannen).
// Onofficieel: WhatsApp biedt geen API voor privé-accounts.
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class WhatsApp extends EventEmitter {
  constructor(authDir) {
    super();
    this.authDir = authDir;
    this.sock = null;
    this.connected = false;
    this.user = null;
    this.selfJids = new Set();
    this.sentIds = new Set();
    this.seenIds = new Set();
    this.stopped = false;
    this.retries = 0;
  }

  get linked() {
    return fs.existsSync(path.join(this.authDir, 'creds.json'));
  }

  async start() {
    this.stopped = false;
    const B = await import('baileys');
    const makeWASocket = B.makeWASocket || B.default;
    const { state, saveCreds } = await B.useMultiFileAuthState(this.authDir);
    let version;
    try { ({ version } = await B.fetchLatestBaileysVersion()); } catch { /* standaardversie */ }
    // berichtenopslag voor opnieuw versturen bij decryptiefouten
    const store = this.msgStore || (this.msgStore = new Map());
    const logger = require('pino')({ level: 'silent' });
    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: B.Browsers.windows('Postvak'),
      markOnlineOnConnect: false, // anders krijg je op je telefoon geen meldingen meer
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => store.get(key.id),
    });
    this.sock = sock;
    this.B = B;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      if (u.qr) {
        try {
          const dataUrl = await require('qrcode').toDataURL(u.qr, { margin: 1, width: 280 });
          this.emit('qr', dataUrl);
        } catch (e) { this.emit('error', e); }
      }
      if (u.connection === 'open') {
        this.connected = true;
        this.retries = 0;
        this.user = sock.user;
        this.selfJids = new Set([B.jidNormalizedUser(sock.user.id)]);
        if (sock.user.lid) this.selfJids.add(B.jidNormalizedUser(sock.user.lid));
        this.emit('open', { name: sock.user.name || sock.user.verifiedName || sock.user.id.split(':')[0], id: sock.user.id });
      }
      if (u.connection === 'close') {
        this.connected = false;
        const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode;
        const loggedOut = code === B.DisconnectReason.loggedOut;
        this.emit('close', { loggedOut, code });
        if (loggedOut) {
          fs.rmSync(this.authDir, { recursive: true, force: true });
          return;
        }
        if (!this.stopped) {
          this.retries++;
          const wait = Math.min(60000, 2000 * this.retries);
          setTimeout(() => { if (!this.stopped) this.start().catch((e) => this.emit('error', e)); }, wait);
        }
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      // 'notify' = nieuw binnen, 'append' = binnengekomen terwijl de app uit stond
      const since = Date.now() / 1000 - 24 * 3600;
      for (const m of messages) {
        if (type !== 'notify' && Number(m.messageTimestamp || 0) < since) continue;
        if (this.seenIds.has(m.key.id)) continue;
        this.seenIds.add(m.key.id);
        try { this._handle(m); } catch (e) { this.emit('error', e); }
      }
      if (this.seenIds.size > 2000) this.seenIds = new Set([...this.seenIds].slice(-1000));
    });
  }

  _handle(m) {
    const B = this.B;
    const jid = m.key.remoteJid;
    if (!jid) return;
    if (!m.message) {
      if (!m.key.fromMe && m.messageStubType) this.emit('debug', 'message could not be decrypted yet (WhatsApp will retry)');
      return;
    }
    if (this.sentIds.has(m.key.id)) return; // eigen bot-bericht
    if (B.isJidBroadcast(jid) || B.isJidStatusBroadcast(jid) || jid.endsWith('@newsletter')) return;
    const text = extractText(m.message);
    if (!text) {
      if (!m.key.fromMe) this.emit('debug', `skipped non-text message (${Object.keys(m.message).join(',')})`);
      return;
    }
    const isSelf = this.selfJids.has(B.jidNormalizedUser(jid));
    if (isSelf) return; // je eigen chat negeren
    if (m.key.fromMe) return;
    const isGroup = B.isJidGroup(jid);
    const alt = m.key.remoteJidAlt || m.key.senderPn || m.key.participantPn || '';
    const phone = ((alt || (jid.endsWith('@s.whatsapp.net') ? jid : '')).split('@')[0] || '').replace(/\D/g, '');
    this.emit('message', {
      id: m.key.id,
      jid,
      isGroup,
      name: m.pushName || phone || jid.split('@')[0],
      phone,
      text: text.slice(0, 2000),
      date: new Date((Number(m.messageTimestamp) || Date.now() / 1000) * 1000).toISOString(),
    });
  }

  async send(jid, text) {
    if (!this.sock || !this.connected) throw new Error('WhatsApp is not connected');
    const r = await this.sock.sendMessage(jid, { text });
    if (r && r.key) {
      this.sentIds.add(r.key.id);
      this.msgStore.set(r.key.id, r.message);
      if (this.msgStore.size > 200) this.msgStore.delete(this.msgStore.keys().next().value);
    }
    if (this.sentIds.size > 500) this.sentIds = new Set([...this.sentIds].slice(-200));
    return r;
  }

  // Zoek de WhatsApp-JID bij een telefoonnummer (alleen cijfers, met landcode).
  async resolve(digits) {
    if (!this.sock || !this.connected) throw new Error('WhatsApp is not connected');
    const [r] = (await this.sock.onWhatsApp(digits + '@s.whatsapp.net')) || [];
    if (!r || !r.exists) throw new Error(`+${digits} is not on WhatsApp`);
    return r.jid;
  }

  sendSelf(text) {
    const self = [...this.selfJids][0];
    if (!self) throw new Error('WhatsApp is not connected');
    return this.send(self, '🤖 ' + text);
  }

  stop() {
    this.stopped = true;
    try { this.sock && this.sock.end(undefined); } catch { /* al dicht */ }
    this.sock = null;
    this.connected = false;
  }

  async logout() {
    this.stopped = true;
    try { if (this.sock) await this.sock.logout(); } catch { /* negeren */ }
    this.stop();
    fs.rmSync(this.authDir, { recursive: true, force: true });
  }
}

function extractText(msg) {
  let m = msg;
  for (let i = 0; i < 3 && m; i++) {
    const inner = (m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.documentWithCaptionMessage || {}).message;
    if (!inner) break;
    m = inner;
  }
  if (!m) return '';
  return (
    m.conversation ||
    (m.extendedTextMessage && m.extendedTextMessage.text) ||
    (m.imageMessage && m.imageMessage.caption) ||
    (m.videoMessage && m.videoMessage.caption) ||
    (m.documentMessage && m.documentMessage.caption) ||
    ''
  );
}

// HTML (Telegram-stijl) omzetten naar WhatsApp-opmaak.
function htmlToWa(html) {
  return String(html)
    .replace(/<b>(.*?)<\/b>/gs, '*$1*')
    .replace(/<i>(.*?)<\/i>/gs, '_$1_')
    .replace(/<code>(.*?)<\/code>/gs, '`$1`')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

module.exports = { WhatsApp, htmlToWa, extractText };

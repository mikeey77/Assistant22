// Config-opslag: één JSON-bestand in de userData-map.
// Geheimen (wachtwoorden, tokens) worden versleuteld met de encrypt/decrypt
// functies die main.js meegeeft (Electron safeStorage = Windows DPAPI).
const fs = require('fs');
const path = require('path');

const SECRET_PATHS = [
  'imap.pass',
  'smtp.pass',
  'google.clientSecret',
  'google.refreshToken',
  'telegram.token',
];

const DEFAULT_RULES = require('./i18n').STRINGS.en.defaultRules;

const DEFAULTS = {
  setupDone: false,
  language: 'en',
  safeMode: true,
  notifyChannel: 'telegram', // telegram | whatsapp | both
  quietNonUrgent: true,
  vip: '',
  phoneCountry: '31',
  contacts: [], // { name, email, phone, vip }
  autoUpdate: true,
  intervalMin: 15,
  openAtLogin: true,
  rules: DEFAULT_RULES,
  dailySummary: { enabled: true, time: '08:00' },
  claude: { command: 'claude', model: '' },
  imap: { host: '', port: 993, secure: true, user: '', pass: '', mailbox: 'INBOX' },
  smtp: { host: '', port: 465, secure: true, user: '', pass: '', fromName: '' },
  google: { clientId: '', clientSecret: '', refreshToken: '', calendarId: 'primary' },
  telegram: { token: '', chatId: null },
  whatsapp: { enabled: false, groups: false },
  state: { lastUid: null, uidValidity: null, lastSummaryDate: null, pending: {}, recent: [], lastCheck: null, lastError: null, waQueue: [], waJids: {}, candidates: {} },
};

function get(obj, p) {
  return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function set(obj, p, v) {
  const keys = p.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] = o[k] || {};
  o[keys[keys.length - 1]] = v;
}
function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

class Config {
  constructor(dir, { encrypt = (s) => s, decrypt = (s) => s } = {}) {
    this.file = path.join(dir, 'config.json');
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    fs.mkdirSync(dir, { recursive: true });
    this.data = this._load();
  }

  _load() {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* eerste start */ }
    const data = deepMerge(DEFAULTS, raw);
    for (const p of SECRET_PATHS) {
      const v = get(data, p);
      if (typeof v === 'string' && v.startsWith('enc:')) {
        try { set(data, p, this.decrypt(v.slice(4))); } catch { set(data, p, ''); }
      }
    }
    return data;
  }

  save() {
    const copy = JSON.parse(JSON.stringify(this.data));
    for (const p of SECRET_PATHS) {
      const v = get(copy, p);
      if (v) set(copy, p, 'enc:' + this.encrypt(v));
    }
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(copy, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // Werk bij met een (deel)object. Lege geheimen overschrijven niets,
  // zodat de UI wachtwoorden niet terug hoeft te sturen.
  update(partial) {
    const clean = JSON.parse(JSON.stringify(partial || {}));
    delete clean.state;
    for (const p of SECRET_PATHS) {
      if (get(clean, p) === '') {
        const keys = p.split('.');
        const parent = get(clean, keys.slice(0, -1).join('.'));
        if (parent) delete parent[keys[keys.length - 1]];
      }
    }
    this.data = deepMerge(this.data, clean);
    this.save();
  }

  // Versie voor de UI: geheimen vervangen door "is ingesteld" vlaggen.
  publicView() {
    const copy = JSON.parse(JSON.stringify(this.data));
    copy.secretsSet = {};
    for (const p of SECRET_PATHS) {
      copy.secretsSet[p] = !!get(copy, p);
      set(copy, p, '');
    }
    copy.state = {
      lastCheck: this.data.state.lastCheck,
      lastError: this.data.state.lastError,
      pendingCount: Object.keys(this.data.state.pending || {}).length,
    };
    return copy;
  }
}

module.exports = { Config, DEFAULT_RULES, DEFAULTS };

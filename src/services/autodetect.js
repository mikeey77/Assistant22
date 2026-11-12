// Zoekt IMAP/SMTP-instellingen bij een e-mailadres.
// 1) bekende providers, 2) MX-records (Google Workspace / Microsoft 365),
// 3) Thunderbird ISPDB, 4) gok imap.<domein> / smtp.<domein>.
const dns = require('dns').promises;

const KNOWN = {
  gmail: { imap: ['imap.gmail.com', 993, true], smtp: ['smtp.gmail.com', 465, true], appPassword: true },
  outlook: { imap: ['outlook.office365.com', 993, true], smtp: ['smtp.office365.com', 587, false] },
  icloud: { imap: ['imap.mail.me.com', 993, true], smtp: ['smtp.mail.me.com', 587, false], appPassword: true },
  yahoo: { imap: ['imap.mail.yahoo.com', 993, true], smtp: ['smtp.mail.yahoo.com', 465, true], appPassword: true },
};
const DOMAINS = {
  'gmail.com': 'gmail', 'googlemail.com': 'gmail',
  'outlook.com': 'outlook', 'hotmail.com': 'outlook', 'live.com': 'outlook', 'live.nl': 'outlook', 'hotmail.nl': 'outlook', 'msn.com': 'outlook',
  'icloud.com': 'icloud', 'me.com': 'icloud', 'mac.com': 'icloud',
  'yahoo.com': 'yahoo', 'ymail.com': 'yahoo',
};

function fromKnown(key, email) {
  const k = KNOWN[key];
  return { imap: { host: k.imap[0], port: k.imap[1], secure: k.imap[2], user: email }, smtp: { host: k.smtp[0], port: k.smtp[1], secure: k.smtp[2], user: email }, source: key, appPassword: !!k.appPassword };
}

function parseIspdb(xml, email) {
  const pick = (tag, type) => {
    const m = xml.match(new RegExp(`<${tag}[^>]*type="${type}"[^>]*>([\\s\\S]*?)</${tag}>`));
    if (!m) return null;
    const get = (n) => ((m[1].match(new RegExp(`<${n}>([^<]*)</${n}>`)) || [])[1] || '').trim();
    const local = email.split('@')[0];
    const user = get('username').replace('%EMAILADDRESS%', email).replace('%EMAILLOCALPART%', local) || email;
    return { host: get('hostname'), port: Number(get('port')), secure: get('socketType') === 'SSL', user };
  };
  const imap = pick('incomingServer', 'imap');
  const smtp = pick('outgoingServer', 'smtp');
  if (!imap || !imap.host) return null;
  return { imap, smtp: smtp || { host: '', port: 465, secure: true, user: email }, source: 'ispdb' };
}

async function fetchText(url, ms = 6000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return r.ok ? await r.text() : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

async function detect(email) {
  email = String(email || '').trim().toLowerCase();
  const domain = email.split('@')[1];
  if (!domain) throw new Error('Invalid email address');
  if (DOMAINS[domain]) return fromKnown(DOMAINS[domain], email);

  try {
    const mx = (await dns.resolveMx(domain)).map((r) => r.exchange.toLowerCase()).join(' ');
    if (/google(mail)?\.com/.test(mx)) return fromKnown('gmail', email);
    if (/outlook\.com|office365/.test(mx)) return fromKnown('outlook', email);
  } catch { /* geen MX */ }

  for (const url of [`https://autoconfig.thunderbird.net/v1.1/${domain}`, `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`]) {
    const xml = await fetchText(url);
    const r = xml && parseIspdb(xml, email);
    if (r) return r;
  }
  return { imap: { host: 'imap.' + domain, port: 993, secure: true, user: email }, smtp: { host: 'smtp.' + domain, port: 465, secure: true, user: email }, source: 'guess' };
}

module.exports = { detect, parseIspdb };

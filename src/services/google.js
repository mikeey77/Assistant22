// Google Agenda via REST + OAuth (desktop "loopback" flow met PKCE).
const http = require('http');
const crypto = require('crypto');

const CAL_SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Start de login: opent de browser, wacht op de redirect, geeft refresh token terug.
function connect({ clientId, clientSecret }, openUrl, { gmail = false } = {}) {
  const SCOPES = gmail ? CAL_SCOPES + ' ' + GMAIL_SCOPES : CAL_SCOPES;
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const stateTok = b64url(crypto.randomBytes(16));
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      if (!code && !url.searchParams.get('error')) { res.end(); return; }
      const redirectUri = `http://127.0.0.1:${server.address().port}`;
      try {
        if (url.searchParams.get('state') !== stateTok) throw new Error('Ongeldige state');
        if (!code) throw new Error(url.searchParams.get('error'));
        const tok = await tokenRequest({
          code, client_id: clientId, client_secret: clientSecret,
          redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
        });
        if (!tok.refresh_token) throw new Error('Geen refresh token ontvangen');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2 style="font-family:sans-serif">Gelukt! Je kunt dit venster sluiten en terug naar Postvak.</h2>');
        resolve({ refreshToken: tok.refresh_token, scope: tok.scope || SCOPES });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2 style="font-family:sans-serif">Koppelen mislukt: ' + String(e.message).replace(/</g, '') + '</h2>');
        reject(e);
      } finally {
        server.close();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}`;
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
        scope: SCOPES, access_type: 'offline', prompt: 'consent',
        code_challenge: challenge, code_challenge_method: 'S256', state: stateTok,
      }).toString();
      openUrl(auth.toString());
    });
    setTimeout(() => { server.close(); reject(new Error('Koppelen duurde te lang')); }, 5 * 60 * 1000);
  });
}

async function tokenRequest(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'Token-fout');
  return j;
}

// Gedeelde token-logica voor Agenda en Gmail.
class GoogleAuth {
  constructor(cfg) {
    this.cfg = cfg;
    this.token = null;
    this.expires = 0;
  }

  get ready() { return !!(this.cfg.clientId && this.cfg.refreshToken); }

  async _access() {
    if (this.token && Date.now() < this.expires - 60000) return this.token;
    const j = await tokenRequest({
      client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret,
      refresh_token: this.cfg.refreshToken, grant_type: 'refresh_token',
    });
    this.token = j.access_token;
    this.expires = Date.now() + j.expires_in * 1000;
    return this.token;
  }

  async _api(method, p, body, base = 'https://www.googleapis.com/calendar/v3') {
    const r = await fetch(base + p, {
      method,
      headers: { Authorization: 'Bearer ' + (await this._access()), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Google: ' + ((j.error && j.error.message) || r.status));
    return j;
  }
}

class GoogleCalendar extends GoogleAuth {

  get calId() { return encodeURIComponent(this.cfg.calendarId || 'primary'); }

  async listEvents(from, to) {
    const q = new URLSearchParams({
      timeMin: from.toISOString(), timeMax: to.toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '100',
    });
    const j = await this._api('GET', `/calendars/${this.calId}/events?${q}`);
    return (j.items || []).map((e) => ({
      title: e.summary || '(geen titel)',
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date,
      allDay: !!e.start.date,
      location: e.location || '',
    }));
  }

  async listCalendars() {
    const j = await this._api('GET', '/users/me/calendarList');
    return (j.items || []).map((c) => ({ id: c.id, name: c.summary, primary: !!c.primary }));
  }

  // ev: { title, start, end, allDay, location, description }
  // start/end als lokale tijd "2026-11-14T10:00" of datum "2026-11-14".
  async createEvent(ev) {
    let start, end;
    if (ev.allDay) {
      const s = ev.start.slice(0, 10);
      const e = (ev.end || ev.start).slice(0, 10);
      start = { date: s };
      end = { date: addDays(e, 1) }; // Google: einddatum is exclusief
    } else {
      start = { dateTime: localIso(ev.start), timeZone: TZ };
      end = { dateTime: localIso(ev.end || addMinutes(ev.start, 60)), timeZone: TZ };
    }
    const j = await this._api('POST', `/calendars/${this.calId}/events`, {
      summary: ev.title, location: ev.location || undefined,
      description: ev.description || undefined, start, end,
    });
    return j.htmlLink;
  }
}

function localIso(s) { return s.length === 16 ? s + ':00' : s.slice(0, 19); }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function addMinutes(s, n) {
  const [d, t] = s.split('T');
  const [h, m] = t.split(':').map(Number);
  const tot = h * 60 + m + n;
  if (tot >= 24 * 60) return d + 'T23:59';
  return `${d}T${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
}

module.exports = { connect, GoogleAuth, GoogleCalendar, TZ, _test: { addDays, addMinutes, localIso } };

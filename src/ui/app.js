/* global postvak */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// Wizard: elke stap kan meerdere secties tonen.
const WIZARD = [
  { key: 'welcome', label: 'step_welcome', secs: ['welcome'] },
  { key: 'claude', label: 'step_claude', secs: ['claude'] },
  { key: 'mail', label: 'step_mail', secs: ['mail'] },
  { key: 'calendar', label: 'step_calendar', secs: ['calendar'], skippable: true },
  { key: 'notify', label: 'step_notify', secs: ['notify'] },
  { key: 'safe', label: 'step_safe', secs: ['safe'] },
  { key: 'rules', label: 'step_rules', secs: ['rules', 'general'] },
];
const VIEWS = [
  { key: 'dashboard', label: 'nav_dashboard', secs: ['dashboard'] },
  { key: 'contacts', label: 'step_contacts', secs: ['contacts'] },
  { key: 'settings', label: 'nav_settings', secs: ['general', 'safe', 'rules', 'notify', 'mail', 'calendar', 'claude'] },
];

let cfg = null;
let S = {}; // ui-teksten
let languages = [];
let mode = 'wizard';
let current = null;
let botName = '';
let waState = { linked: false, connected: false };

const L = (key, vars = {}) => {
  let s = S[key] || key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
};

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 3500);
}

function getPath(o, p) { return p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o); }
function setPath(o, p, v) {
  const ks = p.split('.');
  let x = o;
  for (const k of ks.slice(0, -1)) x = x[k] = x[k] || {};
  x[ks.at(-1)] = v;
}

function setResult(key, text, kind) {
  const el = $(`[data-result="${key}"]`);
  if (!el) return;
  el.textContent = text;
  el.className = 'result ' + (kind || '');
}

// ---------- vertalen ----------
async function loadLang(lang) {
  const r = await postvak.i18n(lang);
  S = r.data.ui;
  languages = r.data.languages;
  document.documentElement.lang = lang;
  for (const el of $$('[data-i18n]')) el.textContent = L(el.dataset.i18n);
  for (const el of $$('[data-i18n-html]')) el.innerHTML = L(el.dataset.i18nHtml);
  for (const a of $$('a[data-ext]')) a.onclick = (e) => { e.preventDefault(); postvak.openExternal(a.href); };
  for (const sel of $$('.langPick')) {
    sel.innerHTML = languages.map((l) => `<option value="${l.code}">${l.name}</option>`).join('');
    sel.value = lang;
  }
  for (const o of $$('[data-path="intervalMin"] option')) o.textContent = `${o.value} ${L('minutes')}`;
}

// ---------- formulier <-> config ----------
function fill() {
  for (const el of $$('[data-path]')) {
    const v = getPath(cfg, el.dataset.path);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.dataset.secret) {
      el.value = '';
      el.placeholder = cfg.secretsSet[el.dataset.secret] ? '•••••••• ✓' : el.getAttribute('placeholder') || '';
    } else el.value = v == null ? '' : v;
  }
  $('#mailEmail').value = cfg.imap.user || '';
  renderContacts();
  for (const b of $$('[data-safe]')) b.classList.toggle('on', String(cfg.safeMode) === b.dataset.safe);
  if (cfg.telegram.chatId) setResult('pair', L('paired'), 'ok');
  if (cfg.secretsSet['google.refreshToken']) setResult('google', L('connected'), 'ok');
  renderSideFoot();
}

function collect(root) {
  const out = {};
  for (const el of $$('[data-path]', root)) {
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number' || 'num' in el.dataset) v = Number(el.value) || 0;
    else v = el.value.trim();
    setPath(out, el.dataset.path, v);
  }
  return out;
}

function visibleSecs() { return $$('.sec.show'); }

async function saveVisible() {
  const data = {};
  for (const sec of visibleSecs()) Object.assign(data, deepMerge(data, collect(sec)));
  if ($('[data-sec="contacts"]').classList.contains('show')) data.contacts = readContacts();
  if (!Object.keys(data).length) return true;
  const r = await postvak.saveConfig(data);
  if (!r.ok) { toast(r.error, true); return false; }
  cfg = r.data;
  fill();
  return true;
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(a[k] || {}, v) : v;
  return out;
}

// ---------- contacten ----------
function contactRow(c = {}) {
  const row = document.createElement('div');
  row.className = 'crow';
  row.innerHTML = `<input class="c-name" placeholder="${L('c_name')}" /><input class="c-email" type="email" placeholder="${L('c_email')}" /><input class="c-phone" placeholder="${L('c_phone')}" /><label class="inline c-vipl"><input type="checkbox" class="c-vip" /> ${L('c_vip')}</label><button class="btn small c-del" title="✕">✕</button>`;
  $('.c-name', row).value = c.name || '';
  $('.c-email', row).value = c.email || '';
  $('.c-phone', row).value = c.phone || '';
  $('.c-vip', row).checked = !!c.vip;
  $('.c-del', row).onclick = () => { row.remove(); renderEmptyContacts(); };
  return row;
}
function renderContacts() {
  const box = $('#contactsList');
  box.innerHTML = '';
  for (const c of cfg.contacts || []) box.appendChild(contactRow(c));
  renderEmptyContacts();
}
function renderEmptyContacts() {
  const box = $('#contactsList');
  const empty = $('.c-empty', box);
  if (!$('.crow', box)) { if (!empty) box.insertAdjacentHTML('beforeend', `<p class="muted c-empty">${L('c_none')}</p>`); }
  else if (empty) empty.remove();
}
function readContacts() {
  return $$('#contactsList .crow').map((r) => ({
    name: $('.c-name', r).value.trim(), email: $('.c-email', r).value.trim(), phone: $('.c-phone', r).value.trim(), vip: $('.c-vip', r).checked,
  })).filter((c) => c.name);
}

// ---------- navigatie ----------
function list() { return mode === 'wizard' ? WIZARD : VIEWS; }

function renderNav() {
  const nav = $('#nav');
  nav.innerHTML = '';
  const l = list();
  const ci = l.findIndex((s) => s.key === current);
  l.forEach((step, i) => {
    const a = document.createElement('button');
    a.className = 'nav-item' + (step.key === current ? ' on' : '');
    a.textContent = (mode === 'wizard' ? `${i + 1}. ` : '') + L(step.label);
    if (mode === 'wizard') a.disabled = ci < i;
    a.onclick = () => go(step.key);
    nav.appendChild(a);
  });
}

function renderSideFoot() {
  const f = $('#sideFoot');
  if (!cfg) return;
  if (mode === 'wizard') { f.textContent = L('setup'); return; }
  f.innerHTML = '';
  const b = document.createElement('button');
  b.className = 'link';
  b.textContent = L('rerun');
  b.onclick = async () => {
    const r = await postvak.resetSetup();
    if (r.ok) { cfg = r.data; mode = 'wizard'; go('welcome'); }
  };
  f.appendChild(b);
}

function go(key) {
  current = key;
  const l = list();
  const i = l.findIndex((s) => s.key === key);
  const step = l[i];
  document.body.classList.toggle('settings-mode', mode !== 'wizard');
  $('#main').classList.toggle('stacked', step.secs.length > 1);
  for (const s of $$('.sec')) s.classList.toggle('show', step.secs.includes(s.dataset.sec));
  // secties in dezelfde volgorde als de stap
  for (const name of step.secs) $('#bar').before($(`[data-sec="${name}"]`));
  const bar = $('#bar');
  if (mode === 'wizard') {
    bar.classList.remove('hidden');
    $('#btnBack').style.visibility = i === 0 ? 'hidden' : 'visible';
    $('#btnSkip').classList.toggle('hidden', !step.skippable);
    $('#btnNext').textContent = i === l.length - 1 ? L('finish') : key === 'welcome' ? L('start') : L('next');
  } else {
    bar.classList.toggle('hidden', key === 'dashboard');
    $('#btnBack').style.visibility = 'hidden';
    $('#btnSkip').classList.add('hidden');
    $('#btnNext').textContent = L('save');
  }
  if (key === 'dashboard') refreshStatus();
  renderNav();
  $('#main').scrollTop = 0;
}

function validate(key) {
  if (key === 'mail' && !(cfg.imap.host && cfg.imap.user && cfg.secretsSet['imap.pass'])) return L('err_mail');
  if (key === 'notify' && !cfg.telegram.chatId) return L('need_channel');
  return null;
}

async function next() {
  if (!(await saveVisible())) return;
  if (mode !== 'wizard') { toast(L('saved')); return; }
  const err = validate(current);
  if (err) { toast(err, true); return; }
  const i = WIZARD.findIndex((s) => s.key === current);
  if (i < WIZARD.length - 1) return go(WIZARD[i + 1].key);
  const r = await postvak.finishSetup();
  if (!r.ok) return toast(r.error, true);
  cfg = r.data;
  mode = 'settings';
  renderSideFoot();
  go('dashboard');
  toast(L('running'));
}

// ---------- mail ----------
async function detectMail() {
  const email = $('#mailEmail').value.trim();
  if (!email.includes('@')) return toast(L('err_mail'), true);
  setResult('detect', '…', 'busy');
  const r = await postvak.detectMail(email);
  if (!r.ok) return setResult('detect', '❌ ' + r.error, 'err');
  const d = r.data;
  const set = (p, v) => { const el = $(`[data-path="${p}"]`); if (el.type === 'checkbox') el.checked = v; else el.value = v; };
  for (const k of ['imap', 'smtp']) {
    set(`${k}.host`, d[k].host); set(`${k}.port`, d[k].port); set(`${k}.secure`, d[k].secure); set(`${k}.user`, d[k].user);
  }
  const pass = $('[data-path="imap.pass"]').value;
  if (pass) $('[data-path="smtp.pass"]').value = pass;
  if (d.source === 'guess') {
    setResult('detect', L('not_detected'), 'err');
    $('#mailAdvanced').open = true;
  } else setResult('detect', L('detected', { d: email.split('@')[1] }), 'ok');
}

// ---------- tests & koppelen ----------
async function runTest(kind, btn) {
  const data = collect(btn.closest('.sec'));
  setResult(kind, '…', 'busy');
  btn.disabled = true;
  let r;
  try {
    if (kind === 'claude') r = await postvak.testClaude(data.claude);
    if (kind === 'imap') r = await postvak.testImap(data.imap);
    if (kind === 'smtp') r = await postvak.testSmtp(data.smtp);
    if (kind === 'telegram') r = await postvak.telegramTest(data.telegram.token);
  } finally { btn.disabled = false; }
  if (!r.ok) return setResult(kind, '❌ ' + r.error, 'err');
  if (kind === 'claude') setResult(kind, L('claude_ok', { r: r.data }), 'ok');
  if (kind === 'imap') setResult(kind, L('imap_ok', { n: r.data.messages }), 'ok');
  if (kind === 'smtp') setResult(kind, L('smtp_ok'), 'ok');
  if (kind === 'telegram') { botName = r.data.username; setResult(kind, `✅ @${r.data.username}`, 'ok'); }
}

async function pair() {
  const token = $('[data-path="telegram.token"]').value.trim();
  if (!token && !cfg.secretsSet['telegram.token']) return toast(L('err_token'), true);
  if (!botName) {
    const tt = await postvak.telegramTest(token || undefined);
    if (!tt.ok) return setResult('pair', '❌ ' + tt.error, 'err');
    botName = tt.data.username;
  }
  setResult('pair', L('pair_wait', { bot: botName }), 'busy');
  postvak.openExternal(`https://t.me/${botName}`);
  const r = await postvak.telegramPair(token || undefined);
  if (!r.ok) return setResult('pair', '❌ ' + r.error, 'err');
  const c = await postvak.getConfig();
  if (c.ok) { cfg = c.data; fill(); }
  setResult('pair', L('paired') + (r.data.name ? ' (' + r.data.name + ')' : ''), 'ok');
}

async function connectGoogle() {
  const data = collect($('[data-sec="calendar"]')).google;
  if (!data.clientId) return toast(L('err_client_id'), true);
  if (!data.clientSecret && !cfg.secretsSet['google.clientSecret']) return toast(L('err_client_secret'), true);
  if (!data.clientSecret) delete data.clientSecret;
  setResult('google', L('login_browser'), 'busy');
  const r = await postvak.googleConnect(data);
  if (!r.ok) return setResult('google', '❌ ' + r.error, 'err');
  const c = await postvak.getConfig();
  if (c.ok) { cfg = c.data; fill(); }
  fillCalendars(r.data);
  setResult('google', L('connected'), 'ok');
}

function fillCalendars(items) {
  const sel = $('#calSelect');
  sel.innerHTML = '';
  for (const c of items) {
    const o = document.createElement('option');
    o.value = c.primary ? 'primary' : c.id;
    o.textContent = c.name + (c.primary ? ` (${L('primary')})` : '');
    sel.appendChild(o);
  }
  sel.value = cfg.google.calendarId || 'primary';
}

function renderWa() {
  const linked = waState.linked || waState.connected;
  $('#btnWa').classList.toggle('hidden', !!waState.connected);
  $('#btnWaLogout').classList.toggle('hidden', !linked);
  if (waState.connected) {
    $('#waQr').classList.add('hidden');
    setResult('wa', L('wa_linked', { name: waState.name || '' }), 'ok');
  }
}

async function connectWa() {
  setResult('wa', L('wa_waiting'), 'busy');
  const r = await postvak.waConnect();
  if (!r.ok) return setResult('wa', '❌ ' + r.error, 'err');
  waState = { ...waState, ...r.data };
  renderWa();
}

// ---------- dashboard ----------
function fmt(iso) { return iso ? new Date(iso).toLocaleString(document.documentElement.lang === 'nl' ? 'nl-NL' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) : L('never'); }

function addLogLine(l) {
  const d = document.createElement('div');
  d.className = 'l ' + l.level;
  d.textContent = `${new Date(l.t).toLocaleTimeString()}  ${l.msg}`;
  $('#log').prepend(d);
}

async function refreshStatus() {
  const r = await postvak.status();
  if (!r.ok) return;
  const s = r.data;
  waState = s.whatsapp || waState;
  renderWa();
  $('#stLast').textContent = s.busy ? L('checking') : fmt(s.lastCheck);
  $('#stSafe').textContent = s.safeMode ? L('on') : L('off');
  $('#stPending').textContent = s.pending;
  $('#stWa').textContent = s.whatsapp.connected ? '✅ ' + (s.whatsapp.name || '') : s.whatsapp.linked ? '…' : '–';
  const e = $('#stError');
  e.textContent = s.lastError ? '⚠️ ' + s.lastError : '';
  e.classList.toggle('hidden', !s.lastError);
  $('#log').innerHTML = '';
  s.log.forEach(addLogLine);
}

function showUpdate(u) {
  if (!u) return;
  const box = $('#stUpdate');
  const txt = u.state === 'downloading' ? L('update_found', { v: u.version }) : u.state === 'ready' ? L('update_ready', { v: u.version }) : '';
  box.classList.toggle('hidden', !txt);
  $('#stUpdateText').textContent = txt;
  $('#btnRestart').classList.toggle('hidden', u.state !== 'ready');
  if (u.state === 'none') setResult('update', L('up_to_date'), 'ok');
  else if (u.state === 'error') setResult('update', '❌ ' + u.error, 'err');
  else if (txt) setResult('update', txt, 'busy');
}

// ---------- init ----------
async function init() {
  const r = await postvak.getConfig();
  cfg = r.data;
  await loadLang(cfg.language || 'en');
  mode = cfg.setupDone ? 'settings' : 'wizard';
  fill();

  const info = await postvak.appInfo();
  if (info.ok) { $('#appVersion').textContent = info.data.version; showUpdate(info.data.update); }

  $('#btnNext').onclick = next;
  $('#btnBack').onclick = () => { const l = list(); go(l[Math.max(0, l.findIndex((s) => s.key === current) - 1)].key); };
  $('#btnSkip').onclick = () => { const l = list(); go(l[l.findIndex((s) => s.key === current) + 1].key); };
  for (const b of $$('[data-test]')) b.onclick = () => runTest(b.dataset.test, b);
  $('#btnPair').onclick = pair;
  $('#btnGoogle').onclick = connectGoogle;
  $('#btnDetect').onclick = detectMail;
  $('#mailEmail').addEventListener('input', (e) => {
    for (const p of ['imap.user', 'smtp.user']) $(`[data-path="${p}"]`).value = e.target.value.trim();
  });
  $('#mailEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') detectMail(); });
  $('#btnWa').onclick = connectWa;
  $('#btnWaLogout').onclick = async () => {
    await postvak.waLogout();
    waState = { linked: false, connected: false };
    setResult('wa', '', '');
    renderWa();
  };
  $('#btnAddContact').onclick = () => {
    $('#contactsList').appendChild(contactRow());
    renderEmptyContacts();
    $$('#contactsList .c-name').at(-1).focus();
  };
  $('#btnTestMsg').onclick = async () => {
    const r2 = await postvak.telegramTestMsg();
    setResult('testmsg', r2.ok ? L('sent') : '❌ ' + r2.error, r2.ok ? 'ok' : 'err');
  };
  $('#btnCheck').onclick = async () => {
    $('#stLast').textContent = L('checking');
    await postvak.checkNow();
    refreshStatus();
  };
  $('#btnUpdate').onclick = async () => {
    setResult('update', '…', 'busy');
    const u = await postvak.checkUpdate();
    if (!u.ok) return setResult('update', '❌ ' + u.error, 'err');
    if (u.data.state === 'dev') return setResult('update', 'dev', 'busy');
    showUpdate(u.data);
  };
  $('#btnRestart').onclick = () => postvak.installUpdate();
  $('#btnResetRules').onclick = async () => {
    const d = await postvak.defaultRules();
    $('[data-path="rules"]').value = d.data;
  };
  for (const sel of $$('.langPick')) {
    sel.onchange = async () => {
      const r2 = await postvak.saveConfig({ language: sel.value });
      if (!r2.ok) return;
      cfg = r2.data;
      await loadLang(cfg.language);
      fill();
      go(current);
    };
  }
  for (const b of $$('[data-safe]')) {
    b.onclick = async () => {
      const r2 = await postvak.saveConfig({ safeMode: b.dataset.safe === 'true' });
      if (r2.ok) { cfg = r2.data; fill(); if (mode !== 'wizard') toast(L('saved')); }
    };
  }
  // SMTP-wachtwoord volgt het mailwachtwoord
  $('[data-path="imap.pass"]').addEventListener('input', (e) => {
    const s = $('[data-path="smtp.pass"]');
    if (!s.value || s.dataset.auto) { s.value = e.target.value; s.dataset.auto = '1'; }
  });

  postvak.on('log', (l) => { if (current === 'dashboard') addLogLine(l); });
  postvak.on('status', () => { if (current === 'dashboard') refreshStatus(); });
  postvak.on('config', (c) => { cfg = c; fill(); if (current === 'dashboard') refreshStatus(); });
  postvak.on('update', showUpdate);
  postvak.on('wa', (w) => {
    if (w.qr) {
      $('#waQrImg').src = w.qr;
      $('#waQr').classList.remove('hidden');
      setResult('wa', '', '');
    }
    if (w.open) { waState = { linked: true, connected: true, name: w.open.name }; renderWa(); }
    if (w.closed) { waState = { ...waState, connected: false, linked: !w.loggedOut }; renderWa(); }
  });

  const st = await postvak.status();
  if (st.ok) { waState = st.data.whatsapp; renderWa(); }
  if (cfg.secretsSet['google.refreshToken']) postvak.googleCalendars().then((c) => c.ok && fillCalendars(c.data));
  go(mode === 'wizard' ? 'welcome' : 'dashboard');
}

init();

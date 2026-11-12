/* global postvak */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// Wizard: elke stap kan meerdere secties tonen.
const WIZARD = [
  { key: 'welcome', label: 'step_welcome', secs: ['welcome'] },
  { key: 'ai', label: 'step_ai', secs: ['ai'] },
  { key: 'calendar', label: 'step_google', secs: ['calendar'], skippable: true },
  { key: 'mail', label: 'step_mail', secs: ['mail'] },
  { key: 'notify', label: 'step_notify', secs: ['notify'] },
  { key: 'safe', label: 'step_safe', secs: ['safe'] },
  { key: 'rules', label: 'step_rules', secs: ['rules', 'general'] },
];
const VIEWS = [
  { key: 'dashboard', label: 'nav_dashboard', secs: ['dashboard'] },
  { key: 'contacts', label: 'step_contacts', secs: ['contacts'] },
  { key: 'plugins', label: 'step_plugins', secs: ['plugins'] },
  { key: 'settings', label: 'nav_settings', secs: ['general', 'safe', 'rules', 'notify', 'mail', 'calendar', 'ai'] },
];

let cfg = null;
let S = {}; // ui-teksten
let languages = [];
let mode = 'wizard';
let current = null;
let botName = '';
let waState = { linked: false, connected: false };
let PROVIDERS = {};
let CATALOG = [];
const lang = () => (cfg && cfg.language) || 'en';
const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  showMailType();
  showAiPanel();
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

function hasGmail() { return cfg.secretsSet['google.refreshToken'] && /gmail/.test(cfg.google.scope || ''); }

function showMailType() {
  const g = $('#mailType').value === 'gmail';
  $('#gmailBox').classList.toggle('hidden', !g);
  $('#imapBox').classList.toggle('hidden', g);
  $('#btnGmailConnect').classList.toggle('hidden', hasGmail());
  if (g && hasGmail() && cfg.google.email) setResult('gmail', L('gmail_ok', { e: cfg.google.email }), 'ok');
}

// ---------- AI ----------
function renderAi() {
  const sel = $('#aiProvider');
  sel.innerHTML = Object.entries(PROVIDERS).map(([id, p]) => `<option value="${id}">${esc(p.name)}</option>`).join('');
  const box = $('#aiPanels');
  box.innerHTML = '';
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const base = `ai.providers.${id}`;
    let html = '<div class="grid">';
    if (p.kind === 'cli') html += `<label>${L('command')}<input data-path="${base}.command" placeholder="${id === 'codex' ? 'codex' : 'claude'}" /></label>`;
    else if (!p.noKey) html += `<label>${L('api_key')}<input type="password" data-path="${base}.apiKey" data-secret="${base}.apiKey" /></label>`;
    if (p.noKey) html += `<label>${L('base_url')}<input data-path="${base}.baseUrl" placeholder="${esc(p.base)}" /></label>`;
    html += `<label>${L('model')}<input data-path="${base}.model" placeholder="${esc(p.defaultModel ? L('model_placeholder', { m: p.defaultModel }) : L('model_default'))}" /></label></div>`;
    const hint = id === 'claude-code' ? L('claude_install') : id === 'codex' ? L('codex_install') : id === 'ollama' ? L('ollama_install') : p.keyUrl ? `<a href="${p.keyUrl}" data-ext>${L('get_key')} →</a>` : '';
    if (hint) html += `<p class="muted">${hint}</p>`;
    const div = document.createElement('div');
    div.className = 'ai-panel hidden';
    div.dataset.prov = id;
    div.innerHTML = html;
    box.appendChild(div);
  }
  for (const a of $$('a[data-ext]', box)) a.onclick = (e) => { e.preventDefault(); postvak.openExternal(a.href); };
  sel.onchange = showAiPanel;
}
function showAiPanel() {
  const v = $('#aiProvider').value;
  for (const d of $$('.ai-panel')) d.classList.toggle('hidden', d.dataset.prov !== v);
}

// ---------- plugins ----------
function renderPlugins() {
  const box = $('#pluginList');
  box.innerHTML = '';
  for (const p of CATALOG) {
    const card = document.createElement('div');
    card.className = 'sub plugin';
    const fields = p.settings.map((f) => {
      const path = `plugins.${p.id}.${f.key}`;
      const label = esc((f.label && (f.label[lang()] || f.label.en)) || f.key);
      const help = f.help ? ` <a href="${f.help}" data-ext>↗</a>` : '';
      if (f.type === 'textarea') return `<label>${label}${help}<textarea rows="3" data-path="${path}" placeholder="${esc(f.placeholder || '')}"></textarea></label>`;
      return `<label>${label}${help}<input type="${f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}" data-path="${path}"${f.secret ? ` data-secret="${path}"` : ''}${f.type === 'number' ? ' data-num' : ''} placeholder="${esc(f.placeholder || '')}" /></label>`;
    }).join('');
    card.innerHTML = `<div class="plugin-head"><h2>${p.icon} ${esc(p.name)}</h2><label class="switch"><input type="checkbox" data-path="plugins.${p.id}.enabled" /><span>${L('enabled')}</span></label></div>
      <p class="muted">${esc(p.description[lang()] || p.description.en)}</p><div class="plugin-fields">${fields}</div>`;
    box.appendChild(card);
    const toggle = $('input[type=checkbox]', card);
    const sync = () => card.classList.toggle('off', !toggle.checked);
    toggle.addEventListener('change', sync);
    setTimeout(sync);
  }
  for (const a of $$('a[data-ext]', box)) a.onclick = (e) => { e.preventDefault(); postvak.openExternal(a.href); };
}

// ---------- verbruik ----------
function fmtNum(n) { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n); }
function showUsage(u) {
  if (!u) return;
  $('#usageBar').classList.remove('hidden');
  $('#ubProv').textContent = '🧠 ' + (u.providerName || '');
  $('#ubText').textContent = `${L('usage_today')}: ${fmtNum(u.tokens)} tokens · ${u.calls} ${L('calls')}${u.cost ? ` · $${u.cost.toFixed(2)}` : ''}`;
  $('#ubMonth').textContent = `${L('usage_month')}: ${fmtNum(u.monthTokens)}${u.monthCost ? ` · $${u.monthCost.toFixed(2)}` : ''}`;
  const m = $('#ubMeter');
  m.classList.toggle('hidden', !u.limit);
  if (u.limit) {
    const f = Math.min(1, u.tokens / u.limit);
    $('#ubFill').style.width = (f * 100).toFixed(1) + '%';
    m.className = 'ub-meter' + (f >= 1 ? ' full' : f >= 0.8 ? ' warn' : '');
    m.title = `${fmtNum(u.tokens)} / ${fmtNum(u.limit)}`;
  }
}
async function refreshUsage() { const r = await postvak.usage(); if (r.ok) showUsage(r.data); }

function validate(key) {
  if (key === 'mail' && cfg.mailType === 'gmail') return hasGmail() ? null : L('gmail_hint');
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
    if (kind === 'imap') r = await postvak.testImap(data.imap);
    if (kind === 'smtp') r = await postvak.testSmtp(data.smtp);
    if (kind === 'telegram') r = await postvak.telegramTest(data.telegram.token);
  } finally { btn.disabled = false; }
  if (!r.ok) return setResult(kind, '❌ ' + r.error, 'err');
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
  data.gmail = $('#googleGmail').checked || cfg.mailType === 'gmail';
  if ($('#googleGmail').checked) await postvak.saveConfig({ mailType: 'gmail' });
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

function showUpdate(u, key) {
  if (!u) return;
  const box = $('#stUpdate');
  const txt = u.state === 'downloading' ? L('update_found', { v: u.version }) : u.state === 'ready' ? L('update_ready', { v: u.version }) : '';
  box.classList.toggle('hidden', !txt);
  $('#stUpdateText').textContent = txt;
  $('#btnRestart').classList.toggle('hidden', u.state !== 'ready');
  for (const k of key ? [key] : ['update', 'update2']) {
    if (u.state === 'none') setResult(k, L('up_to_date'), 'ok');
    else if (u.state === 'error') setResult(k, '❌ ' + u.error, 'err');
    else if (txt) setResult(k, txt, 'busy');
  }
}

// ---------- init ----------
async function init() {
  const r = await postvak.getConfig();
  cfg = r.data;
  PROVIDERS = (await postvak.aiProviders()).data;
  CATALOG = (await postvak.pluginCatalog()).data;
  await loadLang(cfg.language || 'en');
  renderAi();
  renderPlugins();
  mode = cfg.setupDone ? 'settings' : 'wizard';
  fill();

  const info = await postvak.appInfo();
  if (info.ok) { for (const v of $$('.appVersion')) v.textContent = info.data.version; showUpdate(info.data.update); }

  $('#btnNext').onclick = next;
  $('#mailType').onchange = showMailType;
  $('#btnTestAi').onclick = async () => {
    const data = collect($('[data-sec="ai"]')).ai;
    setResult('ai', '…', 'busy');
    const t = await postvak.testAi(data);
    setResult('ai', t.ok ? L('ai_ok', { r: t.data }) : '❌ ' + t.error, t.ok ? 'ok' : 'err');
    refreshUsage();
  };
  $('#btnTestGmail').onclick = async () => {
    const t = await postvak.testGmail();
    setResult('gmail', t.ok ? L('gmail_ok', { e: t.data.email }) : '❌ ' + t.error, t.ok ? 'ok' : 'err');
  };
  $('#btnGmailConnect').onclick = () => { $('#googleGmail').checked = true; go('calendar'); };
  postvak.on('usage', showUsage);
  refreshUsage();
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
  const checkUpd = (key) => async () => {
    setResult(key, '…', 'busy');
    const u = await postvak.checkUpdate();
    if (!u.ok) return setResult(key, '❌ ' + u.error, 'err');
    if (u.data.state === 'dev') return setResult(key, L('update_dev'), 'busy');
    showUpdate(u.data, key);
  };
  $('#btnUpdate').onclick = checkUpd('update');
  $('#btnUpdate2').onclick = checkUpd('update2');
  $('#themePick').onchange = async (e) => { const r2 = await postvak.saveConfig({ theme: e.target.value }); if (r2.ok) cfg = r2.data; };
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
      renderAi();
      renderPlugins();
      fill();
      refreshUsage();
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

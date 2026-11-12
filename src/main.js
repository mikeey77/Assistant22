// Electron hoofdproces: tray-icoon, venster, IPC, updates en de engine.
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, safeStorage, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const { Config } = require('./config');
const { Engine } = require('./engine');
const mail = require('./services/mail');
const google = require('./services/google');
const autodetect = require('./services/autodetect');
const { Telegram } = require('./services/telegram');
const ai = require('./services/ai');
const { Gmail } = require('./services/gmail');
const plugins = require('./plugins');
const { STRINGS, t } = require('./i18n');

// Naam is nu Assistant22, maar de gegevens blijven in de oude map zodat
// instellingen, wachtwoorden en de WhatsApp-koppeling behouden blijven.
app.setName('Assistant22');
app.setPath('userData', process.env.A22_USERDATA || path.join(app.getPath('appData'), 'Postvak'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let tray = null;
let quitting = false;
let config;
let engine;
let updater = null;
let updateState = { state: 'idle' };

const ICON = path.join(__dirname, 'ui', 'icon.png');
const L = (key, vars) => t(config.data.language, key, vars);

function crypt() {
  const ok = safeStorage.isEncryptionAvailable();
  return {
    encrypt: (s) => (ok ? safeStorage.encryptString(s).toString('base64') : Buffer.from(s).toString('base64')),
    decrypt: (s) => (ok ? safeStorage.decryptString(Buffer.from(s, 'base64')) : Buffer.from(s, 'base64').toString()),
  };
}

function showWindow() {
  if (win) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 780,
    minHeight: 560,
    title: 'Assistant22',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: '#f6f5f2',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.setToolTip('Assistant22');
    tray.on('click', showWindow);
  }
  const c = config.data;
  const nl = c.language === 'nl';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: nl ? 'Assistant22 openen' : 'Open Assistant22', click: showWindow },
    { label: nl ? 'Nu checken' : 'Check now', enabled: c.setupDone, click: () => engine.check({ manual: true }) },
    { type: 'separator' },
    {
      label: nl ? 'Safe mode (eerst toestemming)' : 'Safe mode (ask first)', type: 'checkbox', checked: c.safeMode,
      click: (item) => { config.update({ safeMode: item.checked }); send('config', config.publicView()); },
    },
    ...(updateState.state === 'ready' ? [{ label: nl ? 'Update installeren' : 'Install update', click: () => installUpdate() }] : []),
    { type: 'separator' },
    { label: nl ? 'Afsluiten' : 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function applyLogin() {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: !!config.data.openAtLogin, args: ['--hidden'] });
  }
}

// ---------- automatische updates (GitHub Releases) ----------
function setupUpdater() {
  if (!app.isPackaged) return;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  const set = (s) => { updateState = s; send('update', s); buildTray(); };
  updater.on('checking-for-update', () => set({ state: 'checking' }));
  updater.on('update-not-available', () => set({ state: 'none' }));
  updater.on('update-available', (i) => set({ state: 'downloading', version: i.version }));
  updater.on('update-downloaded', (i) => {
    set({ state: 'ready', version: i.version });
    engine.addLog('Update ' + i.version + ' ready');
  });
  updater.on('error', (e) => set({ state: 'error', error: String(e.message || e).split('\n')[0] }));
  const check = () => { if (config.data.autoUpdate) updater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 15000);
  setInterval(check, 6 * 3600 * 1000);
}

function installUpdate() {
  if (!updater || updateState.state !== 'ready') return;
  quitting = true;
  engine.shutdown();
  updater.quitAndInstall(true, true);
}

function wrap(fn) {
  return async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e.message || String(e) }; }
  };
}

function registerIpc() {
  ipcMain.handle('config:get', wrap(() => config.publicView()));
  ipcMain.handle('config:save', wrap((partial) => {
    config.update(partial);
    buildTray();
    applyLogin();
    if (config.data.setupDone && (partial.telegram || partial.google || partial.imap || partial.whatsapp)) engine.start();
    return config.publicView();
  }));
  ipcMain.handle('i18n:get', wrap((lang) => ({ ui: (STRINGS[lang] || STRINGS.en).ui, languages: Object.entries(STRINGS).map(([k, v]) => ({ code: k, name: v.languageName })) })));
  ipcMain.handle('defaults:rules', wrap(() => (STRINGS[config.data.language] || STRINGS.en).defaultRules));
  ipcMain.handle('app:info', wrap(() => ({ version: app.getVersion(), packaged: app.isPackaged, update: updateState })));

  ipcMain.handle('ai:providers', wrap(() => ai.PROVIDERS));
  ipcMain.handle('test:ai', wrap(async (aiCfg) => {
    const merged = JSON.parse(JSON.stringify(config.data.ai));
    if (aiCfg) {
      if (aiCfg.provider) merged.provider = aiCfg.provider;
      for (const [k, v] of Object.entries(aiCfg.providers || {})) {
        merged.providers[k] = { ...merged.providers[k], ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) };
      }
    }
    const r = await ai.complete(merged, 'Reply with exactly one word: OK', { cwd: app.getPath('userData') });
    config.update({ ai: { providers: { [merged.provider]: { tested: true } } } });
    return r.text.trim().slice(0, 100);
  }));
  ipcMain.handle('plugins:catalog', wrap(() => plugins.catalog()));
  ipcMain.handle('usage:get', wrap(() => engine.usageInfo()));
  ipcMain.handle('test:gmail', wrap(async () => new Gmail(config.data.google).test()));
  ipcMain.handle('mail:detect', wrap((email) => autodetect.detect(email)));
  ipcMain.handle('test:imap', wrap(async (c) => mail.testImap({ ...config.data.imap, ...stripEmpty(c) })));
  ipcMain.handle('test:smtp', wrap(async (c) => mail.testSmtp({ ...config.data.smtp, ...stripEmpty(c) })));

  ipcMain.handle('google:connect', wrap(async (c) => {
    const { gmail, ...g } = c || {};
    config.update({ google: g });
    const res = await google.connect(config.data.google, (url) => shell.openExternal(url), { gmail: config.data.mailType === 'gmail' || !!(c && c.gmail) });
    config.update({ google: { refreshToken: res.refreshToken, scope: res.scope } });
    if (/gmail/.test(res.scope)) {
      try { const prof = await new Gmail(config.data.google).test(); config.update({ google: { email: prof.email } }); } catch { /* geen gmail */ }
    }
    if (engine.calendar) engine.calendar = new google.GoogleCalendar(config.data.google);
    return new google.GoogleCalendar(config.data.google).listCalendars();
  }));
  ipcMain.handle('google:calendars', wrap(async () => new google.GoogleCalendar(config.data.google).listCalendars()));

  ipcMain.handle('telegram:test', wrap(async (token) => {
    const me = await new Telegram(token || config.data.telegram.token).getMe();
    return { username: me.username, name: me.first_name };
  }));
  ipcMain.handle('telegram:pair', wrap(async (token) => {
    if (token) config.update({ telegram: { token, chatId: null } });
    engine.stop();
    const chat = await engine.waitForPairing();
    if (config.data.setupDone) engine.start();
    return chat;
  }));
  ipcMain.handle('telegram:testmsg', wrap(async () => {
    const tg = new Telegram(config.data.telegram.token);
    await tg.send(config.data.telegram.chatId, t(config.data.language, 'bot.testMsg'));
    return true;
  }));

  ipcMain.handle('wa:connect', wrap(async () => {
    config.update({ whatsapp: { enabled: true } });
    await engine.waConnect();
    return engine.status().whatsapp;
  }));
  ipcMain.handle('wa:logout', wrap(async () => {
    await engine.waLogout();
    config.update({ whatsapp: { enabled: false } });
    return true;
  }));
  ipcMain.handle('setup:finish', wrap(() => {
    config.update({ setupDone: true });
    applyLogin();
    buildTray();
    engine.start();
    engine.goOnline();
    return config.publicView();
  }));
  ipcMain.handle('setup:reset', wrap(() => {
    config.update({ setupDone: false });
    engine.stop();
    buildTray();
    return config.publicView();
  }));

  ipcMain.handle('engine:status', wrap(() => engine.status()));
  ipcMain.handle('engine:check', wrap(async () => { await engine.check({ manual: true }); return engine.status(); }));
  ipcMain.handle('update:check', wrap(async () => {
    if (!updater) return { state: 'dev' };
    await updater.checkForUpdates();
    return updateState;
  }));
  ipcMain.handle('update:install', wrap(() => installUpdate()));
  ipcMain.handle('open:external', wrap((url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  }));
}

function stripEmpty(o) {
  const out = { ...(o || {}) };
  if (out.pass === '') delete out.pass;
  return out;
}

app.on('second-instance', showWindow);
app.on('window-all-closed', () => { /* blijf draaien in de tray */ });
let offlineSent = false;
app.on('before-quit', (e) => {
  quitting = true;
  if (!engine) return;
  if (offlineSent) { engine.shutdown(); return; }
  // eerst een offline-bericht naar Telegram, dan pas afsluiten
  e.preventDefault();
  offlineSent = true;
  Promise.race([engine.goOffline('closed'), new Promise((r) => setTimeout(r, 4000))]).finally(() => {
    engine.shutdown();
    app.quit();
  });
});

app.whenReady().then(async () => {
  if (process.env.POSTVAK_SELFTEST) {
    // Controleert of alle modules laden in de gepackte app.
    try {
      const B = await import('baileys');
      require('qrcode'); require('imapflow'); require('electron-updater');
      console.log('SELFTEST OK', typeof B.makeWASocket);
      if (process.env.POSTVAK_SELFTEST === 'wa') {
        const { WhatsApp } = require('./services/whatsapp');
        const wa = new WhatsApp(path.join(app.getPath('temp'), 'pv-wa-selftest'));
        wa.on('error', (e) => console.log('SELFTEST WA ERR', e.message));
        wa.on('close', (c) => console.log('SELFTEST WA close', c.code));
        wa.on('qr', () => console.log('SELFTEST WA QR'));
        await wa.start();
        await new Promise((r) => setTimeout(r, 12000));
        wa.stop();
        console.log('SELFTEST WA DONE');
      }
    } catch (e) { console.log('SELFTEST FAIL', e.message); }
    app.exit(0);
    return;
  }
  app.setAppUserModelId('nl.postvak.app'); // zelfde id: update installeert over de oude versie heen
  config = new Config(app.getPath('userData'), crypt());
  engine = new Engine(config, {
    workDir: path.join(app.getPath('userData'), 'werkmap'),
    waAuthDir: path.join(app.getPath('userData'), 'whatsapp-auth'),
  });
  engine.on('log', (l) => send('log', l));
  engine.on('status', () => send('status', engine.status()));
  engine.on('config', () => { send('config', config.publicView()); buildTray(); });
  engine.on('wa', (w) => send('wa', w));
  engine.on('usage', (u) => send('usage', u));

  registerIpc();
  buildTray();
  applyLogin();
  setupUpdater();

  powerMonitor.on('suspend', () => { if (config.data.setupDone) engine.goOffline('sleep'); });
  powerMonitor.on('resume', () => { if (config.data.setupDone) { engine.start(); engine.goOnline(); } });

  const hidden = process.argv.includes('--hidden');
  if (config.data.setupDone) { engine.start(); engine.goOnline(); }
  if (!config.data.setupDone || !hidden) showWindow();
});


const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('postvak', {
  getConfig: call('config:get'),
  saveConfig: call('config:save'),
  i18n: call('i18n:get'),
  defaultRules: call('defaults:rules'),
  appInfo: call('app:info'),
  testClaude: call('test:claude'),
  detectMail: call('mail:detect'),
  testImap: call('test:imap'),
  testSmtp: call('test:smtp'),
  googleConnect: call('google:connect'),
  googleCalendars: call('google:calendars'),
  telegramTest: call('telegram:test'),
  telegramPair: call('telegram:pair'),
  telegramTestMsg: call('telegram:testmsg'),
  waConnect: call('wa:connect'),
  waLogout: call('wa:logout'),
  finishSetup: call('setup:finish'),
  resetSetup: call('setup:reset'),
  status: call('engine:status'),
  checkNow: call('engine:check'),
  checkUpdate: call('update:check'),
  installUpdate: call('update:install'),
  openExternal: call('open:external'),
  on: (channel, fn) => {
    if (['log', 'status', 'config', 'wa', 'update'].includes(channel)) ipcRenderer.on(channel, (_e, d) => fn(d));
  },
});

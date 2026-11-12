// Start de echte app met een tijdelijke datamap en maak screenshots.
// Gebruik: xvfb-run electron test/screenshot.js <uitmap> [settings]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6) || '/tmp/shots';
const settings = process.argv.includes('--settings');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-'));
process.env.A22_USERDATA = tmp;
if (settings) {
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
    setupDone: true, language: process.argv.includes('--nl') ? 'nl' : 'en', telegram: { chatId: 1 }, state: { usage: { date: new Date().toLocaleDateString('sv-SE'), tokens: 48200, calls: 14, cost: 0.31, month: new Date().toLocaleDateString('sv-SE').slice(0,7), monthTokens: 612000, monthCalls: 190, monthCost: 3.9 } }, usageLimit: { dailyTokens: 100000 }, plugins: { upwork: { enabled: true, keywords: 'electron, automation' } }, contacts: [{ name: 'Sanne de Boer', phone: '0611111111', vip: true }, { name: 'Peter de Vries', email: 'peter@school.nl' }], imap: { host: 'imap.transip.email', user: 'michael@voorbeeld.nl' },
  }));
}
fs.mkdirSync(out, { recursive: true });
require('../src/main.js');

const sections = settings ? ['dashboard', 'contacts', 'plugins', 'settings'] : ['welcome', 'ai', 'calendar', 'mail', 'notify', 'safe', 'rules'];
app.whenReady().then(() => setTimeout(async () => {
  const w = BrowserWindow.getAllWindows()[0];
  for (const s of sections) {
    await w.webContents.executeJavaScript(`go(${JSON.stringify(s)})`);
    await new Promise((r) => setTimeout(r, 400));
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${settings ? 'set' : 'wiz'}-${s}.png`), img.toPNG());
  }
  app.exit(0);
}, 1500));

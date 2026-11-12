// Maakt de afbeeldingen voor de README (banner + Telegram-voorbeeld).
// Gebruik: xvfb-run electron test/readme-images.js <uitmap>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6) || 'docs/img';
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png')).toString('base64');

const banner = `<html><body style="margin:0;width:1280px;height:420px;font-family:'Segoe UI',Inter,system-ui,sans-serif;
background:radial-gradient(circle at 15% 20%,#3b7bff 0,transparent 45%),radial-gradient(circle at 85% 80%,#1d8a4e 0,transparent 40%),#0f1420;color:#fff;display:flex;align-items:center;overflow:hidden">
<div style="padding-left:90px;flex:1">
 <div style="display:flex;align-items:center;gap:22px"><img src="${icon}" style="width:96px;height:96px;border-radius:22px;box-shadow:0 10px 40px rgba(0,0,0,.4)">
 <div style="font-size:68px;font-weight:800;letter-spacing:-2px">Assistant22</div></div>
 <div style="font-size:28px;margin-top:22px;color:#cfd8ea;max-width:640px;line-height:1.35">Your personal assistant for email, WhatsApp &amp; calendar. Powered by AI, controlled from Telegram.</div>
 <div style="display:flex;gap:10px;margin-top:28px">${['📧 Email', '💬 WhatsApp', '📅 Calendar', '🧩 Plugins', '🛡️ Safe mode'].map((t) => `<span style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);padding:8px 16px;border-radius:99px;font-size:18px">${t}</span>`).join('')}</div>
</div>
<div style="width:360px;margin-right:70px;transform:rotate(3deg) scale(.86)">
 ${[['🔴 <b>Invoice due Friday</b>', 'From: Energy company · €84.20, due Fri 20 Nov'], ['💬 <b>Sanne</b>', 'Dinner Saturday at 7? <i>“Bij mij thuis”</i>'], ['📅 <b>Add to calendar?</b>', '📝 Test – Fri 13 Nov 10:00–11:00']].map(([h, b]) => `<div style="background:#1c2433;border:1px solid #2c3850;border-radius:16px;padding:16px 18px;margin:12px 0;box-shadow:0 8px 30px rgba(0,0,0,.35)"><div style="font-size:19px">${h}</div><div style="font-size:16px;color:#aab6cc;margin-top:6px">${b}</div><div style="display:flex;gap:8px;margin-top:12px"><span style="flex:1;text-align:center;background:#2a3650;border-radius:9px;padding:7px;font-size:14px">✅ Approve</span><span style="flex:1;text-align:center;background:#2a3650;border-radius:9px;padding:7px;font-size:14px">💬 Reply</span></div></div>`).join('')}
</div></body></html>`;

const bubble = (html, btns = []) => `<div style="max-width:440px;margin:10px 0 0 16px"><div style="background:#fff;border-radius:16px 16px 16px 4px;padding:10px 14px;font-size:15px;line-height:1.45;box-shadow:0 1px 1px rgba(0,0,0,.12)">${html}</div>
${btns.map((row) => `<div style="display:flex;gap:4px;margin-top:4px">${row.map((b) => `<div style="flex:1;text-align:center;background:rgba(0,0,0,.22);color:#fff;border-radius:10px;padding:8px;font-size:14px;font-weight:600">${b}</div>`).join('')}</div>`).join('')}</div>`;
const mine = (t) => `<div style="display:flex;justify-content:flex-end;margin:10px 16px 0 0"><div style="background:#e1ffc7;border-radius:16px 16px 4px 16px;padding:10px 14px;font-size:15px;max-width:360px;box-shadow:0 1px 1px rgba(0,0,0,.12)">${t}</div></div>`;
const chat = `<html><body style="margin:0;width:520px;height:900px;font-family:'Segoe UI',system-ui,sans-serif;background:linear-gradient(160deg,#8bb37a,#5f8f6b);overflow:hidden">
<div style="background:#517da2;color:#fff;padding:14px 18px;display:flex;align-items:center;gap:12px"><img src="${icon}" style="width:40px;height:40px;border-radius:50%"><div><div style="font-weight:700;font-size:17px">Assistant22</div><div style="font-size:13px;opacity:.8">bot</div></div></div>
${bubble('☀️ <b>Good morning!</b><br>🌦️ <b>Amsterdam</b>: 6–11°C, chance of rain 70% ☔<br><br>📅 <b>Today</b><br>• Thu 12 Nov 18:00–22:00 — 💼 Work<br><br>📥 <b>Messages (24h)</b><br>• 📧 <b>Invoice due Friday</b> — €84.20')}
${bubble('💬 <b>Sanne de Boer</b><br><br>Asks if you want to have dinner on Saturday at 7.<br><br><i>“Zin in eten zaterdag 19:00? Bij mij thuis”</i>', [['💬 Reply', '✨ Write reply for me']])}
${mine('Leuk! Ik neem toetje mee 🍰')}
${bubble('✉️ <b>Send this reply to 💬 Sanne de Boer?</b><br><i>↩︎ “Bij mij thuis”</i><br><br>Leuk! Ik neem toetje mee 🍰', [['✅ Send', '❌ Decline'], ['⏰ 1 hour', '⏰ Tomorrow', '✏️ Edit']])}
${bubble('✅ <i>WhatsApp reply sent to Sanne de Boer</i>')}
${mine('email Peter that I\'ll be 10 minutes late')}
${bubble('✉️ <b>Send email to Peter de Vries &lt;peter@school.nl&gt;?</b><br><b>Running late</b><br><br>Hi Peter, I\'ll be about 10 minutes late. See you soon! Michael', [['✅ Send', '❌ Decline'], ['⏰ 1 hour', '⏰ Tomorrow', '✏️ Edit']])}
</body></html>`;

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
  for (const [name, html, w, h] of [['banner', banner, 1280, 420], ['telegram', chat, 520, 900]].filter((x) => !only || x[0] === only)) {
    const win = new BrowserWindow({ width: w, height: h, show: false, useContentSize: true, webPreferences: { offscreen: false } });
    const tmp = path.join(require('os').tmpdir(), `a22-${name}.html`);
    fs.writeFileSync(tmp, '<meta charset="utf-8">' + html);
    await win.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 600));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
    win.destroy();
  }
  app.exit(0);
});

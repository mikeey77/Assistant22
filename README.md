# Postvak

A simple email, WhatsApp and calendar assistant for Windows. Postvak checks your
inbox (IMAP) and WhatsApp, lets Claude Code decide what matters, puts appointments
in Google Calendar and talks to you on **Telegram**: your one place for
notifications, approvals and sending emails or WhatsApps.

**[⬇️ Download the latest version](https://github.com/mikeey77/Assistant22/releases/latest)**

## Features
- Checks email (IMAP) and WhatsApp every 5/15/30/60 minutes
- Claude Code (on your own subscription) judges new messages using your rules
- Important messages → notification with a short summary
- **VIP list**: messages from these senders are always urgent (with sound); others arrive silently
- Appointments → Google Calendar suggestion
- Reply suggestions (email and WhatsApp) → **always** sent only after your ✅
- Buttons: ✅ Approve · ❌ Decline · ⏰ 1 hour · ⏰ Tomorrow · ✏️ Edit (rewrite the reply in chat)
- **Safe mode**: everything needs approval
- Daily overview every morning
- **Send emails and WhatsApps from Telegram**: "email Peter that I'll be late" → draft → ✅
- **Contacts**: manage them in the app, add them from Telegram, or tap 👤 under a notification
- Chat with Postvak in Telegram: questions, calendar items, messages
- English / Dutch, automatic updates via GitHub Releases

## Telegram commands
| Command | What |
|---|---|
| `/check` | Check now |
| `/today` (`/vandaag`) | Today's agenda |
| `/contacts` (`/contacten`) | Your contacts |
| `/status` | Status and waiting actions |
| `/safemode on` / `off` | Toggle safe mode |
| free text | Ask anything, e.g. "what's on tomorrow?", "whatsapp Sanne: see you tonight", "add Jan, jan@mail.com, 0612345678 to my contacts" |

## Install
1. Download `Postvak-Setup-x.y.z.exe` from [Releases](https://github.com/mikeey77/Assistant22/releases/latest).
2. Windows SmartScreen warns because the installer isn't signed: **More info → Run anyway**.
3. Follow the setup wizard. Later updates install themselves.

## Requirements
- Windows 10/11
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and logged in
- Telegram bot (via @BotFather) and/or WhatsApp
- Optional: Google Cloud OAuth Client ID ("Desktop app") for Google Calendar

## WhatsApp
WhatsApp is optional and works like an extra inbox: Postvak checks incoming chats
the same way it checks email, and can send WhatsApps (replies or new messages)
after you approve them in Telegram. It is linked like WhatsApp Web (QR code, via the
Baileys library). This is **unofficial**: WhatsApp has no API for personal
accounts, so there is a small risk of your number being restricted.

## Development
```bash
npm install
npm start          # run the app
npm test           # engine tests
npm run dist       # build installer → dist/Postvak-Setup-x.y.z.exe
npm run release    # build + publish to GitHub Releases (needs GH_TOKEN)
```

## Publishing an update
1. Raise `version` in `package.json` (e.g. 0.2.0 → 0.2.1).
2. `set GH_TOKEN=<your GitHub token>` then `npm run release`
   – or upload `Postvak-Setup-x.y.z.exe`, `.blockmap` and `latest.yml` from `dist/`
   by hand to a new GitHub Release (tag `vx.y.z`) in `mikeey77/Assistant22`.
3. Installed copies download it automatically and install it on the next restart.
   Settings are kept (`%APPDATA%\Postvak`).

## Structure
```
src/main.js                Electron: tray, window, IPC, autostart, updates
src/engine.js              Core: check loop, actions, safe mode, snooze, VIP, commands
src/i18n.js                All texts (en/nl)
src/config.js              Settings (secrets encrypted with Windows DPAPI)
src/services/mail.js       IMAP read, SMTP send
src/services/autodetect.js Find IMAP/SMTP settings from an email address
src/services/google.js     Google Calendar (OAuth loopback + PKCE)
src/services/telegram.js   Telegram Bot API (long polling)
src/services/whatsapp.js   WhatsApp via Baileys (QR link)
src/services/claude.js     Calls `claude -p`
src/ui/                    Setup wizard, dashboard, settings
```

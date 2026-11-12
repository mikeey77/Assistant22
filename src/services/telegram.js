// Kleine Telegram Bot API client met long polling (geen extra packages).
class Telegram {
  constructor(token) {
    this.token = token;
    this.offset = 0;
    this.running = false;
  }

  async call(method, params = {}) {
    const r = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const j = await r.json();
    if (!j.ok) throw new Error('Telegram: ' + (j.description || r.status));
    return j.result;
  }

  getMe() { return this.call('getMe'); }

  send(chatId, text, buttons, { silent = false, forceReply } = {}) {
    const params = { chat_id: chatId, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true, disable_notification: !!silent };
    if (buttons) params.reply_markup = { inline_keyboard: buttons };
    else if (forceReply) params.reply_markup = { force_reply: true, input_field_placeholder: String(forceReply).slice(0, 64) };
    return this.call('sendMessage', params);
  }

  edit(chatId, messageId, text, buttons) {
    const params = { chat_id: chatId, message_id: messageId, text: text.slice(0, 4000), parse_mode: 'HTML' };
    if (buttons) params.reply_markup = { inline_keyboard: buttons };
    return this.call('editMessageText', params)
      .catch(() => {});
  }

  answerCallback(id, text) {
    return this.call('answerCallbackQuery', { callback_query_id: id, text }).catch(() => {});
  }

  // Blijft updates ophalen tot stop() wordt aangeroepen.
  async poll(onUpdate) {
    this.running = true;
    while (this.running) {
      try {
        const updates = await this.call('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        for (const u of updates) {
          this.offset = u.update_id + 1;
          try { await onUpdate(u); } catch (e) { console.error('update fout', e); }
        }
      } catch (e) {
        if (!this.running) break;
        await new Promise((r) => setTimeout(r, 5000)); // netwerk weg? even wachten
      }
    }
  }

  stop() { this.running = false; }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { Telegram, esc };

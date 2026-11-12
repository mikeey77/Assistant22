// Website-watcher: meldt wanneer een pagina verandert (prijs, voorraad, nieuws).
const { htmlToText, hash, get, lines } = require('./util');

module.exports = {
  id: 'watcher',
  icon: '👀',
  name: 'Website watcher',
  description: {
    en: 'Watches web pages and tells you when something you care about changes (price, stock, news).',
    nl: 'Houdt webpagina\'s in de gaten en meldt wanneer er iets verandert dat jij belangrijk vindt (prijs, voorraad, nieuws).',
  },
  settings: [
    { key: 'urls', type: 'textarea', label: { en: 'One per line: URL | what to watch for', nl: 'Eén per regel: URL | waar op letten' }, placeholder: 'https://shop.nl/product | price below €200' },
  ],
  hint: () => 'WATCHER: Website-watcher items show how a page changed. Only notify if the change matters for what the user wants to watch for (given in the item). Summarize the change in one sentence.',

  async collect(ctx) {
    const items = [];
    ctx.state.pages = ctx.state.pages || {};
    for (const line of lines(ctx.cfg.urls).slice(0, 15)) {
      const [url, watch = ''] = line.split('|').map((x) => x.trim());
      if (!/^https?:\/\//.test(url)) continue;
      try {
        const text = htmlToText(await (await get(url)).text()).slice(0, 20000);
        const h = hash(text);
        const prev = ctx.state.pages[url];
        ctx.state.pages[url] = { h, excerpt: text.slice(0, 3000), t: Date.now() };
        if (prev && prev.h !== h) {
          items.push({
            id: 'wa' + hash(url + h).slice(0, 8),
            from: new URL(url).host,
            subject: `Page changed: ${url}`,
            link: url,
            date: new Date().toISOString(),
            body: `WATCH FOR: ${watch || 'any meaningful change'}\n\nBEFORE (excerpt):\n${prev.excerpt.slice(0, 1500)}\n\nNOW (excerpt):\n${text.slice(0, 1500)}`,
          });
        }
      } catch (e) { ctx.log(`Watcher ${url}: ${e.message}`); }
    }
    return items;
  },
};

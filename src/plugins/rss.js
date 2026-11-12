// RSS/nieuws: nieuwe artikelen of vacatures uit feeds, gefilterd op zoekwoorden.
const { htmlToText, get, lines, hash } = require('./util');

function parseFeed(xml) {
  const out = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const tag = (n) => { const m = b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, 'i')); return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : ''; };
    const linkAttr = (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1];
    out.push({
      title: htmlToText(tag('title')),
      link: linkAttr || htmlToText(tag('link')),
      id: tag('guid') || tag('id') || linkAttr || tag('link') || tag('title'),
      text: htmlToText(tag('description') || tag('summary') || tag('content')).slice(0, 1500),
      date: tag('pubDate') || tag('updated') || tag('published'),
    });
  }
  return out;
}

module.exports = {
  id: 'rss',
  icon: '📰',
  name: 'RSS / News',
  description: {
    en: 'Follows RSS feeds (news, blogs, job boards) and tells you about new items that match your keywords.',
    nl: 'Volgt RSS-feeds (nieuws, blogs, vacaturesites) en meldt nieuwe items die bij je zoekwoorden passen.',
  },
  settings: [
    { key: 'feeds', type: 'textarea', label: { en: 'Feed URLs (one per line)', nl: 'Feed-URL\'s (één per regel)' }, placeholder: 'https://news.ycombinator.com/rss' },
    { key: 'keywords', type: 'text', label: { en: 'Keywords (comma separated, empty = everything)', nl: 'Zoekwoorden (komma\'s, leeg = alles)' } },
  ],
  hint: () => 'RSS: RSS items are new articles from feeds the user follows. Notify only when it is clearly interesting given the user rules; summary in one sentence.',
  parseFeed,

  async collect(ctx) {
    const kws = String(ctx.cfg.keywords || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
    const seen = new Set(ctx.state.seen || []);
    const first = !ctx.state.seen;
    const items = [];
    for (const url of lines(ctx.cfg.feeds).slice(0, 15)) {
      try {
        for (const it of parseFeed(await (await get(url)).text()).slice(0, 30)) {
          const key = hash(url + it.id);
          if (seen.has(key)) continue;
          seen.add(key);
          if (first) continue;
          const hay = (it.title + ' ' + it.text).toLowerCase();
          if (kws.length && !kws.some((k) => hay.includes(k))) continue;
          items.push({ id: 'rs' + key.slice(0, 8), from: new URL(url).host, subject: it.title, link: it.link, date: it.date ? new Date(it.date).toISOString() : new Date().toISOString(), body: it.text });
        }
      } catch (e) { ctx.log(`RSS ${url}: ${e.message}`); }
    }
    ctx.state.seen = [...seen].slice(-1000);
    return items.slice(0, 10);
  },
};

// GitHub: meldingen over je repo's (issues, pull requests, releases, mentions).
module.exports = {
  id: 'github',
  icon: '🐙',
  name: 'GitHub',
  description: {
    en: 'Brings your GitHub notifications (issues, pull requests, mentions) into Assistant22.',
    nl: 'Haalt je GitHub-meldingen (issues, pull requests, mentions) naar Assistant22.',
  },
  settings: [
    { key: 'token', type: 'password', secret: true, label: { en: 'Personal access token (notifications scope)', nl: 'Personal access token (scope notifications)' }, help: 'https://github.com/settings/tokens' },
  ],
  hint: () => 'GITHUB: GitHub items are notifications. Notify for mentions, review requests, failing builds and new issues on the user\'s repos; summarize in one sentence.',

  async collect(ctx) {
    if (!ctx.cfg.token) return [];
    const since = ctx.state.since || new Date(Date.now() - 3600 * 1000).toISOString();
    const r = await fetch(`https://api.github.com/notifications?since=${encodeURIComponent(since)}`, {
      headers: { Authorization: 'Bearer ' + ctx.cfg.token, Accept: 'application/vnd.github+json', 'User-Agent': 'Assistant22' },
    });
    if (!r.ok) throw new Error('GitHub: HTTP ' + r.status);
    const list = await r.json();
    const first = !ctx.state.since;
    ctx.state.since = new Date().toISOString();
    if (first) return [];
    return list.slice(0, 10).map((n) => ({
      id: 'gh' + n.id,
      from: n.repository.full_name,
      subject: `${n.subject.type}: ${n.subject.title}`,
      date: n.updated_at,
      link: n.subject.url ? n.subject.url.replace('api.github.com/repos', 'github.com').replace('/pulls/', '/pull/') : n.repository.html_url,
      body: `Reason: ${n.reason}`,
    }));
  },
};

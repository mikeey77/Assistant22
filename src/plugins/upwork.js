// Upwork: vacatures zoeken (officiële API, optioneel) en Upwork-mails herkennen.
// Let op: de Upwork API kan geen voorstellen versturen. Assistant22 schrijft het
// voorstel; na je akkoord krijg je de tekst + link om het zelf te plakken.
const { firstUrl } = require('./util');

const QUERY = `query search($filter: MarketplaceJobPostingsSearchFilter, $sort: [MarketplaceJobPostingSearchSortAttribute]) {
  marketplaceJobPostingsSearch(marketPlaceJobFilter: $filter, searchType: USER_JOBS_SEARCH, sortAttributes: $sort) {
    edges { node { id title description createdDateTime ciphertext
      amount { rawValue currency } hourlyBudgetMin { rawValue } hourlyBudgetMax { rawValue }
      client { totalHires totalFeedback location { country } } } }
  }
}`;

module.exports = {
  id: 'upwork',
  icon: '💼',
  name: 'Upwork',
  description: {
    en: 'Scouts Upwork jobs that fit your profile and drafts proposals. Also handles Upwork emails (messages, invites). The Upwork API can\'t send proposals: after ✅ you get the text + a link to paste it.',
    nl: 'Zoekt Upwork-vacatures die bij je profiel passen en schrijft voorstellen. Herkent ook Upwork-mails (berichten, uitnodigingen). De Upwork API kan geen voorstellen versturen: na ✅ krijg je de tekst + link om te plakken.',
  },
  settings: [
    { key: 'profile', type: 'textarea', label: { en: 'Your profile (skills, experience, rate) – used for proposals', nl: 'Je profiel (skills, ervaring, tarief) – voor voorstellen' } },
    { key: 'keywords', type: 'text', label: { en: 'Search keywords', nl: 'Zoekwoorden' }, placeholder: 'electron, automation, home assistant' },
    { key: 'minBudget', type: 'number', label: { en: 'Minimum budget ($, fixed price)', nl: 'Minimumbudget ($, vaste prijs)' } },
    { key: 'token', type: 'password', secret: true, label: { en: 'Upwork API access token (optional, beta)', nl: 'Upwork API access token (optioneel, beta)' }, help: 'https://www.upwork.com/developer/keys/apply' },
  ],
  claimsMail: (m) => /upwork\.com/i.test(m.fromAddress || m.from || ''),
  hint: (cfg) => `UPWORK: For Upwork jobs and Upwork emails: if a job fits the user's profile${cfg.minBudget ? ` and pays at least $${cfg.minBudget}` : ''}, set notify true and add a {"type":"draft_response","platform":"Upwork","body":"<proposal>"} action. Proposals: short (max 150 words), first sentence about the client's problem, concrete approach, one relevant experience, a question at the end. No generic fluff. For Upwork client messages draft a reply the same way. Ignore jobs that don't fit.
USER PROFILE: ${cfg.profile || '(not filled in)'}`,
  linkFor: (item) => item.link || firstUrl(item.body, 'upwork.com') || 'https://www.upwork.com/nx/find-work/',

  async collect(ctx) {
    const cfg = ctx.cfg;
    if (!cfg.token || !cfg.keywords) return [];
    const r = await fetch('https://api.upwork.com/graphql', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { filter: { searchExpression_eq: cfg.keywords, pagination_eq: { after: '0', first: 20 } }, sort: [{ field: 'RECENCY' }] } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.errors) throw new Error('Upwork API: ' + ((j.errors && j.errors[0] && j.errors[0].message) || r.status));
    const seen = new Set(ctx.state.seen || []);
    const first = !ctx.state.seen;
    const items = [];
    for (const { node: n } of (j.data && j.data.marketplaceJobPostingsSearch && j.data.marketplaceJobPostingsSearch.edges) || []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      if (first) continue; // eerste keer: alleen onthouden
      const fixed = n.amount && Number(n.amount.rawValue);
      if (cfg.minBudget && fixed && fixed < Number(cfg.minBudget)) continue;
      const budget = fixed ? `$${fixed} fixed` : n.hourlyBudgetMin ? `$${n.hourlyBudgetMin.rawValue}-${n.hourlyBudgetMax && n.hourlyBudgetMax.rawValue}/hr` : 'unknown';
      items.push({
        id: 'up' + n.id.slice(-8),
        from: 'Upwork job',
        subject: n.title,
        date: n.createdDateTime,
        link: n.ciphertext ? `https://www.upwork.com/jobs/${n.ciphertext}` : '',
        body: `Budget: ${budget}\nClient: ${n.client ? `${n.client.totalHires} hires, ${n.client.totalFeedback} rating, ${n.client.location && n.client.location.country}` : '?'}\n\n${String(n.description || '').slice(0, 2500)}`,
      });
    }
    ctx.state.seen = [...seen].slice(-500);
    return items.slice(0, 8);
  },
};

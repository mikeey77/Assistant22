// Fiverr: geen publieke API, dus werkt via Fiverr-mails (berichten, Briefs, orders).
const { firstUrl } = require('./util');

module.exports = {
  id: 'fiverr',
  icon: '🟢',
  name: 'Fiverr',
  description: {
    en: 'Reads Fiverr emails (buyer messages, Briefs, orders) and drafts replies and pitches. Fiverr has no public API: after ✅ you get the text + a link to paste it.',
    nl: 'Leest Fiverr-mails (berichten van kopers, Briefs, orders) en schrijft antwoorden en pitches. Fiverr heeft geen publieke API: na ✅ krijg je de tekst + link om te plakken.',
  },
  settings: [
    { key: 'profile', type: 'textarea', label: { en: 'Your gigs / what you offer – used for pitches', nl: 'Je gigs / wat je aanbiedt – voor pitches' } },
  ],
  claimsMail: (m) => /fiverr\.com/i.test(m.fromAddress || m.from || ''),
  hint: (cfg) => `FIVERR: For Fiverr emails: new buyer messages and Briefs that fit the user's offer → notify true and add {"type":"draft_response","platform":"Fiverr","body":"<reply or pitch>"}. Pitches: friendly, max 120 words, mention the buyer's need, what you'll deliver and a timeline. Orders/payments → notify, no draft. Marketing emails from Fiverr → ignore.
USER OFFER: ${cfg.profile || '(not filled in)'}`,
  linkFor: (item) => firstUrl(item.body, 'fiverr.com') || 'https://www.fiverr.com/inbox',
};

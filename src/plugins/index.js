// Alle plugins. Een plugin staat standaard uit en kan in de app of via Telegram aan.
const list = [require('./upwork'), require('./fiverr'), require('./watcher'), require('./rss'), require('./weather'), require('./github')];
const byId = Object.fromEntries(list.map((p) => [p.id, p]));

// Wat de UI nodig heeft (zonder functies)
function catalog() {
  return list.map((p) => ({ id: p.id, icon: p.icon, name: p.name, description: p.description, settings: p.settings || [] }));
}

module.exports = { list, byId, catalog };

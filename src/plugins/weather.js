// Weer in je ochtendoverzicht (Open-Meteo, gratis en zonder sleutel).
const { get } = require('./util');

const CODES = { 0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️', 51: '🌦️', 53: '🌦️', 55: '🌧️', 61: '🌦️', 63: '🌧️', 65: '🌧️', 71: '🌨️', 73: '🌨️', 75: '❄️', 80: '🌦️', 81: '🌧️', 82: '⛈️', 95: '⛈️', 96: '⛈️', 99: '⛈️' };

module.exports = {
  id: 'weather',
  icon: '🌦️',
  name: 'Weather',
  description: {
    en: 'Adds today\'s weather to your morning overview, with a rain warning. Free, no key needed.',
    nl: 'Zet het weer van vandaag in je ochtendoverzicht, met regenwaarschuwing. Gratis, geen sleutel nodig.',
  },
  settings: [
    { key: 'city', type: 'text', label: { en: 'City', nl: 'Plaats' }, placeholder: 'Amsterdam' },
  ],

  async dailyBrief(ctx) {
    if (!ctx.cfg.city) return '';
    const geo = await (await get(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(ctx.cfg.city)}`)).json();
    const loc = geo.results && geo.results[0];
    if (!loc) return '';
    const f = await (await get(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max&timezone=auto&forecast_days=1`)).json();
    const d = f.daily;
    const nl = ctx.lang === 'nl';
    const rain = d.precipitation_probability_max[0];
    return `${CODES[d.weathercode[0]] || '🌡️'} <b>${loc.name}</b>: ${Math.round(d.temperature_2m_min[0])}–${Math.round(d.temperature_2m_max[0])}°C, ${nl ? 'kans op regen' : 'chance of rain'} ${rain}%, ${nl ? 'wind' : 'wind'} ${Math.round(d.windspeed_10m_max[0])} km/h${rain >= 60 ? (nl ? ' ☔ neem een paraplu mee!' : ' ☔ take an umbrella!') : ''}`;
  },
};

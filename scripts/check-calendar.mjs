import '../js/market-calendar.js';

// Check 90 days ahead so the maintainer has time to publish next year's dates.
const horizon = new Date(Date.now() + 90 * 86400000).getUTCFullYear();
for (const region of ['TW', 'US']) {
  if (!MARKET_HOLIDAYS[region].some(day => day.startsWith(`${horizon}-`))) {
    throw new Error(`${region}: publish and verify the official ${horizon} exchange calendar, including early closes, in js/market-calendar.js`);
  }
}
console.log(`Exchange calendars cover the next 90 days (through year ${horizon}).`);

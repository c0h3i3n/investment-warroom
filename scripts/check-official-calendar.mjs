import fs from 'node:fs/promises';
import { refreshOfficialCalendar } from '../worker/src/official-calendar.mjs';

const file = new URL('../data/calendar.json', import.meta.url);
const previous = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null);
const result = await refreshOfficialCalendar(previous, Date.now(), false);
await fs.writeFile(file, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({date:result.date,checks:result.checks,closures:result.closures}));
if (!result.checks.notices.ok || !result.checks.futures.ok) {
  console.warn('One or more official checks failed; preserved previous confirmed closures.');
}

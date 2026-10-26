import '../js/market-calendar.js';
import fs from 'node:fs/promises';
import {validAnnualSnapshot,SOURCES} from '../worker/src/official-calendar.mjs';

// Check 90 days ahead so the maintainer has time to publish next year's dates.
const horizon = new Date(Date.now() + 90 * 86400000).getUTCFullYear();
const current=new Date().getUTCFullYear();
const snapshot=await fs.readFile(new URL('../data/calendar.json',import.meta.url),'utf8').then(JSON.parse).catch(()=>null);
const published={...snapshot?.annuals};
if(snapshot?.annual?.year) published[snapshot.annual.year]=snapshot.annual;
for (const region of ['TW', 'US']) {
  const staticCoverage=MARKET_HOLIDAYS[region].some(day=>day.startsWith(`${horizon}-`));
  const dynamicCoverage=region==='TW'&&validAnnualSnapshot(published[horizon],horizon);
  if (!staticCoverage&&!dynamicCoverage) {
    const preload=snapshot?.preload;
    const currentCovered=MARKET_HOLIDAYS[region].some(day=>day.startsWith(`${current}-`))
      || (region==='TW'&&validAnnualSnapshot(published[current],current));
    if(region==='TW'&&horizon===current+1&&currentCovered&&preload?.year===horizon
      &&preload.status==='pending-publication'&&preload.source===SOURCES.annual
      &&Date.now()>=preload.attemptedAt&&Date.now()-preload.attemptedAt<3*86400000) {
      console.log(`::warning::TW ${horizon} calendar is not yet returned by the official source. Daily preload will retry; no dates have been inferred.`);
      continue;
    }
    throw new Error(`${region}: publish and verify the official ${horizon} exchange calendar, including early closes, in js/market-calendar.js`);
  }
}
console.log(`Exchange calendar coverage/preload checks completed (through year ${horizon}).`);

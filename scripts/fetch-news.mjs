import fs from 'node:fs/promises';
import { getNewsSnapshot } from '../worker/src/news.mjs';
const file=new URL('../data/news.json',import.meta.url);
const previous=await fs.readFile(file,'utf8').then(JSON.parse).catch(()=>null);
const env={MARKET_CACHE:{get:async()=>previous,put:async()=>{}}};
const result=await getNewsSnapshot(env,true);
if (result.data.length) await fs.writeFile(file,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({count:result.data.length,generatedAt:result.generatedAt,failedSources:result.failedSources}));

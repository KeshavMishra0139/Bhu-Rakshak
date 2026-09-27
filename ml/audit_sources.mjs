// Spot-audit of the landslide inventory: open a random sample of source links and check that the page still
// exists and talks about a landslide (and, where possible, the place). Output: ml/data/source_audit.json
//   node ml/audit_sources.mjs [sampleSize]
import fs from 'node:fs';
import path from 'node:path';
import { DATA, parseCsv, rng, mapLimit } from './lib.mjs';

const N = Number(process.argv[2] || 25);
const inv = parseCsv(fs.readFileSync(path.join(DATA, 'inventory.csv'), 'utf8')).filter((e) => /^https?:\/\//.test(e.source));
const r = rng(99);
const pick = [...inv].sort(() => 0).map((e) => [r(), e]).sort((a, b) => a[0] - b[0]).slice(0, N).map(([, e]) => e);

const results = await mapLimit(pick, 4, async (e) => {
  const out = { event_id: e.event_id, date: e.date, place: e.place, source: e.source };
  try {
    const res = await fetch(e.source, { headers: { 'User-Agent': 'Mozilla/5.0 (research audit; Bhu-Rakshak)' }, signal: AbortSignal.timeout(25000), redirect: 'follow' });
    out.http = res.status;
    const text = (await res.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').toLowerCase();
    out.mentions_landslide = /landslide|land slide|landslip|mudslide|mud slide|slide/.test(text);
    const placeWord = (e.place || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4 && !['india', 'bengal', 'district', 'national', 'highway', 'north', 'south', 'east', 'west', 'between', 'road'].includes(w));
    out.mentions_place = placeWord.length ? placeWord.some((w) => text.includes(w)) : null;
  } catch (err) {
    out.http = null;
    out.error = err.cause?.code || err.name;
  }
  return out;
});

const live = results.filter((x) => x.http === 200);
const summary = {
  checked: results.length,
  page_still_online: live.length,
  online_and_mentions_landslide: live.filter((x) => x.mentions_landslide).length,
  online_and_mentions_place: live.filter((x) => x.mentions_place).length,
  dead_or_unreachable: results.length - live.length,
};
fs.writeFileSync(path.join(DATA, 'source_audit.json'), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
for (const x of results) console.log(`${x.http ?? x.error}\t${x.mentions_landslide ?? '-'}\t${x.mentions_place ?? '-'}\t${x.date} ${x.place.slice(0, 40)}`);

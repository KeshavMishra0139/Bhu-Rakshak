// One command to fold newly confirmed landslides into the model — safely.
//   node ml/retrain.mjs                 build a CANDIDATE model and compare it with the live one (nothing changes live)
//   node ml/retrain.mjs --promote       make the candidate live (only if it is not worse; the server reloads it)
//   node ml/retrain.mjs --promote --force   promote even if the backtest is slightly worse (you decide why)
//
// Steps: export the website's confirmed-landslide record (server DB, retracted records excluded) →
// build_inventory → build_dataset → build_controls → build_extra → clean → experiments (bias checks, factor choice)
// → train_live --candidate. Downloads are cached, so only new landslides cost time.
// Env: DB_PATH (default server/var/bhu-rakshak.db).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { DATA, ML_ROOT, writeCsv } from './lib.mjs';

const REPO = path.resolve(ML_ROOT, '..');
const MODELS = path.join(ML_ROOT, 'models');
const LIVE = path.join(MODELS, 'landslide-live.json');
const CAND = path.join(MODELS, 'landslide-live-candidate.json');
const promote = process.argv.includes('--promote');
const force = process.argv.includes('--force');
const MAX_DROP = 0.01; // a candidate may not be worse than the live model's backtest AUC by more than this

function promoteCandidate() {
  if (!fs.existsSync(CAND)) { console.error('No candidate — run `node ml/retrain.mjs` first.'); process.exit(1); }
  const live = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
  const cand = JSON.parse(fs.readFileSync(CAND, 'utf8'));
  const drop = live.evaluation.auc - cand.evaluation.auc;
  if (drop > MAX_DROP && !force) {
    console.error(`Not promoted: candidate backtest AUC ${cand.evaluation.auc} vs live ${live.evaluation.auc}. Use --force to override.`);
    process.exit(1);
  }
  const archive = path.join(MODELS, 'archive');
  fs.mkdirSync(archive, { recursive: true });
  fs.copyFileSync(LIVE, path.join(archive, `landslide-${live.version}.json`));
  fs.copyFileSync(CAND, LIVE);
  fs.copyFileSync(path.join(MODELS, 'live_model_candidate.md'), path.join(MODELS, 'live_model.md'));
  fs.rmSync(CAND);
  console.log(`Promoted ${cand.version} (backtest AUC ${cand.evaluation.auc}); previous ${live.version} archived in ml/models/archive/. The server picks it up within a few minutes.`);
}

if (promote) { promoteCandidate(); process.exit(0); }

// 1. Export confirmed landslides from the website.
const dbPath = process.env.DB_PATH ? path.resolve(REPO, 'server', process.env.DB_PATH) : path.join(REPO, 'server/var/bhu-rakshak.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'landslide_record'").get();
const records = hasTable ? db.prepare(`SELECT r.id, r.date, r.lat, r.lng, r.accuracy_km, r.source, r.source_id, r.notes, l.name_en AS place, l.district
  FROM landslide_record r LEFT JOIN locations l ON l.id = r.location_id WHERE r.retracted_at IS NULL ORDER BY r.date`).all() : [];
db.close();
const STATE = (district) => (/sikkim/i.test(district || '') ? 'Sikkim' : /darjeeling|kalimpong/i.test(district || '') ? 'West Bengal' : '');
writeCsv(path.join(DATA, 'recorded_events.csv'), records.map((r) => ({
  event_id: `rec-${r.id}`, date: r.date, lat: r.lat, lng: r.lng, accuracy_km: r.accuracy_km, place: r.place || '', state: STATE(r.district),
  trigger: 'unknown', source: `Bhu-Rakshak record (${r.source}${r.source_id ? ' ' + r.source_id : ''})${r.notes ? ': ' + r.notes : ''}`,
})), ['event_id', 'date', 'lat', 'lng', 'accuracy_km', 'place', 'state', 'trigger', 'source']);
console.log(`${records.length} confirmed landslides exported from ${path.relative(REPO, dbPath)}`);

// 2. Rebuild and retrain (cached downloads; only new rows fetch data).
const run = (script, args = []) => {
  console.log(`\n$ node ml/${script} ${args.join(' ')}`);
  execFileSync(process.execPath, [path.join(ML_ROOT, script), ...args], { stdio: 'inherit', cwd: REPO });
};
run('build_inventory.mjs');
run('build_dataset.mjs');
run('build_controls.mjs');
run('build_extra.mjs');
run('clean.mjs');
run('experiments.mjs');
run('train_live.mjs', ['--candidate']);

// 3. Compare.
const live = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
const cand = JSON.parse(fs.readFileSync(CAND, 'utf8'));
const f = (x) => x.evaluation;
console.log(`\n              backtest AUC   when    where   caught  false alarms  training landslides
live      ${live.version.padEnd(6)}  ${f(live).auc.toFixed(3)}        ${f(live).when.toFixed(3)}  ${f(live).where.toFixed(3)}  ${(f(live).caught * 100).toFixed(0)}%     ${(f(live).false_alarms * 100).toFixed(0)}%           ${live.training_data.landslides}
candidate ${cand.version.padEnd(6)}  ${f(cand).auc.toFixed(3)}        ${f(cand).when.toFixed(3)}  ${f(cand).where.toFixed(3)}  ${(f(cand).caught * 100).toFixed(0)}%     ${(f(cand).false_alarms * 100).toFixed(0)}%           ${cand.training_data.landslides}`);
const ok = live.evaluation.auc - cand.evaluation.auc <= MAX_DROP;
console.log(ok
  ? '\nCandidate is not worse. To make it live: node ml/retrain.mjs --promote'
  : `\nCandidate is worse by more than ${MAX_DROP} AUC — keep the live model (or investigate the new records).`);

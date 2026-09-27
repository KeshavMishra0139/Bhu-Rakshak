// Loads the shared config files (/shared/config) that both client and server use.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, SERVER_ROOT } from './env.js';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

export const riskConfig = readJson(path.join(REPO_ROOT, 'shared/config/risk.json'));
export const factorsConfig = readJson(path.join(REPO_ROOT, 'shared/config/factors.json'));

const dataDir = path.join(SERVER_ROOT, 'src/data');
export const seedData = {
  locations: readJson(path.join(dataDir, 'locations.json')),
  staticLayers: readJson(path.join(dataDir, 'static_layers.json')),
  exposure: readJson(path.join(dataDir, 'exposure.json')),
  operations: readJson(path.join(dataDir, 'operations.json')),
  imdDistricts: readJson(path.join(dataDir, 'imd_districts.json')),
  // NER preview places (outside Sikkim/Darjeeling), filled automatically: ml/prepare_ner_preview.mjs
  nerPreview: fs.existsSync(path.join(dataDir, 'ner_preview.json')) ? readJson(path.join(dataDir, 'ner_preview.json')) : null,
};

/** Corridor id of the NER preview places (the client shows a "Preview" badge for it). */
export const PREVIEW_CORRIDOR = 'ner_preview';

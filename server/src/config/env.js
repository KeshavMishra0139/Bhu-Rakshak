// Loads environment from the repo-root .env (then server/.env if present) and exposes typed config.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '../..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

try {
  const dotenv = await import('dotenv');
  for (const p of [path.join(REPO_ROOT, '.env'), path.join(SERVER_ROOT, '.env')]) {
    if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
  }
} catch {
  // dotenv not installed (e.g. running unit tests before npm install) — fall back to process.env.
}

const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret === 'change-me-to-a-long-random-string') {
  jwtSecret = crypto.randomBytes(48).toString('hex');
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[env] JWT_SECRET not set — using a random secret for this run (everyone is logged out on restart).');
  }
}

export const env = {
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  jwtSecret,
  isProd: process.env.NODE_ENV === 'production',
  predictionMode: process.env.PREDICTION_MODE === 'model' ? 'model' : 'live_sim',
  modelUrl: process.env.MODEL_URL || 'http://localhost:8000',
  demoPassword: process.env.DEMO_PASSWORD || 'Demo@2026',
  demoLoginEnabled: bool(process.env.DEMO_LOGIN_ENABLED, true),
  devModeEnabled: bool(process.env.DEV_MODE_ENABLED, false),
  devPassword: process.env.DEV_PASSWORD || '',
  devAccessCode: process.env.DEV_ACCESS_CODE || '',
  bhuvanToken: process.env.BHUVAN_TOKEN || '',
  // Google Maps JavaScript API browser key. Restrict it to your site's HTTP referrers in Google Cloud.
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  googleMapsMapId: process.env.GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID',
  // IMD API (api.imd.gov.in): an API key and a JWT, both issued by the IMD API portal.
  imdBaseUrl: (process.env.IMD_BASE_URL || 'https://api.imd.gov.in/api/v1').replace(/\/$/, ''),
  imdApiKey: process.env.IMD_API_KEY || '',
  imdToken: process.env.IMD_TOKEN || '',
  dbPath: path.resolve(SERVER_ROOT, process.env.DB_PATH || './var/bhu-rakshak.db'),
  disableIngest: bool(process.env.DISABLE_INGEST, false),
};

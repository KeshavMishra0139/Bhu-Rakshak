import { Router } from 'express';
import { q } from '../db/index.js';
import { can } from '../auth/permissions.js';
import { riskRowToPublic } from '../prediction/liveLoop.js';
import { riskConfig, factorsConfig } from '../config/shared.js';
import { ah, HttpError, safeJson } from '../lib/util.js';

const r = Router();
/** Citizens see the top three reasons (the "Why" card); officers see all drivers. */
const CITIZEN_DRIVERS = 3;
// data_source + data_fetched_at let the citizen home say when rain data is old or not live.
const CITIZEN_CONDITION_KEYS = ['rain_intensity', 'rain_24h', 'rain_fc_24h', 'rain_fc_48h', 'data_source', 'data_fetched_at', 'imd'];

/** Trim technical detail for people without risk.details (citizens, guests). */
export function riskForActor(risk, actor) {
  if (!risk) return null;
  if (can(actor, 'risk.details')) return risk;
  const conditions = Object.fromEntries(CITIZEN_CONDITION_KEYS.map((k) => [k, risk.conditions?.[k] ?? null]));
  return { ...risk, drivers: (risk.drivers || []).slice(0, CITIZEN_DRIVERS), conditions };
}

export function snapshot(actor) {
  const rows = q.all(`SELECT l.id, l.name_en, l.name_hi, l.district, l.corridor_id, l.lat, l.lng, l.road, l.field_verified_at,
                             e.exposure_score, r.location_id, r.score, r.level, r.confidence, r.drivers_json, r.trend, r.forecast_json,
                             r.time_to_threshold_json, r.priority, r.conditions_json, r.model_version, r.level_since, r.updated_at
                      FROM locations l
                      LEFT JOIN exposure e ON e.location_id = l.id
                      LEFT JOIN risk_state r ON r.location_id = l.id
                      ORDER BY COALESCE(r.priority, 0) DESC`);
  return rows.map((row) => ({
    id: row.id, name_en: row.name_en, name_hi: row.name_hi, district: row.district, corridor_id: row.corridor_id,
    lat: row.lat, lng: row.lng, road: row.road, field_verified_at: row.field_verified_at, exposure_score: row.exposure_score,
    risk: riskForActor(row.location_id ? { ...riskRowToPublic(row), exposure_score: row.exposure_score } : null, actor),
  }));
}

export const corridors = () => q.all('SELECT id, name_en, name_hi, color FROM corridors ORDER BY id');

r.get('/locations', (req, res) => {
  res.json({ corridors: corridors(), locations: snapshot(req.actor), server_time: new Date().toISOString() });
});

r.get('/locations/:id', ah(async (req, res) => {
  const id = req.params.id;
  const loc = q.one('SELECT * FROM locations WHERE id = :id', { id });
  if (!loc) throw new HttpError(404, 'location_not_found');
  const riskRow = q.one('SELECT * FROM risk_state WHERE location_id = :id', { id });
  const exp = q.one('SELECT * FROM exposure WHERE location_id = :id', { id });
  const risk = riskRow ? { ...riskRowToPublic(riskRow), exposure_score: exp?.exposure_score ?? 0 } : null;
  const roads = q.all('SELECT r.* FROM roads r, json_each(r.path_json) p WHERE p.value = :id', { id })
    .map((x) => ({ ...x, path: safeJson(x.path_json, []), path_json: undefined }));
  const out = { location: loc, risk: riskForActor(risk, req.actor), roads };
  if (can(req.actor, 'risk.details')) {
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const hist = q.all('SELECT score, level, at FROM risk_history WHERE location_id = :id AND at >= :since ORDER BY at', { id, since });
    const step = Math.max(1, Math.ceil(hist.length / 96));
    out.history = hist.filter((_, i) => i % step === 0 || i === hist.length - 1);
    out.static = q.one('SELECT * FROM static_layers WHERE location_id = :id', { id });
    out.exposure = exp && {
      population: exp.population, roads: safeJson(exp.roads_json, []), bridges: safeJson(exp.bridges_json, []),
      facilities: safeJson(exp.facilities_json, []), critical_infra: safeJson(exp.critical_infra_json, []),
      tourist_zone: !!exp.tourist_zone, exposure_score: exp.exposure_score, source: exp.source,
    };
    out.incidents = q.all("SELECT * FROM incidents WHERE location_id = :id AND stage != 'closed' ORDER BY detected_at DESC", { id });
    out.resources = q.all('SELECT * FROM resources WHERE district = :d ORDER BY type, name', { d: loc.district });
  }
  res.json(out);
}));

r.get('/factors', (_req, res) => {
  res.json({ factors: factorsConfig, risk: riskConfig });
});

export default r;

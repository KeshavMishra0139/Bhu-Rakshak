// Seeds the database with locations, susceptibility layers, exposure, roads, resources, SOPs, contacts,
// past incidents and demo accounts. Idempotent: seedIfEmpty() only runs on an empty database.
// CLI: `npm run seed` (seed if empty) · `npm run reset` (delete DB and reseed).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, closeDb, q, tx } from './index.js';
import { env } from '../config/env.js';
import { seedData } from '../config/shared.js';
import { exposureScore } from '../prediction/engine.js';
import { hashPasswordSync } from '../auth/password.js';
import { nowIso, newId } from '../lib/util.js';

export const DEMO_USERS = [
  { email: 'citizen@demo.in', name: 'Pema Lepcha', role: 'citizen', home_location_id: 'mangan', home_village: 'Mangan', language: 'en' },
  { email: 'officer@demo.in', name: 'Officer (SDMA Sikkim)', role: 'authority', sub_role: 'sdma', district: 'All', department: 'Sikkim State Disaster Management Authority', badge_id: 'SDMA-DEMO-01' },
  { email: 'dm.north@demo.in', name: 'District Officer, North Sikkim', role: 'authority', sub_role: 'district_officer', district: 'North Sikkim', department: 'District Administration', badge_id: 'DDMO-N-01' },
  { email: 'police@demo.in', name: 'Police Control, East Sikkim', role: 'authority', sub_role: 'police', district: 'East Sikkim', department: 'Sikkim Police', badge_id: 'SP-E-01' },
  { email: 'bro@demo.in', name: 'Road Authority, North Sikkim', role: 'authority', sub_role: 'bro', district: 'North Sikkim', department: 'Border Roads Organisation', badge_id: 'BRO-N-01' },
  { email: 'rescue@demo.in', name: 'Rescue Team, North Sikkim', role: 'authority', sub_role: 'rescue', district: 'North Sikkim', department: 'SDRF', badge_id: 'SDRF-N-01' },
  { email: 'admin@demo.in', name: 'Platform Admin', role: 'admin' },
  { email: 'pending.officer@demo.in', name: 'Tshering Bhutia', role: 'authority', sub_role: 'district_officer', district: 'West Sikkim', department: 'District Administration', badge_id: 'DDMO-W-07', status: 'pending' },
];

function insertUser(u, password) {
  const now = nowIso();
  q.run(`INSERT INTO users(id, name, email, phone, password_hash, role, sub_role, status, badge_id, department, district,
           home_location_id, home_village, language, theme, created_at, updated_at, approved_at)
         VALUES (:id, :name, :email, NULL, :hash, :role, :sub_role, :status, :badge_id, :department, :district,
           :home, :village, :lang, 'system', :now, :now, :approved)`,
  {
    id: newId('usr'), name: u.name, email: u.email, hash: hashPasswordSync(password), role: u.role,
    sub_role: u.sub_role || null, status: u.status || 'active', badge_id: u.badge_id || null, department: u.department || null,
    district: u.district || null, home: u.home_location_id || null, village: u.home_village || null, lang: u.language || 'en',
    now, approved: u.status === 'pending' ? null : now,
  });
}

export function seedDeveloper() {
  if (!env.devModeEnabled || !env.devPassword) return false;
  const exists = q.one("SELECT id FROM users WHERE email = 'dev@demo.in'");
  if (exists) {
    // Keep the dev password in sync with the env on every boot.
    q.run('UPDATE users SET password_hash = :h, updated_at = :now WHERE id = :id', { h: hashPasswordSync(env.devPassword), now: nowIso(), id: exists.id });
    return true;
  }
  insertUser({ email: 'dev@demo.in', name: 'Developer', role: 'developer' }, env.devPassword);
  return true;
}

function seedGeo() {
  const { locations, staticLayers, exposure } = seedData;
  {
    for (const c of locations.corridors) {
      q.run('INSERT INTO corridors(id, name_en, name_hi, color) VALUES (:id, :en, :hi, :color)', { id: c.id, en: c.name_en, hi: c.name_hi, color: c.color });
    }
    for (const l of locations.locations) {
      q.run(`INSERT INTO locations(id, name_en, name_hi, district, corridor_id, lat, lng, road)
             VALUES (:id, :en, :hi, :district, :corridor, :lat, :lng, :road)`,
      { id: l.id, en: l.name_en, hi: l.name_hi, district: l.district, corridor: l.corridor, lat: l.lat, lng: l.lng, road: l.road });
      const s = staticLayers.layers[l.id];
      q.run(`INSERT INTO static_layers(location_id, slope_deg, aspect_deg, elevation_m, curvature, lithology_class, fault_distance_km, ndvi,
               land_cover, dist_road_m, dist_river_m, river, road_cutting, landslide_history_count, last_event_date, source)
             VALUES (:id, :slope, :aspect, :elev, :curv, :lith, :fault, :ndvi, :lc, :droad, :driver, :river, :cut, :hist, :last, 'static_seed')`,
      {
        id: l.id, slope: s.slope_deg, aspect: s.aspect_deg, elev: s.elevation_m, curv: s.curvature, lith: s.lithology_class,
        fault: s.fault_distance_km, ndvi: s.ndvi, lc: s.land_cover, droad: s.dist_road_m, driver: s.dist_river_m, river: s.river,
        cut: s.road_cutting, hist: s.landslide_history_count, last: s.last_event_date,
      });
      const e = exposure.exposure[l.id];
      q.run(`INSERT INTO exposure(location_id, population, roads_json, bridges_json, facilities_json, critical_infra_json, tourist_zone, exposure_score, source)
             VALUES (:id, :pop, :roads, :bridges, :fac, :infra, :tz, :score, 'static_seed')`,
      {
        id: l.id, pop: e.population, roads: JSON.stringify(e.roads), bridges: JSON.stringify(e.bridges), fac: JSON.stringify(e.facilities),
        infra: JSON.stringify(e.critical_infra), tz: e.tourist_zone, score: exposureScore(e),
      });
    }
  }
}

/** Roads, resources, SOPs, contacts and example incidents. Also used by the dev "Reset demo data" action. */
export function seedOperations() {
  const { operations } = seedData;
  const now = nowIso();
  {
    for (const r of operations.roads) {
      q.run(`INSERT INTO roads(id, name_en, name_hi, corridor_id, path_json, status, eta_clear_hours, diversion_en, diversion_hi,
               tourist_advisory, heavy_vehicle_advisory, updated_by, updated_at)
             VALUES (:id, :en, :hi, :corridor, :path, :status, :eta, :den, :dhi, :ta, :hva, 'seed', :now)`,
      {
        id: r.id, en: r.name_en, hi: r.name_hi, corridor: r.corridor, path: JSON.stringify(r.path), status: r.status,
        eta: r.eta_clear_hours, den: r.diversion_en, dhi: r.diversion_hi, ta: r.tourist_advisory, hva: r.heavy_vehicle_advisory, now,
      });
    }
    for (const r of operations.resources) {
      q.run(`INSERT INTO resources(id, type, name, location_id, district, status, capacity, occupancy, updated_at)
             VALUES (:id, :type, :name, :loc, :district, :status, :cap, 0, :now)`,
      { id: r.id, type: r.type, name: r.name, loc: r.location_id, district: r.district, status: r.status, cap: r.capacity, now });
    }
    for (const [level, items] of Object.entries(operations.sops)) {
      items.forEach((s, ord) => q.run('INSERT INTO sops(level, key, text_en, text_hi, roles, ord) VALUES (:level, :key, :en, :hi, :roles, :ord)',
        { level, key: s.key, en: s.en, hi: s.hi, roles: JSON.stringify(s.roles), ord }));
    }
    for (const s of operations.stakeholders) {
      q.run('INSERT INTO stakeholders(role, district, name, phone) VALUES (:role, :district, :name, :phone)', s);
    }
    const hoursAgo = (h) => (h == null ? null : new Date(Date.now() - h * 3600000).toISOString());
    for (const inc of operations.incidents) {
      q.run(`INSERT INTO incidents(id, location_id, title, stage, level, source, notes, detected_at, resolved_at, closed_at, updated_at)
             VALUES (:id, :loc, :title, :stage, :level, 'system', :notes, :det, :closed, :closed, :now)`,
      { id: inc.id, loc: inc.location_id, title: inc.title, stage: inc.stage, level: inc.level, notes: inc.notes,
        det: hoursAgo(inc.hours_ago_detected), closed: hoursAgo(inc.hours_ago_closed), now });
      q.run('INSERT INTO incident_events(incident_id, from_stage, to_stage, note, actor, at) VALUES (:id, NULL, :stage, :note, :actor, :at)',
        { id: inc.id, stage: inc.stage, note: 'Seeded example incident', actor: 'seed', at: hoursAgo(inc.hours_ago_detected) });
    }
  }
}

function seedFeeds() {
  const now = nowIso();
  {
    for (const [feed, status, message] of [
      ['open_meteo', 'degraded', 'Waiting for first fetch'],
      ['prediction', 'ok', `Provider: ${env.predictionMode}`],
      ['seismic', 'degraded', 'Waiting for first earthquake fetch (NCS / USGS)'],
      ['sensors', 'not_connected', 'Ground sensors (rain gauge, piezometer, tilt) — not connected'],
    ]) {
      q.run('INSERT INTO feed_status(feed, status, last_attempt, message) VALUES (:feed, :status, :now, :message)', { feed, status, now, message });
    }
  }
}

export function seedAll() {
  tx(() => {
    seedGeo();
    seedOperations();
    seedFeeds();
    for (const u of DEMO_USERS) insertUser(u, env.demoPassword);
  });
  seedDeveloper();
}

/** Dev "Reset demo data": clears everything that happened during the demo and restores seed operations. Users are kept. */
export function resetDemoData() {
  tx(() => {
    for (const t of ['inbox_reads', 'alert_deliveries', 'alert_acks', 'alerts', 'inbox_messages', 'incident_resources',
      'incident_sop_ticks', 'incident_events', 'incidents', 'reports', 'risk_history', 'risk_state', 'roads', 'resources',
      'sops', 'stakeholders', 'audit_log']) {
      q.exec(`DELETE FROM ${t}`);
    }
    q.exec('UPDATE locations SET field_verified_at = NULL');
    seedOperations();
  });
}

/**
 * NER preview places (server/src/data/ner_preview.json): inserted into any database that doesn't have them yet —
 * a new one or the running site's — without touching existing rows. Their terrain/exposure rows are marked
 * source = 'auto_preview' so they are never mistaken for the hand-checked Sikkim/Darjeeling data.
 */
export function syncPreviewPlaces() {
  const np = seedData.nerPreview;
  if (!np) return 0;
  let added = 0;
  tx(() => {
    q.run('INSERT OR IGNORE INTO corridors(id, name_en, name_hi, color) VALUES (:id, :en, :hi, :color)', { id: np.corridor.id, en: np.corridor.name_en, hi: np.corridor.name_hi, color: np.corridor.color });
    for (const { location: l, static: st, exposure: e } of np.places) {
      if (q.one('SELECT id FROM locations WHERE id = :id', { id: l.id })) continue;
      q.run(`INSERT INTO locations(id, name_en, name_hi, district, corridor_id, lat, lng, road)
             VALUES (:id, :en, :hi, :district, :corridor, :lat, :lng, :road)`,
      { id: l.id, en: l.name_en, hi: l.name_hi, district: l.district, corridor: l.corridor, lat: l.lat, lng: l.lng, road: l.road });
      q.run(`INSERT INTO static_layers(location_id, slope_deg, aspect_deg, elevation_m, curvature, lithology_class, fault_distance_km, ndvi,
               land_cover, dist_road_m, dist_river_m, river, road_cutting, landslide_history_count, last_event_date, source)
             VALUES (:id, :slope, :aspect, :elev, :curv, :lith, :fault, :ndvi, :lc, :droad, :driver, :river, :cut, :hist, :last, 'auto_preview')`,
      { id: l.id, slope: st.slope_deg, aspect: st.aspect_deg, elev: st.elevation_m, curv: st.curvature, lith: st.lithology_class, fault: st.fault_distance_km,
        ndvi: st.ndvi, lc: st.land_cover, droad: st.dist_road_m, driver: st.dist_river_m, river: st.river, cut: st.road_cutting, hist: st.landslide_history_count, last: st.last_event_date });
      q.run(`INSERT INTO exposure(location_id, population, roads_json, bridges_json, facilities_json, critical_infra_json, tourist_zone, exposure_score, source)
             VALUES (:id, :pop, :roads, :bridges, :fac, :infra, :tz, :score, 'auto_preview')`,
      { id: l.id, pop: e.population, roads: JSON.stringify(e.roads), bridges: JSON.stringify(e.bridges), fac: JSON.stringify(e.facilities),
        infra: JSON.stringify(e.critical_infra), tz: e.tourist_zone, score: exposureScore({ ...e, population: e.population || 0 }) });
      added++;
    }
  });
  return added;
}

export function seedIfEmpty() {
  openDb();
  const n = q.one('SELECT COUNT(*) AS n FROM locations').n;
  if (n === 0) { seedAll(); syncPreviewPlaces(); return true; }
  seedDeveloper();
  const added = syncPreviewPlaces();
  if (added && process.env.NODE_ENV !== 'test') console.log(`[db] added ${added} NER preview places`);
  return false;
}

// CLI entry
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--reset')) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(env.dbPath + suffix, { force: true });
    console.log(`[seed] removed ${env.dbPath}`);
  }
  const seeded = seedIfEmpty();
  console.log(seeded ? '[seed] database seeded' : '[seed] database already had data (use `npm run reset` to start over)');
  closeDb();
}

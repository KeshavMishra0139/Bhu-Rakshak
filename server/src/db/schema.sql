-- Bhu-Rakshak schema. All timestamps are ISO-8601 UTC strings; the UI renders them in IST.
PRAGMA foreign_keys = ON;

-- ---------- People & access ----------
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT UNIQUE,
  phone           TEXT UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('citizen','authority','admin','developer')),
  sub_role        TEXT CHECK (sub_role IN ('district_officer','police','bro','rescue','sdma')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','rejected')),
  badge_id        TEXT,
  department      TEXT,
  district        TEXT,
  home_location_id TEXT REFERENCES locations(id),
  home_village    TEXT,
  id_document_path TEXT,
  language        TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','hi','ne','as','kha','lus','nag')),
  theme           TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  text_size       TEXT NOT NULL DEFAULT 'normal' CHECK (text_size IN ('normal','large')),
  prefs_json      TEXT NOT NULL DEFAULT '{}',
  rejection_reason TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- ---------- Geography ----------
CREATE TABLE IF NOT EXISTS corridors (
  id      TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_hi TEXT NOT NULL,
  color   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id          TEXT PRIMARY KEY,
  name_en     TEXT NOT NULL,
  name_hi     TEXT NOT NULL,
  district    TEXT NOT NULL,
  corridor_id TEXT NOT NULL REFERENCES corridors(id),
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  road        TEXT,
  field_verified_at TEXT
);

-- Section 0B: susceptibility (static per location)
CREATE TABLE IF NOT EXISTS static_layers (
  location_id             TEXT PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  slope_deg               REAL,
  aspect_deg              REAL,
  elevation_m             REAL,
  curvature               REAL,
  lithology_class         TEXT,
  fault_distance_km       REAL,
  ndvi                    REAL,
  land_cover              TEXT,
  dist_road_m             REAL,
  dist_river_m            REAL,
  river                   TEXT,
  road_cutting            INTEGER DEFAULT 0,
  landslide_history_count INTEGER DEFAULT 0,
  last_event_date         TEXT,
  source                  TEXT NOT NULL DEFAULT 'static_seed'
);

-- Section 0C: exposure & vulnerability
CREATE TABLE IF NOT EXISTS exposure (
  location_id         TEXT PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  population          INTEGER DEFAULT 0,
  roads_json          TEXT NOT NULL DEFAULT '[]',
  bridges_json        TEXT NOT NULL DEFAULT '[]',
  facilities_json     TEXT NOT NULL DEFAULT '[]',
  critical_infra_json TEXT NOT NULL DEFAULT '[]',
  tourist_zone        INTEGER DEFAULT 0,
  exposure_score      REAL NOT NULL DEFAULT 0,
  source              TEXT NOT NULL DEFAULT 'static_seed'
);

-- ---------- Weather feed cache (Section 0A, Section 7) ----------
CREATE TABLE IF NOT EXISTS weather_cache (
  location_id   TEXT PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  fetched_at    TEXT NOT NULL,
  hourly_json   TEXT NOT NULL,      -- raw hourly arrays from Open-Meteo
  daily_json    TEXT NOT NULL,
  features_json TEXT NOT NULL,      -- derived Section 0A features at fetch time
  source        TEXT NOT NULL       -- 'open-meteo' | 'fallback_climatology'
);

-- Latest IMD district warnings and nowcasts, one row per (product, our district). Survives restarts.
CREATE TABLE IF NOT EXISTS imd_cache (
  product       TEXT NOT NULL,      -- 'warning' | 'nowcast'
  district      TEXT NOT NULL,      -- our district name (locations.district)
  data_json     TEXT NOT NULL,      -- normalised summary (see ingest/imd.js)
  fetched_at    TEXT NOT NULL,
  PRIMARY KEY (product, district)
);

CREATE TABLE IF NOT EXISTS feed_status (
  feed          TEXT PRIMARY KEY,   -- 'open_meteo', 'imd', 'prediction', 'seismic', 'sensors'
  status        TEXT NOT NULL,      -- 'ok' | 'degraded' | 'error' | 'not_connected' | 'not_configured'
  last_success  TEXT,
  last_attempt  TEXT,
  message       TEXT
);

-- ---------- Risk output (Section 0D) ----------
CREATE TABLE IF NOT EXISTS risk_state (
  location_id    TEXT PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  score          REAL NOT NULL,
  level          TEXT NOT NULL,
  confidence     REAL NOT NULL,
  drivers_json   TEXT NOT NULL,
  trend          TEXT NOT NULL,
  forecast_json  TEXT NOT NULL,
  time_to_threshold_json TEXT,
  priority       REAL NOT NULL,
  conditions_json TEXT,
  model_version  TEXT NOT NULL,
  level_since    TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  score       REAL NOT NULL,
  level       TEXT NOT NULL,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_history_loc_at ON risk_history(location_id, at);

-- ---------- Authority inbox (system -> officers) ----------
CREATE TABLE IF NOT EXISTS inbox_messages (
  id              TEXT PRIMARY KEY,
  location_id     TEXT NOT NULL REFERENCES locations(id),
  level           TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('escalation','deescalation','re_escalation')),
  title_key       TEXT NOT NULL,
  body_params     TEXT NOT NULL,     -- JSON params for EN/HI translation keys
  priority        REAL NOT NULL DEFAULT 0,
  escalated       INTEGER NOT NULL DEFAULT 0,
  parent_id       TEXT REFERENCES inbox_messages(id),
  created_at      TEXT NOT NULL,
  read_at         TEXT,              -- first read by anyone (per-user reads in inbox_reads)
  acknowledged_by TEXT REFERENCES users(id),
  acknowledged_at TEXT,
  incident_id     TEXT REFERENCES incidents(id),
  target_roles    TEXT NOT NULL,     -- JSON array of sub_roles
  target_district TEXT NOT NULL,
  tags            TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox_messages(created_at);

CREATE TABLE IF NOT EXISTS inbox_reads (
  message_id TEXT NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at    TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

-- ---------- Management (Section 0E) ----------
CREATE TABLE IF NOT EXISTS incidents (
  id            TEXT PRIMARY KEY,
  location_id   TEXT NOT NULL REFERENCES locations(id),
  title         TEXT NOT NULL,
  stage         TEXT NOT NULL CHECK (stage IN ('detected','under_verification','verified','alert_issued','response_underway','resolved','closed')),
  level         TEXT NOT NULL,
  owner_id      TEXT REFERENCES users(id),
  source        TEXT NOT NULL DEFAULT 'system',  -- system | citizen_report | officer
  notes         TEXT,
  detected_at   TEXT NOT NULL,
  alert_issued_at TEXT,
  resolved_at   TEXT,
  closed_at     TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incident_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT,
  note        TEXT,
  actor       TEXT,
  at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sops (
  level   TEXT NOT NULL,
  key     TEXT NOT NULL,
  text_en TEXT NOT NULL,
  text_hi TEXT NOT NULL,
  roles   TEXT NOT NULL,   -- JSON array of sub_roles
  ord     INTEGER NOT NULL,
  PRIMARY KEY (level, key)
);

CREATE TABLE IF NOT EXISTS incident_sop_ticks (
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  sop_key     TEXT NOT NULL,
  done        INTEGER NOT NULL,
  actor       TEXT,
  at          TEXT NOT NULL,
  PRIMARY KEY (incident_id, sop_key)
);

CREATE TABLE IF NOT EXISTS resources (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('excavator','rescue_team','ambulance','shelter')),
  name        TEXT NOT NULL,
  location_id TEXT REFERENCES locations(id),
  district    TEXT,
  status      TEXT NOT NULL CHECK (status IN ('available','deployed','unavailable')),
  capacity    INTEGER,
  occupancy   INTEGER DEFAULT 0,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incident_resources (
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  assigned_by TEXT,
  assigned_at TEXT NOT NULL,
  released_at TEXT,
  PRIMARY KEY (incident_id, resource_id, assigned_at)
);

CREATE TABLE IF NOT EXISTS roads (
  id             TEXT PRIMARY KEY,
  name_en        TEXT NOT NULL,
  name_hi        TEXT NOT NULL,
  corridor_id    TEXT REFERENCES corridors(id),
  path_json      TEXT NOT NULL,      -- ordered location ids
  status         TEXT NOT NULL CHECK (status IN ('open','caution','restricted','blocked','cleared')),
  eta_clear_hours REAL,
  diversion_en   TEXT,
  diversion_hi   TEXT,
  tourist_advisory INTEGER DEFAULT 0,
  heavy_vehicle_advisory INTEGER DEFAULT 0,
  updated_by     TEXT,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id           TEXT PRIMARY KEY,
  severity     TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'warning' CHECK (kind IN ('warning','all_clear','cancel')),
  target_type  TEXT NOT NULL,        -- location | corridor | district
  target_id    TEXT NOT NULL,
  title_en     TEXT NOT NULL,
  title_hi     TEXT NOT NULL,
  body_en      TEXT NOT NULL,
  body_hi      TEXT NOT NULL,
  channels     TEXT NOT NULL,        -- JSON array: dashboard, sms, push
  incident_id  TEXT REFERENCES incidents(id),
  inbox_message_id TEXT REFERENCES inbox_messages(id),
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  cancelled_at TEXT
);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id  TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  channel   TEXT NOT NULL,
  status    TEXT NOT NULL,            -- sent | stub_sent | failed
  detail    TEXT,
  at        TEXT NOT NULL
);

-- Aggregate acknowledgements from citizens (no personal data stored).
CREATE TABLE IF NOT EXISTS alert_acks (
  scope_type TEXT NOT NULL,           -- alert | risk_event
  scope_id   TEXT NOT NULL,           -- alert id, or location_id:level:date
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  type         TEXT NOT NULL,          -- crack | debris | rockfall | water_seepage | road_damage | other
  description  TEXT,
  lat          REAL,
  lng          REAL,
  location_id  TEXT REFERENCES locations(id),
  photo_path   TEXT,
  status       TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','verified','rejected','resolved')),
  reviewed_by  TEXT,
  reviewed_at  TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stakeholders (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  role     TEXT NOT NULL,
  district TEXT NOT NULL,
  name     TEXT,
  phone    TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  user_id      TEXT,
  performed_by TEXT NOT NULL,          -- e.g. "officer@demo.in" or "developer (as authority/police)"
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Latest earthquakes near the region and the national seismograph network (NCS, with USGS as backup). Survives restarts.
CREATE TABLE IF NOT EXISTS seismic_cache (
  kind          TEXT PRIMARY KEY,   -- 'quakes' | 'stations'
  data_json     TEXT NOT NULL,      -- normalised list (see ingest/seismic.js)
  fetched_at    TEXT NOT NULL
);

-- EXPERIMENTAL model's daily predictions (ml/models/landslide-live.json). One row per place, day predicted, and
-- day the prediction was issued, so predictions made BEFORE an event can be checked against it later.
CREATE TABLE IF NOT EXISTS ml_predictions (
  location_id   TEXT NOT NULL,
  for_date      TEXT NOT NULL,      -- IST day being predicted
  issued_on     TEXT NOT NULL,      -- IST day the prediction was made
  score         REAL NOT NULL,      -- relative likelihood (not a probability)
  elevated      INTEGER NOT NULL,   -- 1 if above the "elevated" threshold
  model_version TEXT NOT NULL,
  features_json TEXT NOT NULL,      -- the model's inputs, for audit
  computed_at   TEXT NOT NULL,
  PRIMARY KEY (location_id, for_date, issued_on)
);

-- Confirmed landslides recorded by officers (directly, or promoted from a verified report / an incident).
-- The ground truth the experimental model is judged against (scorecard) and retrained on (ml/retrain.mjs).
-- Never deleted: a mistaken record is retracted (kept, with who and why).
CREATE TABLE IF NOT EXISTS landslide_record (
  id             TEXT PRIMARY KEY,
  date           TEXT NOT NULL,      -- IST day of the landslide
  lat            REAL NOT NULL,
  lng            REAL NOT NULL,
  accuracy_km    REAL NOT NULL,      -- how precisely the spot is known
  location_id    TEXT,               -- nearest monitored place
  source         TEXT NOT NULL,      -- 'officer' | 'report' | 'incident'
  source_id      TEXT,               -- report or incident id
  notes          TEXT,
  recorded_by    TEXT NOT NULL,
  recorded_at    TEXT NOT NULL,
  retracted_at   TEXT,
  retracted_by   TEXT,
  retract_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS landslide_record_source ON landslide_record(source, source_id) WHERE source_id IS NOT NULL;

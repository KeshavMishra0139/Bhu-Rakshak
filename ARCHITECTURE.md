# Bhu-Rakshak architecture

```
/shared/config   risk.json (thresholds, hysteresis, alarm + escalation timers), factors.json (every factor: unit, EN/HI label, source)
/server/src
  config/        env loader, permissions map (capability -> role/sub-role)
  db/            node:sqlite adapter, schema.sql, seed.js (locations, static layers, exposure, roads, resources, SOPs, incidents, demo users)
  data/          locations.json, static_layers.json, exposure.json, roads.json, resources.json, sops.json (seed, clearly labelled)
  auth/          JWT cookie, bcrypt, requireAuth/requireCap middleware, rate limiter, dev-mode gate
  ingest/        openMeteo.js (batched fetch every 45 min, cache in weather_cache), features.js (Section 0A derivations)
  prediction/    PredictionProvider (interface), LivePredictionProvider (live_sim), ModelPredictionProvider (stub: POST MODEL_URL/predict), engine.js, liveLoop.js
  events/        bus.js (in-process emitter), sse.js (client registry, per-user filtering)
  notifications/ inbox.js (risk_escalation -> inbox_messages, role/district routing, 10-min re-escalation)
  routes/        auth, locations, risk, inbox, settings, health, tools, incidents, alerts, reports, operations (roads/resources/sops/
                 stakeholders), insights (situation report + assistant), admin, map (Bhuvan discovery, history), dev (only if DEV_MODE_ENABLED)
/client/src      React + Vite + TS + Tailwind; i18n (en/hi), ThemeProvider, AuthProvider, RiskStreamProvider (SSE + offline snapshot)
  authority/     map-first command centre (map/, InboxPage, IncidentsPage, AlertsPage, ReportsPage, RoadsPage, ResourcesPage, Audit, Sitrep)
  citizen/       responsive website (Home, Roads, Alerts, Report, Profile) + alarm engine (CitizenContext)
  admin/, dev/   admin page; developer bar, view-as, split view
  lib/mapConfig.ts  every basemap / overlay source in one place
```

**DB (SQLite):** users, corridors, locations, static_layers, exposure, weather_cache, feed_status, risk_state, risk_history,
inbox_messages, incidents, incident_events, incident_sop_ticks, sops, resources, incident_resources, roads, alerts,
alert_deliveries, alert_acks, reports, stakeholders, audit_log, app_settings.

**Event flow:** Open-Meteo cache + static layers -> engine.score() -> live drift/scenario/force overlay -> hysteresis ->
`risk_update` (every tick) and `risk_escalation` / `risk_deescalation` (level crossings only) on the bus ->
SSE fan-out to browsers + inbox.js writes routed `inbox_messages` -> `inbox_message` SSE to matching officers.

**API:** `/api/auth/*`, `/api/locations[/:id]`, `/api/risk/stream`, `/api/risk/forecast`, `/api/inbox[/unread-count|/:id/ack|/read]`,
`/api/incidents[/:id/stage|note|owner|sop|resources]`, `/api/alerts[/draft|/:id/cancel|/:id/ack]`, `/api/risk-ack`, `/api/reports`,
`/api/roads`, `/api/resources`, `/api/sops`, `/api/stakeholders`, `/api/situation-report`, `/api/assistant`, `/api/settings`,
`/api/admin/*`, `/api/audit`, `/api/health`, `/api/map/config|history`, `/api/tools/scenario`,
`/api/dev/login|view-as|force-risk|reset|speed|pause|scenario` (404 unless DEV_MODE_ENABLED=true).

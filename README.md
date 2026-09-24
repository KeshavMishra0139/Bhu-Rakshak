# Bhu-Rakshak (भू-रक्षक)

Landslide early warning and risk management for Sikkim and the Darjeeling hills.
Team ByteMatrix, Smart India Hackathon 2026 (SIH26001). **Predict → Visualize → Verify → Warn.**

One app, two products chosen by the account role:

- **Authority dashboard**: a full-screen, map-first command centre with an inbox, incidents, alerts, field reports, roads, resources, an audit log, a situation report and system health.
- **Citizen website**: a calm, responsive site with five sections (Home, Roads, Alerts, Report, Profile) and a High/Critical alarm.

Both work in English and Hindi, and in Light / Dark / System themes.

## Run it

Requirements: **Node.js 22.13 or newer** (`node -v`). It uses Node's built-in SQLite, so nothing needs compiling.

```bash
npm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
# optional: set DEV_PASSWORD in .env to enable the developer account
npm run dev
```

Open **http://localhost:5173**. The API runs on port 4000; Vite proxies `/api`. The database is created and seeded on first start.

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (auto-restart) and client together |
| `npm run reset` | Delete the database and reseed |
| `npm test` | Server tests (engine, hysteresis, features, inbox routing, permissions, alert templates, assistant) |
| `npm run build` then `npm start` | Production build; the server also serves `client/dist` on port 4000 |

With no internet the app still runs. It uses a clearly labelled fallback weather series until Open-Meteo is reachable; map tiles and Street View need an internet connection.

## Demo credentials

Every demo account uses the password **`Demo@2026`** (`DEMO_PASSWORD`). The login page also has one-tap demo buttons.

| Account | Role | Can do |
| --- | --- | --- |
| citizen@demo.in | Citizen, home Mangan | Citizen website, alarm, reports |
| officer@demo.in | SDMA, statewide | Everything: alerts, Storm scenario, incidents, audit |
| dm.north@demo.in | District Officer, North Sikkim | Everything within North Sikkim |
| police@demo.in | Police, East Sikkim | Closures, diversions, advisories, verify reports |
| bro@demo.in | Road authority, North Sikkim | Mark roads blocked / cleared, verify reports |
| rescue@demo.in | Rescue, North Sikkim | Deploy resources, response status |
| admin@demo.in | Admin | Approvals, users, audit log, health, contacts |
| pending.officer@demo.in | Official awaiting approval | Shows "Verification in progress" |
| dev@demo.in | Developer (only if `DEV_PASSWORD` is set) | Everything, plus the developer bar |

### Developer / Admin mode

To use it, set `DEV_PASSWORD` (and optionally `DEV_ACCESS_CODE`), restart, and use **Sign in as Developer / Admin** at the bottom of the login page. A purple bar then appears at the top of every screen, with:

- **View as** Authority (sub-role and district), Citizen (home place) or Admin
- **Split view**: authority map on the left, citizen site at phone width on the right, both live from one login
- **Demo controls**: Storm scenario with a corridor picker, force a location's level, pause and resume, speed 1×/2×/5×, and reset demo data
- Language and theme toggles

Actions taken while viewing as another role are logged as `developer (as <role>)`.

**Before any public deployment set `DEV_MODE_ENABLED=false` and `DEMO_LOGIN_ENABLED=false`.** With developer mode off, every `/api/dev/*` route returns 404 and the sign-in link disappears.

## 2-minute judge demo

1. **(0:00) Landing.** Show the live mini-map, the headline stats and "How it works". Switch to Hindi and back with one tap.
2. **(0:15) Split view.** Sign in as developer and open **Split view**. On the left is the authority watch map (satellite map, pins labelled by risk level, corridors, the live risk stations rail and the in-person Street View toggle); on the right is the citizen site for Mangan.
3. **(0:30) Storm.** In **Demo controls**, start the Storm scenario on *North Sikkim Highway*. About a minute later Mangan and Chungthang turn **High**: the officer's Inbox badge lights up with a toast and chime, and the citizen pane shows the alarm banner and sounds the High beep. About two minutes in they turn **Critical**, and the citizen siren and the stronger officer chime follow. For a faster show, use *Force level → Critical* on Mangan.
4. **(1:00) Officer response.** Open the Inbox message: it shows drivers, forecast, what's exposed and the suggested actions. Press **Acknowledge**, then **Create incident** and assign *SDRF team B*. Tick "Close the road". Press **Draft alert**; the English and Hindi text is pre-filled. Send it.
5. **(1:25) Citizen side.** The alert appears instantly under Alerts, with *I understand*, *Share on WhatsApp* and *Call 112*. Press *I understand* on the banner; the officer's drawer shows the acknowledgement count go up.
6. **(1:40) Verify loop.** In the citizen pane, send a report (debris, pin on the map). As the officer, verify it: Mangan gets the field-verified tick.
7. **(1:50) Close.** Open **Tools → Situation report**, which is printable. Stop the storm and watch levels ease back without flickering.

## What is real, generated or pending

| | Component |
| --- | --- |
| **Real** | Open-Meteo weather and soil moisture (fetched every 30 min, cached, served offline), IMD district warnings and nowcasts (every 30 min once `IMD_API_KEY` and `IMD_TOKEN` are set), Esri satellite and street maps, Google Street View (embedded), auth and roles, inbox routing and escalation, incidents with SOP checklist and audit log, alerts with dashboard delivery and acknowledgement counts, citizen reports with verification, roads, resources, situation report, EN/HI, themes |
| **Generated** | Live risk values: a transparent baseline engine anchored on real weather, with bounded live variation and the Storm scenario. Derived features (saturation index, cloudburst and freeze–thaw flags). Assistant answers (templates over live data). Historical landslide points (seeded from per-location counts). |
| **Seed placeholders** | Slope, geology, NDVI, land cover, river and road distance, landslide history, population and facilities (`server/src/data/*.json`), road statuses, resources and contacts |
| **Pending / stubs (labelled in code)** | Trained ML model (`ModelPredictionProvider`, `POST {MODEL_URL}/predict`); SMS and push delivery (`notifications/providers.js`, logged through the provider interface); seismic feed and ground sensors; official Survey of India boundary (place it at `client/public/geo/india_boundary.geojson`; until then the legend shows "Official boundary data pending"); real GIS layers from Bhuvan, GSI and the census |

No accuracy figures are claimed anywhere. Confidence reflects only data freshness and agreement.

## Weather data

- **Open-Meteo** (no key): hourly rain, snow, temperature and five soil-moisture layers for every location, 7 days back and 3 ahead (`server/src/ingest/openMeteo.js`).
- **IMD** (`server/src/ingest/imd.js`): district-wise warnings (5 days) and district-wise nowcasts (next ~3 hours) from the IMD API portal, `https://api.imd.gov.in/api/v1`.
  - Register at [api.imd.gov.in](https://api.imd.gov.in) and put your API key and JWT in `IMD_API_KEY` and `IMD_TOKEN`. Requests send them as `x-api-key` and `Authorization: Bearer …`. The older `mausam.imd.gov.in/api/*` endpoints need your server's IP whitelisted by IMD instead.
  - Warnings are matched to our districts by both old and new Sikkim names (`server/src/data/imd_districts.json`).
  - Heavy, very heavy and extremely heavy rain warnings, thunderstorms and the nowcast become the `imd_warning` risk factor (weight 0.04, taken from the model rain forecast). When IMD has nothing current for a district, that share falls back to the Open-Meteo forecast, so scores are unchanged without IMD credentials.
  - Officers see the warning in the location drawer and citizens see it on Home, always with "Source: IMD" as IMD's API guidelines require. System health shows the IMD feed status.

## Maps

No map needs an API key, billing or sign-up. Sources and settings are in `client/src/lib/mapConfig.ts`; maps are drawn with Leaflet.

- **Satellite (default):** Esri World Imagery, with Esri's road and place-name overlays.
- **Street:** Esri World Street Map (light theme) or Esri Dark Gray with its labels (dark theme). CARTO's basemaps now need a key, so they are not used.
- **Terrain:** OpenTopoMap.
- **In-person view:** real Google Street View, shown in the same map area through Google's standard "Embed a map" iframe (the embed Google offers under Share → Embed a map; free, no key). Google's imagery here is mostly in towns (confirmed in Gangtok and Rangpo); elsewhere Google says "No Street View available", and **Open in Google Maps** searches around the spot on Google's site. Free open alternatives (Mapillary, KartaView, Panoramax) were checked and barely cover Sikkim.
- **Authority map:** the team's corridor watch console (same design as the citizen portal): classic red pins labelled ✓ (Low), • (Moderate), ! (High) and !! (Critical), a Satellite / Street / Terrain switch, full-screen button, and a "Live risk stations" rail listing every location with its 24 h rainfall and level. Selecting a pin or a row opens the location drawer; the rail also holds the forecast time selector. Layer chips toggle corridor lines, road status, citizen reports and rescue resources (the last two for roles that can see incidents). A **Map / In-person view** toggle switches the same map area to Street View at the selected place, or at any spot you click; **Pick another spot** returns to the map to choose again.
- **Landing and citizen maps:** satellite with labels on the landing page; the street map for citizen routes and report pins.
- **Boundaries:** the official Survey of India overlay (`client/public/geo/india_boundary.geojson`) is the only boundary source the team uses for India's borders; the Esri place-name layer shows neighbouring country names around Sikkim.
- **Bhuvan:** the server still discovers Sikkim and Himalayan WMS layers from the official Bhuvan service (`/api/map/config`, `BHUVAN_TOKEN` sent as `token=` if set), but the current watch map does not draw them.

Data credits are on the About page and in each map's attribution line.

## Configuration

- **Risk:** thresholds, hysteresis, alarm repeat times, escalation and management timers are in `shared/config/risk.json`.
- **Factors:** each factor's unit, English/Hindi label and data source is in `shared/config/factors.json`.
- **Alert text:** bilingual templates are in `server/src/data/alert_templates.json`.

## Test status

- **Tested here:**
  - 26 server unit tests, including IMD parsing, district matching, day selection, nowcast expiry, the engine fallback and the credential headers.
  - HTTP integration of every endpoint and permission rule, run against small Express stand-ins because packages couldn't be installed in the build environment.
  - SSE fan-out: each role gets only its own events.
  - Storm timing: High after about 60 s, Critical after about 120 s.
  - The client type-checks and builds, every translation key exists in both languages, and the landing, authority and citizen maps and the in-person view were checked in a browser.
- **Not yet run against live services:** IMD (needs your API key and JWT; the response parsing follows IMD's published field reference).

## Troubleshooting

- **`node:sqlite` not found:** upgrade to Node 22.13+.
- **No alarm sound:** browsers need one tap first. Press "Turn on sounds" on the citizen site, or use Profile → Test alarm.
- **Everyone logged out after a restart:** set a fixed `JWT_SECRET`.
- **Want a clean demo:** `npm run reset`, or the developer bar's *Reset demo data*.

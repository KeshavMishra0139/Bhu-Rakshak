# Bhu-Rakshak model data (step 1)

Training data for a landslide model that learns from **what triggers landslides (rain, soil water, snowmelt,
earthquakes)** and **where the ground is prone to failing (slope, relief, shape, aspect, elevation)** —
not a rainfall model.

```bash
node ml/build_inventory.mjs      # landslide inventory       → inventory.csv, all_reported.csv
node ml/build_dataset.mjs        # factors per sample        → dataset.csv   (~40 min first time; cached after)
# road/river map (once): download Geofabrik north-eastern-zone + eastern-zone .osm.pbf into ml/data/raw, then
node ml/osm_pbf.mjs ml/data/raw/north-eastern-zone.osm.pbf ml/data/raw/eastern-zone.osm.pbf   # → osm_tiles/
node ml/build_controls.mjs       # road-matched comparison spots → controls.csv
node ml/build_extra.mjs          # rain vs normal, river/road distance, vegetation → dataset_plus.csv
node ml/clean.mjs                # checks + removals         → clean.csv, cleaning_report.json
node ml/experiments.mjs          # factor comparison + bias checks → models/experiments.md, selected_features.json
node ml/train.mjs                # final model + test years  → models/landslide-gbdt-v1.json, report.md
node ml/replay.mjs               # past seasons, day by day  → models/replay.md
node ml/audit_sources.mjs 25     # spot-check source links   → source_audit.json
```

Every download is cached in `ml/data/cache/` (not committed), so a re-run is quick and a failed run resumes.
Failed lookups are listed in `ml/data/build_log.json`.

## 1. Landslide inventory (`inventory.csv`)

| Source | What | Coverage |
|---|---|---|
| NASA Global Landslide Catalog (GLC) — data.nasa.gov `global-landslide-catalog-export` | News-reported landslides with date, location, trigger, size | 2007–2017+, NE India incl. Sikkim & Darjeeling |
| `manual_events.csv` | Recent events checked by hand against news reports; source URL on every row | Rimbi, West Sikkim, 2026 |

Kept: India only, inside the NE box (21.9–29.6 N, 87.5–97.5 E), location accurate to 25 km or better.

**Known limits.** News-based catalogues miss events in remote areas and dates can be off by a day. The GLC's newer
successor (NASA COOLR) and the **GSI national landslide inventory (Bhukosh / NLSM)** would add many more events
— Bhukosh was not reachable from the build machine; add it when it is (see §4).

## 2. Samples (`dataset.csv`)

| `label` | `sample_type` | Meaning |
|---|---|---|
| 1 | `event` | A landslide, on its reported date and place |
| 0 | `same_place_other_date` | Same spot, 2 dates in the same season of other years, no landslide reported within 10 km / 10 days — teaches **when** |
| 0 | `nearby_place_same_date` | A spot 8–40 km away on the same date, no landslide reported within 8 km / 7 days — teaches **where** |

Sampling is seeded (reproducible). "No landslide reported" is not proof none happened, so treat label 0 as
"probably no landslide". When evaluating, split by **year** (train on older years, test on newer) so the model is
never tested on days it has seen.

## 2b. Bias safeguards

| Risk | What we found | What we do |
|---|---|---|
| News reports landslides that hit roads | Distance to a road ALONE separated landslides from random nearby spots with AUC 0.88 | Random spots removed; each landslide gets a **road-matched** spot (same date, 8–40 km away, same distance from a major road). Road distance is never a factor. |
| Past-landslide counts | Come from the same news reports and grow with calendar time (a hidden date signal) | Never used as a factor (shown only as a bias check) |
| Border contamination | 9 "no landslide" samples were near landslides reported across the border / in dropped records | Removed: no non-landslide sample within 10 km / 7 days of ANY of the 929 reported landslides in the wider area |
| Mixed weather products | 2 rows used the forecast archive (different soil depths) | ERA5 reanalysis for every row |
| Regional imbalance | Nagaland/West Bengal have more records than Sikkim | Results reported per region, plus a "new area" test (train without a region, test on it) |
| Testing on seen data | — | Always test on later years than training; month and location are never factors |

## 3. Data dictionary

Dates are Indian Standard Time days. `d0` = the sample date, `d1` = the day before.

### Trigger — rain and water in the ground
| Column | Unit | Source | Meaning |
|---|---|---|---|
| `rain_d0`, `rain_d1` | mm | Open-Meteo (ERA5 reanalysis) | Rain on the day / the day before |
| `rain_3d`, `rain_7d`, `rain_15d`, `rain_30d` | mm | Open-Meteo (ERA5) | Rain totals ending on d0 |
| `api_30d` | mm | derived | Antecedent precipitation index (k = 0.9) up to d1 — how wet the ground already was |
| `max_1h_48h` | mm/h | Open-Meteo (ERA5) | Heaviest hour in the last 48 h (cloudburst signal) |
| `rainy_days_7d` | days | Open-Meteo (ERA5) | Days with ≥ 1 mm in the last week |
| `power_rain_d0`, `_3d`, `_7d`, `_30d` | mm | NASA POWER (MERRA-2 based) | A second, independent rain estimate |
| `sm_top`, `sm_mid`, `sm_deep` | m³/m³ | Open-Meteo (ERA5) | Soil moisture on d1 at 0–7, 7–28, 28–100 cm |

### Trigger — temperature, snow, earthquakes
| Column | Unit | Source | Meaning |
|---|---|---|---|
| `tmax_d0`, `tmin_d0` | °C | Open-Meteo (ERA5) | Day's max / min temperature (freeze–thaw) |
| `snowfall_7d` | cm | Open-Meteo (ERA5) | Snow in the last week (snowmelt water) |
| `quake_max_mmi_30d` | MMI | USGS catalogue (M4+) | Strongest estimated shaking at the spot in the last 30 days (same formula as the live site) |
| `quake_count_300km_30d`, `quake_max_mag_300km_30d` | –, M | USGS | Earthquakes within 300 km in the last 30 days |

### Susceptibility — terrain (AWS Terrain Tiles; mainly NASA SRTM ~30 m here)
| Column | Unit | Meaning |
|---|---|---|
| `elev_m` | m | Elevation |
| `slope_deg` | ° | Slope over ~100 m (Horn's method, 3×3 window) |
| `aspect_deg`, `northness`, `eastness` | °, −1…1 | Which way the slope faces (blank / 0 on flat ground) |
| `curvature` | 1/100 m | Negative = hollow that collects water; positive = ridge |
| `relief_1km` | m | Height range within ~1 km — how rugged the area is |

### Bookkeeping
`event_id`, `date`, `month`, `lat`, `lng`, `accuracy_km` (location accuracy of the source event), `state`,
`weather_source` (`open-meteo-era5`, or `open-meteo-forecast-archive` for the last few days before ERA5 is published),
`weather_grid_lat/lng` (centre of the weather cell used).

### Extra factors (build_extra.mjs)
| Column | Source | Meaning |
|---|---|---|
| `clim_month_mm_day`, `clim_annual_mm_day` | NASA POWER climatology | Long-term normal rain for this place (and month) |
| `rain_3d_vs_normal`, `_7d_`, `_30d_` | derived | How many times wetter than normal for this place and month |
| `dist_major_river_m` | OpenStreetMap (Geofabrik) | Distance to the nearest river (capped 3 km) |
| `dist_road_m` | OpenStreetMap (Geofabrik) | Distance to the nearest major road — **bias check only, never a model factor** |
| `ndvi_before` | MODIS MOD13Q1 (ORNL DAAC) | Vegetation greenness, 16-day composite ending ≥ 18 days before the date |
| `past_landslides_5km`, `_15km` | our inventory, strictly earlier | **Bias check only, never a model factor** |

## 4. Important factors not yet included (and how to add them)

| Factor | Why it matters | Source | Blocker |
|---|---|---|---|
| Satellite rain (GPM IMERG, 30-min, ~10 km) | Observed rain, catches storms the models smooth out | NASA GES DISC | Needs a free NASA Earthdata account → put a token in `.env` as `EARTHDATA_TOKEN` |
| IMD gridded rain (0.25°, rain-gauge based) | Official Indian observed rain back to 1901 | imdpune.gov.in | Site not reachable from the build machine |
| Rock type / geology, faults | Weak rock (phyllite, schist) fails far more often | GSI Bhukosh | Site not reachable from the build machine |
| Land cover (ESA WorldCover 10 m) | Vegetation type, not just greenness | AWS open data (Cloud-Optimised GeoTIFF) | Raster reader — next step |
| Soil texture (clay, sand, density) | Clay-rich soils lose strength when wet | SoilGrids (ISRIC) REST API | Works, but rate limit ≈ 2.5 h for all locations |
| Precise landslide outlines | The "where" problem: news locations are town-level | GSI national inventory (Bhukosh) | Not reachable from the build machine |
| Ground movement (InSAR) | Catches slowly creeping slopes like Rimbi's before they fail | Sentinel-1 (ESA), NISAR | Heavy processing — later |
| On-slope sensors (rain gauge, piezometer, tilt) | Local, real-time truth | To be installed | Hardware |

## 5. Why this matters (Rimbi, 2026)

Replaying Aug–Sep 2026 at Rimbi (`server/scripts/backtest-rimbi.js`): the Open-Meteo forecast data showed about
1–2 mm of rain on 13–14 Aug, when news reports describe a major spell of rain and ~30 houses were damaged.
NASA POWER showed 8.8 and 6.8 mm. Both are ~10–50 km weather cells and miss local downpours — which is why the
model needs observed rain (IMERG, IMD, gauges) and non-rain factors (terrain, geology, ground movement), and why
Rimbi's recurring failures from one slope point to ground-movement monitoring.

## 6. Live model on the website (experimental)

```bash
node ml/check_shift.mjs          # live rain feed vs training rain       → models/data_shift.md
node ml/train_live.mjs           # model the website runs (26 factors, 7 models averaged) → models/landslide-live-v1.json
node ml/prepare_live.mjs         # terrain + normal rain per monitored place → models/live_locations.json
node ml/make_parity_fixture.mjs  # real training rows for the server's parity test
```

- The server (`server/src/prediction/mlModel.js`) scores every monitored place for **today and tomorrow** every
  3 hours, using `ml/live_features.mjs` — the same formulas as training (`server/test/mlModel.test.js` checks this
  against real training rows).
- Officers see it in each place's drawer as **"AI model (second opinion)", labelled Experimental** with its measured
  accuracy. It **never triggers alerts or citizen warnings**; citizens can't see it.
- Every prediction is logged (`ml_predictions` table; download: `/api/ml/log.csv`) with the day it was issued, so it
  can be judged against landslides that happen later.
- Left out of the live model: NASA POWER rain (2–3 days late) and soil-moisture layers (different depths live).
  The live rain feed matches ERA5 closely (see `models/data_shift.md`).

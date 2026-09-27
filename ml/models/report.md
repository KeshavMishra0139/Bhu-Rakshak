# Landslide model v1 — evaluation report

Generated 2026-09-27 from `ml/data/clean.csv` (689 rows: 180 landslides, 509 non-landslides).

**Test set = landslides from 2015-08-01 onward (184 rows), never seen in training.** Train/validation used earlier years.

| Model | ROC AUC | PR AUC | "When" AUC | "Where" AUC | Landslides caught | Warnings that were right | False-alarm rate |
|---|---|---|---|---|---|---|---|
| Full model (rain + soil/temperature/snow + earthquakes + terrain) | 0.642 | 0.348 | 0.702 | 0.509 | 64% | 35% | 40% |
| Rain only | 0.634 | 0.354 | 0.697 | 0.494 | 49% | 37% | 29% |
| Terrain only | 0.519 | 0.289 | 0.500 | 0.562 | 100% | 26% | 99% |
| Everything except terrain | 0.639 | 0.344 | 0.709 | 0.487 | 51% | 36% | 31% |
| Logistic regression (all factors) | 0.668 | 0.427 | – | – | 85% | 29% | 72% |

- **ROC AUC**: 0.5 = coin toss, 1.0 = perfect ranking of landslide vs non-landslide.
- **"When" AUC**: same place, landslide day vs another day. **"Where" AUC**: same day, landslide spot vs a spot 8–40 km away.
- Threshold (0.27) was chosen on the validation years (best F1 with at least 70% of landslides caught), then applied unchanged to the test years.

## Full model on the test years
Caught **30 of 47** landslides (64%); raised **85** warnings, **30** correct (35%); false-alarm rate **40%** of non-landslide cases.

## With the operational threshold (0.31: ~1 warning per 10 ordinary days)
Caught **21 of 47** test landslides (45%); false-alarm rate **24%**; warnings that were right 39%. Rain-only at its own operational threshold: caught 36%, false alarms 22%.

Chosen settings (by validation AUC 0.683): `{"maxDepth":2,"minLeaf":10,"learningRate":0.05,"colSample":0.8}`, 23 trees.

## What the model relies on
Drop in test ROC AUC when a factor group is scrambled (bigger = more important):
- **rain**: −0.119
- **terrain**: −0.009
- **soil temperature snow**: −0.001
- **earthquakes**: −0.000

Top individual factors (share of tree split gain):
- `rain_3d` 17%
- `rain_7d` 15%
- `power_rain_3d` 11%
- `rain_15d` 10%
- `rain_d0` 9%
- `relief_1km` 5%
- `rain_d1` 5%
- `slope_deg` 5%
- `power_rain_30d` 5%
- `power_rain_d0` 4%
- `rain_30d` 3%
- `tmax_d0` 2%

## Rimbi, West Sikkim (2026)
- 2026-08-13 event: full model **0.18** (no warning), rain-only 0.18
- 2018-08-19 same_place_other_date: full model **0.20** (no warning), rain-only 0.19
- 2013-08-26 same_place_other_date: full model **0.30** (WARNING), rain-only 0.30
- 2026-08-13 nearby_place_same_date: full model **0.23** (no warning), rain-only 0.24
- 2026-09-24 event: full model **0.32** (WARNING), rain-only 0.36
- 2012-10-25 same_place_other_date: full model **0.19** (no warning), rain-only 0.17
- 2018-10-10 same_place_other_date: full model **0.21** (no warning), rain-only 0.19
- 2026-09-24 nearby_place_same_date: full model **0.28** (WARNING), rain-only 0.34

## Limits — read before quoting these numbers
- The inventory is news-based (NASA GLC): remote landslides are under-reported, and "no landslide reported" is not proof none happened.
- Non-landslide samples were drawn ~3 per landslide, so the score is a relative likelihood, not a real-world probability.
- Rain comes from 10–50 km weather cells (ERA5, NASA POWER); local cloudbursts are smoothed out.
- Missing factors: geology/rock type, land cover, distance to roads and rivers, observed satellite rain (IMERG), ground movement (InSAR).
- The test set is small, so the numbers have wide uncertainty (roughly ±0.05 AUC).

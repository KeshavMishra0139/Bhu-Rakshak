# Landslide model v1 — evaluation report

Factors: 33 (rain, soil_temperature_snow, earthquakes, terrain), chosen by the bias-checked backtest in experiments.md.

Generated 2026-09-27 from `ml/data/clean.csv` (694 rows: 180 landslides, 514 non-landslides).

**Test set = landslides from 2015-08-01 onward (180 rows), never seen in training.** Train/validation used earlier years.

| Model | ROC AUC | PR AUC | "When" AUC | "Where" AUC (road-matched) | Landslides caught | Warnings that were right | False-alarm rate |
|---|---|---|---|---|---|---|---|
| Full model (rain + soil/temperature/snow + earthquakes + terrain) | 0.689 | 0.426 | 0.735 | 0.587 | 57% | 35% | 38% |
| Rain only | 0.670 | 0.475 | 0.713 | 0.574 | 53% | 32% | 39% |
| Terrain only | 0.502 | 0.265 | 0.497 | 0.513 | 100% | 26% | 100% |
| Everything except terrain | 0.676 | 0.435 | 0.729 | 0.556 | 60% | 39% | 32% |
| Logistic regression (all factors) | 0.645 | 0.449 | – | – | 83% | 30% | 68% |

- **ROC AUC**: 0.5 = coin toss, 1.0 = perfect ranking of landslide vs non-landslide.
- **"When" AUC**: same place, landslide day vs another day. **"Where" AUC**: same day, landslide spot vs a road-matched spot 8–40 km away (same distance from a major road, so equally likely to be reported in the news).
- Threshold (0.26) was chosen on the validation years (best F1 with at least 70% of landslides caught), then applied unchanged to the test years.

## Full model on the test years
Caught **27 of 47** landslides (57%); raised **77** warnings, **27** correct (35%); false-alarm rate **38%** of non-landslide cases.

## With the operational threshold (0.31: ~1 warning per 10 ordinary days)
Caught **20 of 47** test landslides (43%); false-alarm rate **18%**; warnings that were right 45%. Rain-only at its own operational threshold: caught 45%, false alarms 21%.

Chosen settings (by validation AUC 0.697): `{"maxDepth":3,"minLeaf":8,"learningRate":0.05,"colSample":0.8}`, 37 trees.

## What the model relies on
Drop in test ROC AUC when a factor group is scrambled (bigger = more important):
- **rain**: −0.175
- **soil temperature snow**: −0.014
- **earthquakes**: −0.002
- **terrain**: +0.002

Top individual factors (share of tree split gain):
- `power_rain_3d` 11%
- `slope_deg` 9%
- `rain_d0` 7%
- `rain_7d` 6%
- `power_rain_d0` 6%
- `rain_7d_vs_normal` 6%
- `rain_15d` 5%
- `max_1h_48h` 5%
- `rain_3d` 4%
- `power_rain_30d` 4%
- `tmax_d0` 4%
- `rain_d1` 3%

## Rimbi, West Sikkim (2026)
- 2026-08-13 event: full model **0.10** (no warning), rain-only 0.09
- 2018-08-19 same_place_other_date: full model **0.16** (no warning), rain-only 0.15
- 2026-09-24 event: full model **0.39** (WARNING), rain-only 0.43
- 2012-10-25 same_place_other_date: full model **0.20** (no warning), rain-only 0.22
- 2018-10-10 same_place_other_date: full model **0.22** (no warning), rain-only 0.16
- 2026-08-13 roadside_same_date: full model **0.18** (no warning), rain-only 0.16
- 2026-09-24 roadside_same_date: full model **0.24** (no warning), rain-only 0.28

## Limits — read before quoting these numbers
- The inventory is news-based (NASA GLC): remote landslides are under-reported, and "no landslide reported" is not proof none happened.
- Non-landslide samples were drawn ~3 per landslide, so the score is a relative likelihood, not a real-world probability.
- Rain comes from 10–50 km weather cells (ERA5, NASA POWER); local cloudbursts are smoothed out.
- Missing factors: geology/rock type, land cover, soil texture, observed satellite rain (IMERG), ground movement (InSAR). Road distance is deliberately not used (news-coverage bias).
- The test set is small, so the numbers have wide uncertainty (roughly ±0.05 AUC).

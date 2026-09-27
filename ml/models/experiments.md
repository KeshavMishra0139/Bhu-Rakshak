# Which factors help — and is the model biased?

Data: `ml/data/clean.csv` — 180 landslides, 514 non-landslide samples
(357 same_place_other_date, 157 roadside_same_date); 143 random nearby spots kept aside for the bias check only.

## 1. Year-by-year backtest (train on earlier years only, test on 2012–2016, pooled: 111 test landslides)

| Factors | # | ROC AUC | When | Where (road-matched) | Caught | False alarms | Warnings right | AUC by year |
|---|---|---|---|---|---|---|---|---|
| Rain only | 13 | 0.696 | 0.744 | 0.581 | 49% | 22% | 44% | 2012: 0.767 · 2013: 0.654 · 2014: 0.699 · 2015: 0.707 · 2016: 0.678 |
| v1 (rain, soil, snow, quakes, terrain) | 28 | 0.672 | 0.711 | 0.579 | 43% | 18% | 46% | 2012: 0.703 · 2013: 0.638 · 2014: 0.669 · 2015: 0.675 · 2016: 0.701 |
| **v1 + rain vs normal ← chosen** | 33 | 0.689 | 0.731 | 0.588 | 50% | 21% | 45% | 2012: 0.708 · 2013: 0.662 · 2014: 0.708 · 2015: 0.715 · 2016: 0.668 |
| v1 + river distance | 29 | 0.673 | 0.709 | 0.587 | 39% | 18% | 43% | 2012: 0.624 · 2013: 0.658 · 2014: 0.691 · 2015: 0.683 · 2016: 0.682 |
| v1 + vegetation | 29 | 0.670 | 0.705 | 0.587 | 41% | 19% | 44% | 2012: 0.620 · 2013: 0.630 · 2014: 0.717 · 2015: 0.698 · 2016: 0.686 |
| v1 + rain vs normal + vegetation | 34 | 0.684 | 0.722 | 0.594 | 43% | 19% | 45% | 2012: 0.684 · 2013: 0.643 · 2014: 0.723 · 2015: 0.678 · 2016: 0.722 |
| v1 + all new (no past landslides, no road distance) | 35 | 0.687 | 0.724 | 0.599 | 44% | 19% | 46% | 2012: 0.717 · 2013: 0.624 · 2014: 0.738 · 2015: 0.696 · 2016: 0.723 |
| _Bias check: + past landslides (never used)_ | 30 | 0.669 | 0.713 | 0.566 | 45% | 19% | 45% | 2012: 0.691 · 2013: 0.632 · 2014: 0.692 · 2015: 0.679 · 2016: 0.686 |
| _Bias check: + road distance (never used)_ | 29 | 0.671 | 0.706 | 0.588 | 41% | 18% | 44% | 2012: 0.624 · 2013: 0.665 · 2014: 0.689 · 2015: 0.687 · 2016: 0.674 |

- **When**: same place, landslide day vs an ordinary day. **Where**: same day, landslide spot vs a **road-matched** spot
  8–40 km away (same distance from a major road, so an equal chance of being reported in the news).
- Random nearby spots are not used at all (see bias checks): they made "where" look far better than it is.
- Road distance and past-landslide counts are never used as factors (both carry the news-coverage bias); rows marked
  _Bias check_ show what they would do.
- Caught / false alarms use the operational threshold (~1 warning per 10 ordinary days in the training years).
- Chosen = best pooled AUC; a set with more factors had to win by ≥ 0.01. With ~111 test landslides, differences
  under ~0.03 are within noise.

## 2. Bias checks

**Reporting bias (news covers road landslides).** Using *only* "how close to a major road":
- landslides vs random nearby spots: AUC **0.881** (323 rows)
- landslides vs road-matched spots: AUC **0.423** (337 rows)

Road distance alone separates landslides from random spots — clear evidence of reporting bias in random comparisons. Against road-matched spots it should be ≈ 0.5 (no signal), which means the matched comparison is fair.
Random spots were therefore removed; "where" is measured only against road-matched spots.

**Balance of the samples (medians):**

| | Landslide | Same place, other day | Random nearby spot | Road-matched spot |
|---|---|---|---|---|
| dist_road_m | 100.4 | 100.4 | 1671.0 | 53.7 |
| elev_m | 1040.0 | 1036.0 | 1016.0 | 1006.0 |
| slope_deg | 15.5 | 15.4 | 17.7 | 19.4 |
| relief_1km | 312.0 | 312.0 | 355.0 | 381.0 |
| rain_3d | 63.0 | 26.8 | 59.1 | 57.1 |
| past_landslides_5km | 1.0 | 1.0 | 0.0 | 0.0 |

**Past-landslide counts are NOT used.** They come from the same news reports (they mark where reporters go), and they
grow with calendar time — average count near "ordinary day" samples by year: 2007: 0.1 · 2008: 1.1 · 2009: 1.4 · 2010: 4.1 · 2011: 5.6 · 2012: 6.6 · 2013: 7.5 · 2014: 7.6 · 2015: 5.6 · 2016: 12.4 · 2017: 14.1 · 2018: 8.4 · 2019: 14.7 · 2020: 9.0 · 2021: 11.5 · 2022: 15.0 · 2023: 12.6 · 2024: 10.3 · 2025: 13.2 · 2026: 10.4. A model would partly learn
the date. Adding them anyway: backtest AUC 0.669 vs 0.672 without — shown only as a check.

**Region fairness (chosen factors, year-by-year backtest):**

| Region | Test landslides | AUC | Caught | False alarms |
|---|---|---|---|---|
| Sikkim & Darjeeling hills | 27 | 0.650 | 44% | 23% |
| Assam & Meghalaya | 35 | 0.748 | 69% | 29% |
| Nagaland, Manipur, Mizoram, Tripura | 36 | 0.646 | 39% | 17% |
| Arunachal Pradesh | 12 | 0.752 | 42% | 9% |

**New-area test (train on the other regions, test on this one — all years):**

| Region never seen in training | Landslides | AUC | When | Where (road-matched) |
|---|---|---|---|---|
| Sikkim & Darjeeling hills | 52 | 0.650 | 0.722 | 0.490 |
| Assam & Meghalaya | 39 | 0.793 | 0.857 | 0.609 |
| Nagaland, Manipur, Mizoram, Tripura | 67 | 0.632 | 0.685 | 0.519 |
| Arunachal Pradesh | 17 | 0.726 | 0.754 | 0.663 |

Other safeguards already in the pipeline: non-landslide samples near ANY reported landslide (any country, any record)
removed; one weather product (ERA5) for every row; flat-ground events (geocoding errors) removed; month and
location are never given to the model; tests are always on later years than training.

# Live model (runs on the website)

Factors (26): `rain_d0`, `rain_d1`, `rain_3d`, `rain_7d`, `rain_15d`, `rain_30d`, `api_30d`, `max_1h_48h`, `rainy_days_7d`, `tmax_d0`, `tmin_d0`, `snowfall_7d`, `quake_max_mmi_30d`, `quake_count_300km_30d`, `quake_max_mag_300km_30d`, `elev_m`, `slope_deg`, `northness`, `eastness`, `curvature`, `relief_1km`, `clim_month_mm_day`, `clim_annual_mm_day`, `rain_3d_vs_normal`, `rain_7d_vs_normal`, `rain_30d_vs_normal`.
Left out because the website can't get them the same way every day: NASA POWER rain (2–3 days late) and
soil-moisture layers (different depths in the live feed). 7 models averaged.

| | ROC AUC | When | Where (road-matched) | Caught | False alarms | Warnings right |
|---|---|---|---|---|---|---|
| All chosen factors (not runnable live) | 0.688 | 0.728 | 0.593 | 50% | 25% | 41% |
| **Live model** | **0.673** | 0.712 | 0.582 | 44% | 19% | 45% |

Year-by-year backtest 2012–2016 (111 test landslides), each year trained only on earlier years.
"Elevated" threshold: 0.367 (reached on ~10% of ordinary monsoon days in the training data).

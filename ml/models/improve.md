# Improving the model — same bias-free backtest, same test rows

Test: precisely located landslides 2012–2016 (111) with their ordinary days and road-matched spots; every model trained only on earlier years.
"All landslides" adds 136 landslides located to 10–25 km (used only for the weather-based WHEN part).

| Variant | ROC AUC | When | Where (road-matched) | Caught | False alarms | Warnings right |
|---|---|---|---|---|---|---|
| A  current (one model, chosen factors) | 0.675 | 0.717 | 0.575 | 46% | 24% | 40% |
| B  + monotone constraints | 0.680 | 0.723 | 0.579 | 39% | 22% | 39% |
| C  + bagging (7 models) | 0.688 | 0.728 | 0.593 | 50% | 25% | 41% |
| B+C  monotone + bagging | 0.684 | 0.727 | 0.584 | 41% | 21% | 41% |
| D  two parts: WHEN (all landslides) + WHERE (precise) | 0.676 | 0.704 | 0.610 | 34% | 17% | 42% |
| E  two parts + monotone + bagging | 0.668 | 0.696 | 0.600 | 38% | 19% | 42% |
| F  WHEN part only (weather, all landslides) | 0.682 | 0.740 | 0.547 | 43% | 22% | 41% |
| G  WHEN part only + monotone + bagging | 0.673 | 0.727 | 0.547 | 46% | 26% | 39% |

Caught / false alarms at ~1 warning per 10 ordinary days (threshold from the training years). Differences under ~0.03 are within noise.

# Live rain vs training rain (2026-07-03 → 2026-09-21)

Training used ERA5 reanalysis; the website gets rain from the Open-Meteo forecast API. Same places, same days:

| Place | Days | ERA5 total (mm) | Live-feed total (mm) | Live ÷ ERA5 | Daily correlation | 3-day correlation |
|---|---|---|---|---|---|---|
| Sevoke | 56 | 613 | 543 | 0.88 | 0.87 | 0.88 |
| Melli | 56 | 638 | 622 | 0.98 | 0.99 | 0.99 |
| Rangpo | 56 | 759 | 746 | 0.98 | 0.99 | 0.99 |
| Singtam | 56 | 1138 | 1117 | 0.98 | 0.99 | 0.99 |
| Gangtok | 56 | 749 | 788 | 1.05 | 0.93 | 0.96 |
| Nathula road (Tsomgo) | 56 | 1383 | 1394 | 1.01 | 1.00 | 1.00 |
| Mangan | 56 | 1699 | 1685 | 0.99 | 1.00 | 1.00 |
| Chungthang | 56 | 702 | 669 | 0.95 | 0.97 | 0.98 |
| Lachung | 56 | 676 | 657 | 0.97 | 0.96 | 0.99 |
| Lachen | 56 | 270 | 300 | 1.11 | 0.93 | 0.93 |
| Namchi | 56 | 1221 | 1178 | 0.96 | 0.97 | 0.97 |
| Jorethang | 56 | 791 | 775 | 0.98 | 1.00 | 1.00 |
| Gyalshing | 56 | 580 | 556 | 0.96 | 0.98 | 0.99 |
| Pelling | 56 | 624 | 620 | 0.99 | 1.00 | 1.00 |
| Kalimpong | 56 | 688 | 662 | 0.96 | 0.95 | 0.97 |
| Darjeeling | 56 | 473 | 467 | 0.99 | 1.00 | 1.00 |
| Kurseong | 56 | 549 | 517 | 0.94 | 0.94 | 0.94 |

Median ratio **0.98**, median 3-day correlation **0.99**.

# North East map layers

`layers.json` lists the extra map layers. Three are **SAMPLE DATA** today — placeholder shapes so the map, legend and
toggles can be shown. They are not observations and the app labels them "SAMPLE DATA — replace" wherever they appear.

| Layer | Sample file | Geometry | Properties the app reads |
|---|---|---|---|
| Jhum burn scars | jhum_burn_scars.SAMPLE.geojson | Polygon | burn_month, area_ha |
| Road-cutting zones | road_cutting_zones.SAMPLE.geojson | LineString | slope_deg, cut_height_m |
| Ground movement (InSAR) | insar_deformation.SAMPLE.geojson | Point | velocity_mm_yr (negative = moving away from the satellite), coherence, period |

To switch a layer to real data: put the GeoJSON (WGS84) in this folder, change its `file` in `layers.json`, set
`sample` to `false` and describe the `source`. No code changes are needed.

Cumulative rainfall (3/7/15 days) is real: the server builds it from Open-Meteo (`/api/layers/rain`).

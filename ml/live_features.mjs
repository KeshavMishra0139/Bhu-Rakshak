// Model inputs for one place and one day, from a weather series — used by the website (server/src/prediction/
// mlModel.js). The formulas are exactly those used to build the training data (features.mjs weather() + shaking(),
// build_extra.mjs rain-vs-normal); server/test/mlModel.test.js checks this against a real training row.
import { distanceKm, intensityAt } from './lib.mjs';

/**
 * @param {object} a
 * @param {{time:string[], precipitation_sum:number[], snowfall_sum:number[], temperature_2m_max:number[], temperature_2m_min:number[]}} a.daily  IST days
 * @param {{precipitation:number[]}} a.hourly  hourly values starting at 00:00 IST of daily.time[0]
 * @param {number} a.n        index of the day to score (needs n ≥ 30)
 * @param {{lat:number,lng:number,terrain:object,clim_month_mm_day:number[],clim_annual_mm_day:number}} a.place
 * @param {{time:number,mag:number,lat:number,lng:number,depth_km:number}[]} a.quakes  M4+ earthquakes
 */
export function liveFeatures({ daily, hourly, n, place, quakes }) {
  if (n < 30) throw new Error('need 30 days of history before the scored day');
  const P = daily.precipitation_sum;
  const sum = (from, to) => { let s = 0; for (let k = n - to; k <= n - from; k++) s += P[k] ?? 0; return s; };
  let api = 0;
  for (let k = n - 30; k < n; k++) api = api * 0.9 + (P[k] ?? 0);
  const hEnd = (n + 1) * 24;
  const date = daily.time[n];
  const monthMean = place.clim_month_mm_day[Number(date.slice(5, 7)) - 1];
  const rain3 = sum(0, 2); const rain7 = sum(0, 6); const rain30 = sum(0, 29);

  // Earthquakes in the 30 days up to the end of the day (IST).
  const end = Date.parse(`${date}T23:59:59+05:30`);
  let mmi = 0; let count = 0; let maxMag = 0;
  for (const e of quakes) {
    if (e.mag < 4 || e.time < end - 30 * 86400000 || e.time > end) continue;
    if (distanceKm(e, place) <= 300) { count++; maxMag = Math.max(maxMag, e.mag); }
    mmi = Math.max(mmi, intensityAt(e, place));
  }

  return {
    rain_d0: P[n], rain_d1: P[n - 1], rain_3d: rain3, rain_7d: rain7, rain_15d: sum(0, 14), rain_30d: rain30,
    api_30d: api,
    max_1h_48h: Math.max(...hourly.precipitation.slice(hEnd - 48, hEnd).map((x) => x ?? 0)),
    rainy_days_7d: P.slice(n - 6, n + 1).filter((x) => (x ?? 0) >= 1).length,
    tmax_d0: daily.temperature_2m_max[n], tmin_d0: daily.temperature_2m_min[n],
    snowfall_7d: daily.snowfall_sum.slice(n - 6, n + 1).reduce((a, b) => a + (b ?? 0), 0),
    quake_max_mmi_30d: mmi || 1, quake_count_300km_30d: count, quake_max_mag_300km_30d: maxMag || null,
    ...place.terrain,
    clim_month_mm_day: monthMean, clim_annual_mm_day: place.clim_annual_mm_day,
    rain_3d_vs_normal: monthMean ? rain3 / (monthMean * 3) : null,
    rain_7d_vs_normal: monthMean ? rain7 / (monthMean * 7) : null,
    rain_30d_vs_normal: monthMean ? rain30 / (monthMean * 30) : null,
  };
}

// PredictionProvider interface + factory. The frontend never knows which provider is active.
//
// getRisk(locationId: string, at: Date) => Promise<Risk>
//   Risk = {
//     location_id, score (0..1), level ('low'|'moderate'|'high'|'critical', un-smoothed),
//     confidence (0..1), drivers: [{ key, contribution (%) }] (3–5 items, keys from factors.json → drivers),
//     trend: 'rising'|'steady'|'falling'|null (RiskService fills it if null),
//     forecast: [{ h: 6|12|24|48, score, level }],
//     time_to_threshold: { level, hours } | null,
//     conditions: { ...Section 0A feature values },
//     model_version: string, updated_at: ISO string
//   }
// Level smoothing (hysteresis), trend, priority, persistence and events live in RiskService (liveLoop.js),
// so both providers get identical behaviour.
import { env } from '../config/env.js';

export class PredictionProvider {
  // eslint-disable-next-line no-unused-vars
  async getRisk(locationId, at) { throw new Error('not implemented'); }
  get name() { return 'abstract'; }
}

let instance;
export async function getProvider() {
  if (instance) return instance;
  const { LivePredictionProvider } = await import('./LivePredictionProvider.js');
  const live = new LivePredictionProvider();
  if (env.predictionMode === 'model') {
    const { ModelPredictionProvider } = await import('./ModelPredictionProvider.js');
    instance = new ModelPredictionProvider({ url: env.modelUrl, fallback: live });
  } else {
    instance = live;
  }
  return instance;
}

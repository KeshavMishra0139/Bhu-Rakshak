// Demo / operations controls for the live layer: storm scenario, forced levels, pause and speed.
// Persisted in app_settings so a server restart mid-demo keeps the same state.
import { settings } from '../db/index.js';
import { riskConfig } from '../config/shared.js';
import { bus } from '../events/bus.js';
import { nowIso } from '../lib/util.js';

const DEFAULTS = { paused: false, speed: 1, scenario: { active: false, corridors: [], intensity: 1, startedAt: null, by: null }, forced: {} };

let state = null;
const load = () => (state ??= { ...structuredClone(DEFAULTS), ...(settings.get('live_controls', {}) || {}) });
const save = () => { settings.set('live_controls', state); bus.emit('controls_changed', getControls()); };

export const getControls = () => structuredClone(load());

export function setScenario({ active, corridors = [], intensity = 1 }, by) {
  load();
  state.scenario = active
    ? { active: true, corridors, intensity: Math.min(1.5, Math.max(0.5, Number(intensity) || 1)), startedAt: nowIso(), by }
    : { ...state.scenario, active: false };
  save();
  return getControls();
}

/** level = low|moderate|high|critical, or null to release. */
export function setForced(locationId, level) {
  load();
  if (level) state.forced[locationId] = level; else delete state.forced[locationId];
  save();
  return getControls();
}

export function setSpeed(speed) {
  load();
  if (!riskConfig.live.speedOptions.includes(Number(speed))) throw new Error('invalid_speed');
  state.speed = Number(speed);
  save();
  return getControls();
}

export function setPaused(paused) {
  load();
  state.paused = !!paused;
  save();
  return getControls();
}

export function resetControls() {
  state = structuredClone(DEFAULTS);
  save();
  return getControls();
}

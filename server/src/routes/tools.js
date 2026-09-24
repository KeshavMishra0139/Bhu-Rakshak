// Operational tools for District Officer / SDMA / Admin: the Storm scenario.
import { Router } from 'express';
import { q } from '../db/index.js';
import { requireAuth, requireCap } from '../auth/middleware.js';
import { getControls, setScenario } from '../prediction/controls.js';
import { audit } from '../lib/audit.js';
import { ah, HttpError } from '../lib/util.js';

const r = Router();
r.use('/tools', requireAuth(), requireCap('scenario.control'));

r.get('/tools/scenario', (_req, res) => {
  const c = getControls();
  res.json({ scenario: c.scenario, corridors: q.all('SELECT id, name_en, name_hi, color FROM corridors ORDER BY id') });
});

// { active: true, corridors: ['north'], intensity: 1 } or { active: false }
r.post('/tools/scenario', ah(async (req, res) => {
  const { active, corridors = [], intensity = 1 } = req.body || {};
  const valid = new Set(q.all('SELECT id FROM corridors').map((c) => c.id));
  const list = Array.isArray(corridors) ? corridors.filter((c) => valid.has(c)) : [];
  if (active && !list.length) throw new HttpError(400, 'choose_a_corridor');
  const c = setScenario({ active: !!active, corridors: list, intensity }, req.actor.performedBy);
  audit(req.actor, active ? 'tools.scenario_start' : 'tools.scenario_stop', 'scenario', null, { corridors: list, intensity });
  res.json({ scenario: c.scenario });
}));

export default r;

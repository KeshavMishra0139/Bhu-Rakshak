// One permissions map for the whole app (server enforces it; the client only uses it to show/hide tools).
// Keys: 'citizen', 'admin', 'developer', or 'authority:<sub_role>'.
const AUTH = (...subs) => subs.map((s) => `authority:${s}`);
const ALL_AUTHORITY = AUTH('district_officer', 'sdma', 'police', 'bro', 'rescue');

export const CAPABILITIES = {
  'risk.view': ['citizen', 'admin', 'developer', ...ALL_AUTHORITY],
  'risk.details': ['admin', 'developer', ...ALL_AUTHORITY],
  'inbox.read': ['admin', 'developer', ...ALL_AUTHORITY],
  'scenario.control': ['admin', 'developer', ...AUTH('district_officer', 'sdma')],
  'alerts.dispatch': ['developer', ...AUTH('district_officer', 'sdma')],
  'roads.close': ['developer', ...AUTH('police', 'district_officer', 'sdma')],        // closures, diversions, advisories
  'roads.status': ['developer', ...AUTH('bro', 'district_officer', 'sdma')],          // mark blocked / cleared, ETA
  'incidents.view': ['admin', 'developer', ...ALL_AUTHORITY],
  'incidents.manage': ['developer', ...AUTH('district_officer', 'sdma', 'police', 'bro')],
  'incidents.respond': ['developer', ...AUTH('rescue', 'district_officer', 'sdma')],  // deploy status, verified incidents
  'resources.deploy': ['developer', ...AUTH('rescue', 'district_officer', 'sdma')],
  'reports.verify': ['developer', ...AUTH('district_officer', 'sdma', 'police', 'bro')],
  'landslides.record': ['developer', ...AUTH('district_officer', 'sdma', 'police', 'bro')], // confirmed-landslide record (model ground truth)
  'reports.submit': ['citizen', 'developer', ...ALL_AUTHORITY],
  'sitrep.generate': ['admin', 'developer', ...ALL_AUTHORITY],
  'audit.read': ['admin', 'developer', ...AUTH('district_officer', 'sdma')],
  'health.read': ['admin', 'developer', ...ALL_AUTHORITY],
  'admin.users': ['admin', 'developer'],
};

export const roleKey = (actor) => (actor.role === 'authority' ? `authority:${actor.subRole}` : actor.role);

export function can(actor, cap) {
  if (!actor) return false;
  if (actor.role === 'authority' && actor.status !== 'active') return false;
  return (CAPABILITIES[cap] || []).includes(roleKey(actor));
}

export const capabilitiesOf = (actor) => Object.keys(CAPABILITIES).filter((c) => can(actor, c));

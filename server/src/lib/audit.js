import { q } from '../db/index.js';
import { nowIso } from './util.js';

/**
 * Record who did what. `actor` comes from req.actor (see auth/middleware.js), which already carries
 * "developer (as authority/police)" when a developer is viewing as another role.
 */
export function audit(actor, action, entityType = null, entityId = null, details = null) {
  q.run(`INSERT INTO audit_log(at, user_id, performed_by, action, entity_type, entity_id, details_json)
         VALUES (:at, :uid, :by, :action, :et, :eid, :details)`,
  {
    at: nowIso(), uid: actor?.userId || null, by: actor?.performedBy || 'system', action,
    et: entityType, eid: entityId, details: details ? JSON.stringify(details) : null,
  });
}

export const SYSTEM_ACTOR = { userId: null, performedBy: 'system' };

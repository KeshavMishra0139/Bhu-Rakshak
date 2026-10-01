// Community warning signs for the public map layer: recent citizen reports (cracks, muddy or new springs, tilting
// trees or poles, small rockfalls, …) with a verified / unverified badge. Anonymised: no names, no free text, no
// photos, and positions rounded to about 100 m. Rejected reports are left out.
import { Router } from 'express';
import { q } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';

const r = Router();
const round = (x) => Math.round(x * 1000) / 1000; // ~110 m

export function communityReports(days = 14) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return q.all(`SELECT r.id, r.type, r.lat, r.lng, r.status, r.created_at, r.reviewed_at, r.photo_path IS NOT NULL AS has_photo,
                       l.id AS place_id, l.name_en, l.name_hi
                FROM reports r LEFT JOIN locations l ON l.id = r.location_id
                WHERE r.status != 'rejected' AND r.created_at >= :since AND r.lat IS NOT NULL
                ORDER BY r.created_at DESC LIMIT 300`, { since })
    .map((x) => ({
      id: x.id,
      type: x.type,
      lat: round(x.lat),
      lng: round(x.lng),
      verified: x.status === 'verified' || x.status === 'resolved',
      created_at: x.created_at,
      verified_at: x.status === 'verified' || x.status === 'resolved' ? x.reviewed_at : null,
      has_photo: !!x.has_photo,
      place: x.place_id ? { id: x.place_id, name_en: x.name_en, name_hi: x.name_hi } : null,
    }));
}

r.get('/community-reports', requireAuth(), (req, res) => {
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
  res.json({ reports: communityReports(days), days, rounded_m: 110 });
});

export default r;

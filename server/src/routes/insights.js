// Situation report and the "Ask Bhu-Rakshak" assistant.
import { Router } from 'express';
import { q } from '../db/index.js';
import { requireAuth, requireCap, rateLimit } from '../auth/middleware.js';
import { factorsConfig } from '../config/shared.js';
import { hourIndex, istHourOfDay } from '../ingest/features.js';
import { ah, HttpError, safeJson, round } from '../lib/util.js';

const r = Router();
const IST_OFFSET = 5.5 * 3600000;
const istMidnight = () => { const d = new Date(Date.now() + IST_OFFSET); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - IST_OFFSET).toISOString(); };

r.get('/situation-report', requireAuth(), requireCap('sitrep.generate'), (_req, res) => {
  const since = istMidnight();
  const levels = Object.fromEntries(['low', 'moderate', 'high', 'critical'].map((l) => [l, q.one('SELECT COUNT(*) AS n FROM risk_state WHERE level = :l', { l }).n]));
  res.json({
    generated_at: new Date().toISOString(),
    levels,
    top_locations: q.all(`SELECT l.id, l.name_en, l.name_hi, l.district, r.level, r.score, r.trend, r.confidence, r.drivers_json
                          FROM risk_state r JOIN locations l ON l.id = r.location_id ORDER BY r.priority DESC LIMIT 8`)
      .map((x) => ({ ...x, drivers: safeJson(x.drivers_json, []).slice(0, 3), drivers_json: undefined })),
    incidents: q.all(`SELECT i.id, i.title, i.stage, i.level, i.detected_at, l.name_en, l.name_hi, l.district FROM incidents i
                      JOIN locations l ON l.id = i.location_id WHERE i.stage != 'closed' ORDER BY i.detected_at DESC`),
    alerts_today: q.all('SELECT id, severity, kind, title_en, title_hi, created_at, cancelled_at FROM alerts WHERE created_at >= :s ORDER BY created_at DESC', { s: since }),
    roads_not_open: q.all("SELECT id, name_en, name_hi, status, eta_clear_hours, diversion_en, diversion_hi FROM roads WHERE status NOT IN ('open','cleared')"),
    resources: q.all('SELECT type, status, COUNT(*) AS n FROM resources GROUP BY type, status'),
    reports: q.one(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS pending FROM reports WHERE created_at >= :s`, { s: since }),
    citizen_acks_today: q.one("SELECT COALESCE(SUM(count),0) AS n FROM alert_acks WHERE scope_type = 'risk_event' AND scope_id LIKE :d", { d: `%:${since.slice(0, 10)}` }).n,
    feed: q.one("SELECT status, last_success FROM feed_status WHERE feed = 'open_meteo'"),
  });
});

// ---------- Assistant: templated answers from live data (swap for an LLM later, same request/response) ----------
const drivers = factorsConfig.drivers;
const LV = { en: { low: 'low', moderate: 'moderate', high: 'high', critical: 'critical' }, hi: { low: 'कम', moderate: 'मध्यम', high: 'ज़्यादा', critical: 'गंभीर' } };
const ROAD = { en: { open: 'open', caution: 'open with caution', restricted: 'restricted', blocked: 'blocked', cleared: 'cleared' }, hi: { open: 'खुली', caution: 'सावधानी से खुली', restricted: 'सीमित', blocked: 'बंद', cleared: 'साफ़ हो गई' } };
// IST hour boundaries fall on :30 UTC, so the rounded start prints as a whole IST hour ("7 am").
const fmtTime = (iso, lang) => new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

function intentOf(text) {
  const s = String(text || '').toLowerCase();
  if (/travel|drive|road|go |journey|यात्रा|सड़क|जाना|जाऊँ|रास्ता/.test(s)) return 'travel';
  if (/why|reason|cause|क्यों|कारण/.test(s)) return 'why';
  if (/rain|weather|बारिश|मौसम/.test(s)) return 'rain';
  if (/do|prepare|safe|what should|करूँ|करें|सुरक्षित|तैयारी/.test(s)) return 'prepare';
  return 'status';
}

function bestWindow(hourly, nowMs) {
  if (!hourly) return null;
  const i = hourIndex(hourly, nowMs);
  let best = null;
  for (let s = 1; s + 3 <= 36; s++) {
    const hours = [0, 1, 2].map((k) => istHourOfDay(nowMs + (s + k) * 3600000));
    if (!hours.every((h) => h >= 6 && h < 18)) continue;
    const total = [0, 1, 2].reduce((a, k) => a + (hourly.precipitation?.[i + s + k] || 0), 0);
    if (!best || total < best.total) { const d = new Date(nowMs + s * 3600000); d.setUTCMinutes(d.getUTCMinutes() >= 30 ? 30 : 0, 0, 0); best = { total, start: d.toISOString() }; }
  }
  return best;
}

export function answer({ intent, locationId, lang }) {
  const L = lang === 'hi' ? 'hi' : 'en';
  const loc = q.one('SELECT id, name_en, name_hi, road FROM locations WHERE id = :id', { id: locationId });
  if (!loc) throw new HttpError(400, 'invalid_location');
  const risk = q.one('SELECT level, drivers_json, trend FROM risk_state WHERE location_id = :id', { id: loc.id });
  const w = q.one('SELECT hourly_json FROM weather_cache WHERE location_id = :id', { id: loc.id });
  const hourly = safeJson(w?.hourly_json, null);
  const place = L === 'hi' ? loc.name_hi : loc.name_en;
  const level = risk?.level || 'low';
  const why = safeJson(risk?.drivers_json, []).slice(0, 2).map((d) => drivers[d.key]?.[L === 'hi' ? 'plainHi' : 'plainEn']).filter(Boolean);
  const roads = q.all('SELECT r.name_en, r.name_hi, r.status FROM roads r, json_each(r.path_json) p WHERE p.value = :id', { id: loc.id });
  const roadLine = roads.map((x) => `${L === 'hi' ? x.name_hi : x.name_en}: ${ROAD[L][x.status]}`).join('; ');
  const now = Date.now();
  let rain24 = 0;
  if (hourly) { const i = hourIndex(hourly, now); for (let k = 1; k <= 24; k++) rain24 += hourly.precipitation?.[i + k] || 0; }
  const win = bestWindow(hourly, now);
  const lines = [];
  const T = (en, hi) => lines.push(L === 'hi' ? hi : en);

  if (intent === 'travel') {
    if (level === 'critical') T(`Don't travel near ${place} now. Landslide danger is critical.`, `अभी ${place} के पास यात्रा न करें। भूस्खलन का खतरा गंभीर है।`);
    else if (level === 'high') T(`Avoid travel near ${place} unless it is urgent. The risk is high.`, `ज़रूरी न हो तो ${place} के पास यात्रा न करें। खतरा ज़्यादा है।`);
    else if (level === 'moderate') T(`You can travel near ${place} with care. Travel in daylight and don't stop under steep slopes.`, `${place} के पास सावधानी से यात्रा कर सकते हैं। दिन में यात्रा करें और खड़ी ढलान के नीचे न रुकें।`);
    else T(`Travel near ${place} looks fine right now. The landslide risk is low.`, `अभी ${place} के पास यात्रा ठीक लगती है। भूस्खलन का खतरा कम है।`);
    if (win && level !== 'critical') T(`Best time to go: around ${fmtTime(win.start, 'en')}, when the least rain is expected.`, `जाने का सबसे अच्छा समय: लगभग ${fmtTime(win.start, 'hi')}, तब सबसे कम बारिश की उम्मीद है।`);
    if (roadLine) T(`Roads: ${roadLine}.`, `सड़कें: ${roadLine}।`);
  } else if (intent === 'why') {
    T(`The landslide risk at ${place} is ${LV.en[level]}.`, `${place} में भूस्खलन का खतरा ${LV.hi[level]} है।`);
    if (why.length) T(`Mainly because ${why.join(' and ')}.`, `मुख्य कारण: ${why.join(' और ')}।`);
  } else if (intent === 'rain') {
    T(`About ${round(rain24, 0)} mm of rain is expected at ${place} in the next 24 hours.`, `अगले 24 घंटों में ${place} में लगभग ${round(rain24, 0)} मिमी बारिश होने की उम्मीद है।`);
    if (win) T(`The driest daytime window starts around ${fmtTime(win.start, 'en')}.`, `दिन में सबसे सूखा समय लगभग ${fmtTime(win.start, 'hi')} से शुरू होगा।`);
  } else if (intent === 'prepare') {
    if (level === 'critical') T('Move to a safe place now, away from slopes and the river. Keep your phone charged and call 112 if you are in danger.', 'अभी सुरक्षित जगह पर जाएँ, ढलान और नदी से दूर। फ़ोन चार्ज रखें और खतरे में हों तो 112 पर कॉल करें।');
    else if (level === 'high') T('Keep an emergency bag ready (water, torch, medicines, documents). Watch for new cracks, tilting trees or muddy water, and avoid slopes.', 'एक आपात बैग तैयार रखें (पानी, टॉर्च, दवाइयाँ, कागज़ात)। नई दरारें, झुके पेड़ या मटमैला पानी दिखे तो ध्यान दें, और ढलान से दूर रहें।');
    else T('No special action needed now. Keep drains near your house clear and report any cracks or falling stones in the Report section.', 'अभी कोई खास कदम ज़रूरी नहीं। घर के पास की नालियाँ साफ़ रखें और दरार या गिरते पत्थर दिखें तो रिपोर्ट सेक्शन में बताएँ।');
  } else {
    T(`The landslide risk at ${place} is ${LV.en[level]} right now.`, `अभी ${place} में भूस्खलन का खतरा ${LV.hi[level]} है।`);
    if (why.length) T(`Mainly because ${why.join(' and ')}.`, `मुख्य कारण: ${why.join(' और ')}।`);
  }
  return { intent, location_id: loc.id, level, text: lines.join(' '), sources: ['live_risk', 'forecast', 'roads'], engine: 'template-v1' };
}

// { question?: string, intent?: 'travel'|'why'|'rain'|'prepare'|'status', location_id, lang }
r.post('/assistant', rateLimit({ bucket: 'assistant', max: 60, windowMs: 5 * 60000 }), ah(async (req, res) => {
  const b = req.body || {};
  const intent = ['travel', 'why', 'rain', 'prepare', 'status'].includes(b.intent) ? b.intent : intentOf(b.question);
  res.json(answer({ intent, locationId: String(b.location_id || req.actor?.homeLocationId || ''), lang: b.lang }));
}));

export default r;

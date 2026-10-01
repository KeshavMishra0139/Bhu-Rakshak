// Situation report and the "Ask Bhu-Rakshak" assistant.
import { Router } from 'express';
import { q } from '../db/index.js';
import { requireAuth, requireCap, rateLimit } from '../auth/middleware.js';
import { emergencyConfig, factorsConfig, riskConfig, PREVIEW_CORRIDOR } from '../config/shared.js';
import { hourIndex, istHourOfDay } from '../ingest/features.js';
import { getControls } from '../prediction/controls.js';
import { rampFor } from '../prediction/liveInputs.js';
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

export const INTENTS = ['travel', 'roads', 'why', 'rain', 'prepare', 'status', 'signs', 'report', 'emergency'];

// Same list the app checks offline before sending (shared/config/emergency.json).
const EMERGENCY = new RegExp(emergencyConfig.patterns.join('|'), 'i');

// Order matters: danger first, then the more specific topics.
export function intentOf(text) {
  const s = String(text || '').toLowerCase();
  if (EMERGENCY.test(s)) return 'emergency';
  if (/report|inform|tell (the )?(officials|authorit)|रिपोर्ट|सूचना|बताऊँ|बताना/.test(s)) return 'report';
  if (/crack|stone|rock|boulder|tilt|\blean|mud|sign|sound|rumbl|दरार|पत्थर|चट्टान|झुक|मटमैल|संकेत|आवाज़/.test(s)) return 'signs';
  if (/\b(road|roads|highway|nh)\b.*\b(open|closed|blocked)\b|(सड़क|रास्ता).*(खुल|बंद)/.test(s)) return 'roads';
  if (/travel|drive|road|go |journey|यात्रा|सड़क|जाना|जाऊँ|रास्ता/.test(s)) return 'travel';
  if (/\bam i safe|\bare we safe|\bis it safe here|क्या (मैं|हम) सुरक्षित/.test(s)) return 'status';
  if (/why|reason|cause|क्यों|कारण/.test(s)) return 'why';
  if (/\brain|weather|बारिश|मौसम/.test(s)) return 'rain';
  if (/do|prepare|safe|should|ready|kit|bag|clean|drain|करूँ|करें|सुरक्षित|तैयारी/.test(s)) return 'prepare';
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

/**
 * How far the data behind an answer can be trusted. Saathi only states a risk level when the model's record is recent
 * and was computed from live weather (not the climatology fallback); rain answers need live, recent weather.
 * An officer-set level counts as current. A practice drill, a preview area or low confidence is flagged in the answer.
 */
export function basisFor(loc, risk, w, nowMs = Date.now()) {
  const staleMs = riskConfig.live.staleDataHours * 3600000;
  const old = (iso) => !iso || nowMs - new Date(iso).getTime() > staleMs;
  const c = getControls();
  const forced = !!c.forced?.[loc.id];
  const weatherOk = w?.source === 'open-meteo' && !old(w.fetched_at);
  const riskOk = !!risk && !old(risk.updated_at) && (weatherOk || forced);
  return {
    risk_ok: riskOk,
    weather_ok: weatherOk,
    risk_updated_at: risk?.updated_at || null,
    weather_fetched_at: w?.fetched_at || null,
    weather_source: w?.source || null,
    confidence: risk?.confidence ?? null,
    preview: loc.corridor_id === PREVIEW_CORRIDOR,
    drill: (c.scenario.active && c.scenario.corridors.includes(loc.corridor_id)) || rampFor(loc.corridor_id) > 0.01,
    forced,
  };
}

// ---------- Actions: what a question asks Saathi to open ----------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "Nathula road (Tsomgo)" → nathula road, tsomgo, nathula. */
const nameVariants = (name) => {
  const base = name.replace(/\s*\(.*\)\s*/, '').trim();
  const inner = /\(([^)]+)\)/.exec(name)?.[1];
  return [base, inner, base.replace(/\s+road$/i, '')].filter(Boolean).map((s) => s.toLowerCase());
};
/** Monitored places named in a question, in the order they appear ("from Gangtok to Mangan" → gangtok, mangan). */
export function placesIn(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return [];
  const hits = [];
  for (const l of q.all('SELECT id, name_en, name_hi FROM locations')) {
    const at = [
      ...nameVariants(l.name_en).map((v) => new RegExp(`\\b${escapeRe(v)}\\b`).exec(s)?.index ?? -1),
      ...nameVariants(l.name_hi || '').map((v) => s.indexOf(v)),
    ].filter((i) => i >= 0);
    if (at.length) hits.push({ id: l.id, i: Math.min(...at) });
  }
  return hits.sort((a, b) => a.i - b.i).map((h) => h.id);
}
const SIGHTINGS = [['crack', /crack|दरार/], ['tilting', /tilt|\blean|झुक/], ['water_seepage', /muddy|spring|seep|मटमैल|झरना|सोता/], ['rockfall', /stone|rock|boulder|पत्थर|चट्टान/]];
/** Report type when someone tells Saathi what they see ("There's a crack in my wall"); null for questions about signs. */
export function sightingOf(text) {
  const s = String(text || '').toLowerCase().trim();
  if (!s || /^((what|how|should|when|why|if|is|are|can|do)\b|क्या|कैसे|कब|अगर|क्यों)/.test(s)) return null;
  return SIGHTINGS.find(([, re]) => re.test(s))?.[0] || null;
}

export function answer({ intent, locationId, lang, question }) {
  const L = lang === 'hi' ? 'hi' : 'en';
  const loc = q.one('SELECT id, name_en, name_hi, road, corridor_id FROM locations WHERE id = :id', { id: locationId });
  if (!loc) throw new HttpError(400, 'invalid_location');
  const risk = q.one('SELECT level, confidence, drivers_json, trend, updated_at FROM risk_state WHERE location_id = :id', { id: loc.id });
  const w = q.one('SELECT hourly_json, fetched_at, source FROM weather_cache WHERE location_id = :id', { id: loc.id });
  const now = Date.now();
  const basis = basisFor(loc, risk, w, now);
  const hourly = basis.weather_ok ? safeJson(w?.hourly_json, null) : null;
  const place = L === 'hi' ? loc.name_hi : loc.name_en;
  // Never guess: without a current record there is no level to state.
  const level = basis.risk_ok ? risk.level : null;
  const why = safeJson(risk?.drivers_json, []).slice(0, 2).map((d) => drivers[d.key]?.[L === 'hi' ? 'plainHi' : 'plainEn']).filter(Boolean);
  const roads = q.all('SELECT r.name_en, r.name_hi, r.status, r.diversion_en, r.diversion_hi FROM roads r, json_each(r.path_json) p WHERE p.value = :id', { id: loc.id });
  const roadLine = roads.map((x) => `${L === 'hi' ? x.name_hi : x.name_en}: ${ROAD[L][x.status]}`).join('; ');
  let rain24 = 0;
  if (hourly) { const i = hourIndex(hourly, now); for (let k = 1; k <= 24; k++) rain24 += hourly.precipitation?.[i + k] || 0; }
  const win = bestWindow(hourly, now);
  const lines = [];
  const sources = new Set();
  const T = (en, hi) => lines.push(L === 'hi' ? hi : en);
  const noData = () => T(`I don't have up-to-date risk information for ${place} right now, so I can't say whether it is safe. Please follow instructions from local officials. If you are in danger, **call 112**.`,
    `अभी मेरे पास ${place} के खतरे की ताज़ा जानकारी नहीं है, इसलिए मैं नहीं बता सकता कि वहाँ सुरक्षित है या नहीं। कृपया स्थानीय अधिकारियों के निर्देश मानें। खतरे में हों तो **112 पर कॉल करें**।`);
  // Added after any sentence that states a level, so the person knows how much weight to give it.
  const caveats = () => {
    if (basis.drill) T('Note: a practice drill is running for this area, so these levels are simulated, not real.', 'ध्यान दें: इस इलाके में अभ्यास (ड्रिल) चल रहा है, इसलिए ये स्तर असली नहीं, अभ्यास के हैं।');
    if (basis.preview) T('This is a rough guide: some data for this area has not been checked yet. Follow instructions from local officials.', 'यह सिर्फ़ अनुमान है: इस इलाके का कुछ डेटा अभी जाँचा नहीं गया है। स्थानीय अधिकारियों के निर्देश मानें।');
    else if (basis.confidence != null && basis.confidence < 0.5) T('This is a rough guide: we are not very sure right now. Follow instructions from local officials.', 'यह सिर्फ़ अनुमान है: अभी हम पूरी तरह पक्के नहीं हैं। स्थानीय अधिकारियों के निर्देश मानें।');
  };
  const roadsOut = () => { if (roadLine) { T(`Roads: ${roadLine}.`, `सड़कें: ${roadLine}।`); sources.add('roads'); } };
  const stated = () => { sources.add('risk_model'); caveats(); };
  // A road question that names a destination ("Is my road to Shillong safe?") or two places gets a button that opens
  // the road checker with that route; the route's risk then comes from the model along the whole road.
  let action = null;
  const routeOffer = () => {
    const named = placesIn(question);
    const [from, to] = named.length >= 2 ? named : [loc.id, named[0]];
    if (!to || from === to) return;
    const nm = (id) => { const x = q.one('SELECT name_en, name_hi FROM locations WHERE id = :id', { id }); return L === 'hi' ? x.name_hi : x.name_en; };
    T(`To see the risk along the whole road from ${nm(from)} to ${nm(to)}, tap **Check this road**.`, `${nm(from)} से ${nm(to)} तक पूरी सड़क का खतरा देखने के लिए **यह सड़क जाँचें** दबाएँ।`);
    action = { type: 'route_check', from, to };
  };

  if (intent === 'travel') {
    if (!level) noData();
    else {
      if (level === 'critical') T(`Don't travel near ${place} now. Landslide danger is critical.`, `अभी ${place} के पास यात्रा न करें। भूस्खलन का खतरा गंभीर है।`);
      else if (level === 'high') T(`Avoid travel near ${place} unless it is urgent. The risk is high.`, `ज़रूरी न हो तो ${place} के पास यात्रा न करें। खतरा ज़्यादा है।`);
      else if (level === 'moderate') T(`You can travel near ${place} with care. Travel in daylight and don't stop under steep slopes.`, `${place} के पास सावधानी से यात्रा कर सकते हैं। दिन में यात्रा करें और खड़ी ढलान के नीचे न रुकें।`);
      else T(`Travel near ${place} looks fine right now. The landslide risk is low.`, `अभी ${place} के पास यात्रा ठीक लगती है। भूस्खलन का खतरा कम है।`);
      stated();
      if (win && level !== 'critical') { T(`Best time to go: around ${fmtTime(win.start, 'en')}, when the least rain is expected.`, `जाने का सबसे अच्छा समय: लगभग ${fmtTime(win.start, 'hi')}, तब सबसे कम बारिश की उम्मीद है।`); sources.add('forecast'); }
    }
    roadsOut();
    routeOffer();
  } else if (intent === 'roads') {
    // Road status is what officials have entered, not the model: no level is stated here.
    if (!roads.length) T(`I don't have any monitored roads listed for ${place}. You can check a whole route in the road checker.`, `${place} के लिए कोई निगरानी वाली सड़क सूची में नहीं है। पूरा रास्ता जाँचने के लिए रोड चेकर देखें।`);
    else {
      T(`Roads near ${place}: ${roadLine}.`, `${place} के पास की सड़कें: ${roadLine}।`);
      sources.add('roads');
      for (const x of roads.filter((y) => !['open', 'cleared'].includes(y.status) && y.diversion_en)) {
        T(`Diversion for ${x.name_en}: ${x.diversion_en}.`, `${x.name_hi} के लिए दूसरा रास्ता: ${x.diversion_hi || x.diversion_en}।`);
      }
    }
    routeOffer();
  } else if (intent === 'why') {
    if (!level) noData();
    else {
      T(`The landslide risk at ${place} is ${LV.en[level]}.`, `${place} में भूस्खलन का खतरा ${LV.hi[level]} है।`);
      if (why.length) T(`Mainly because ${why.join(' and ')}.`, `मुख्य कारण: ${why.join(' और ')}।`);
      stated();
    }
  } else if (intent === 'rain') {
    if (!hourly) T(`I don't have up-to-date rain data for ${place} right now. Please follow weather warnings and instructions from local officials.`, `अभी मेरे पास ${place} की बारिश की ताज़ा जानकारी नहीं है। कृपया मौसम चेतावनियाँ और स्थानीय अधिकारियों के निर्देश मानें।`);
    else {
      T(`About ${round(rain24, 0)} mm of rain is expected at ${place} in the next 24 hours.`, `अगले 24 घंटों में ${place} में लगभग ${round(rain24, 0)} मिमी बारिश होने की उम्मीद है।`);
      if (win) T(`The driest daytime window starts around ${fmtTime(win.start, 'en')}.`, `दिन में सबसे सूखा समय लगभग ${fmtTime(win.start, 'hi')} से शुरू होगा।`);
      sources.add('forecast');
    }
  } else if (intent === 'prepare') {
    if (!level) {
      noData();
      T('Meanwhile: keep an emergency bag ready, watch for new cracks, tilting trees or muddy water, and stay away from steep slopes when it rains hard.',
        'तब तक: एक आपात बैग तैयार रखें, नई दरारें, झुके पेड़ या मटमैला पानी दिखे तो ध्यान दें, और तेज़ बारिश में खड़ी ढलान से दूर रहें।');
    } else {
      if (level === 'critical') T('Move to a safe place now, away from slopes and the river. Keep your phone charged and call 112 if you are in danger.', 'अभी सुरक्षित जगह पर जाएँ, ढलान और नदी से दूर। फ़ोन चार्ज रखें और खतरे में हों तो 112 पर कॉल करें।');
      else if (level === 'high') T('Keep an emergency bag ready (water, torch, medicines, documents). Watch for new cracks, tilting trees or muddy water, and avoid slopes.', 'एक आपात बैग तैयार रखें (पानी, टॉर्च, दवाइयाँ, कागज़ात)। नई दरारें, झुके पेड़ या मटमैला पानी दिखे तो ध्यान दें, और ढलान से दूर रहें।');
      else T('No special action needed now. Keep drains near your house clear and report any cracks or falling stones in the Report section.', 'अभी कोई खास कदम ज़रूरी नहीं। घर के पास की नालियाँ साफ़ रखें और दरार या गिरते पत्थर दिखें तो रिपोर्ट सेक्शन में बताएँ।');
      stated();
    }
  } else if (intent === 'emergency') {
    T('If anyone is hurt, trapped or in danger, **call 112 now**. Move away from the slope, the river and the road below it, towards open, higher ground. Do not go back for belongings.',
      'अगर कोई घायल है, फँसा है या खतरे में है तो **अभी 112 पर कॉल करें**। ढलान, नदी और उसके नीचे की सड़क से दूर, खुली और ऊँची जगह की ओर जाएँ। सामान लेने वापस न जाएँ।');
    if (level) { T(`Right now the landslide risk at ${place} is ${LV.en[level]}.`, `अभी ${place} में भूस्खलन का खतरा ${LV.hi[level]} है।`); stated(); }
  } else if (intent === 'signs' && sightingOf(question)) {
    // Someone is telling us what they see: short advice, then the app asks one question at a time (danger? → report).
    T('Thank you for telling me. If it is getting worse, or you hear cracking or rumbling, move away from it now and warn people nearby.',
      'बताने के लिए धन्यवाद। अगर यह बढ़ रहा है, या चटकने या गड़गड़ाहट की आवाज़ आ रही है, तो अभी इससे दूर जाएँ और आसपास के लोगों को बताएँ।');
    action = { type: 'report', report_type: sightingOf(question), ask_danger: true };
  } else if (intent === 'signs') {
    T('Warning signs of a landslide: **new cracks** in the ground, road or walls; **tilting trees, poles or fences**; **muddy water** in streams or springs; **falling stones**; or a rumbling sound.',
      'भूस्खलन के चेतावनी संकेत: ज़मीन, सड़क या दीवारों में **नई दरारें**; **झुकते पेड़, खंभे या बाड़**; नालों या झरनों में **मटमैला पानी**; **गिरते पत्थर**; या गड़गड़ाहट की आवाज़।');
    T('If you see them: move away from the slope at once, warn people nearby, then send a report with a photo from a safe place (Report section). If anyone is in danger, **call 112**.',
      'अगर ये दिखें: तुरंत ढलान से दूर जाएँ, आसपास के लोगों को बताएँ, फिर सुरक्षित जगह से फ़ोटो के साथ रिपोर्ट भेजें (रिपोर्ट सेक्शन)। कोई खतरे में हो तो **112 पर कॉल करें**।');
    if (level === 'high' || level === 'critical') { T(`Take this seriously: the risk at ${place} is already ${LV.en[level]}.`, `इसे गंभीरता से लें: ${place} में खतरा पहले से ${LV.hi[level]} है।`); stated(); }
  } else if (intent === 'report') {
    T('Open **Report** at the bottom of the screen: choose what you saw, add a photo if it is safe, mark the spot on the map or use your location, and send. Officials check every report and you will see when yours is verified.',
      'स्क्रीन के नीचे **रिपोर्ट** खोलें: जो देखा वह चुनें, सुरक्षित हो तो फ़ोटो जोड़ें, नक्शे पर जगह चुनें या अपनी लोकेशन दें, और भेजें। अधिकारी हर रिपोर्ट जाँचते हैं और आपकी रिपोर्ट सत्यापित होने पर आपको दिखेगा।');
    T('Only report from a safe place. If anyone is in danger, **call 112** first.', 'सिर्फ़ सुरक्षित जगह से रिपोर्ट करें। कोई खतरे में हो तो पहले **112 पर कॉल करें**।');
    action = { type: 'report', report_type: sightingOf(question), ask_danger: false };
  } else if (!level) noData();
  else {
    T(`The landslide risk at ${place} is ${LV.en[level]} right now.`, `अभी ${place} में भूस्खलन का खतरा ${LV.hi[level]} है।`);
    // "Am I safe?" also needs what to do.
    T({ critical: 'Move to a safe place now, away from slopes and the river.', high: 'Avoid travel and stay away from slopes and streams.', moderate: 'Take care: travel in daylight and watch for warning signs.', low: 'No special action is needed now.' }[level],
      { critical: 'अभी ढलान और नदी से दूर, सुरक्षित जगह पर जाएँ।', high: 'यात्रा से बचें और ढलान व नालों से दूर रहें।', moderate: 'सावधान रहें: दिन में यात्रा करें और चेतावनी संकेतों पर नज़र रखें।', low: 'अभी कोई खास कदम ज़रूरी नहीं।' }[level]);
    if (why.length) T(`Mainly because ${why.join(' and ')}.`, `मुख्य कारण: ${why.join(' और ')}।`);
    stated();
  }
  // `sources` names what the answer relied on (risk_model, forecast, roads; empty = general safety advice);
  // `basis` carries the update times so the app can show them under the answer; `action` is something to open
  // (route_check {from, to} | report {report_type, ask_danger}).
  return { intent, location_id: loc.id, level, text: lines.join(' '), sources: [...sources], basis, action, engine: 'template-v1' };
}

// { question?: string, intent?: one of INTENTS, location_id, lang }. Answers may mark key phrases with **bold**.
r.post('/assistant', rateLimit({ bucket: 'assistant', max: 60, windowMs: 5 * 60000 }), ah(async (req, res) => {
  const b = req.body || {};
  const intent = INTENTS.includes(b.intent) ? b.intent : intentOf(b.question);
  res.json(answer({ intent, locationId: String(b.location_id || req.actor?.homeLocationId || ''), lang: b.lang, question: typeof b.question === 'string' ? b.question.slice(0, 500) : '' }));
}));

export default r;

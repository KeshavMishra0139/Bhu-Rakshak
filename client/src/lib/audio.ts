// Web Audio sounds, generated in code (no audio files).
// Browsers block audio until the user interacts, so unlockAudio() must run from a click/tap.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(on: boolean) => void>();

function context() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  return ctx;
}

export const audioUnlocked = () => !!ctx && ctx.state === 'running';

export async function unlockAudio() {
  try {
    const c = context();
    if (c.state !== 'running') await c.resume();
    // A silent blip completes the unlock on iOS Safari.
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0.0001;
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.02);
    try { localStorage.setItem('br.soundEnabled', '1'); } catch { /* ignore */ }
  } catch { /* audio not supported */ }
  listeners.forEach((fn) => fn(audioUnlocked()));
  return audioUnlocked();
}

export const onAudioState = (fn: (on: boolean) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
/** User previously chose to enable sound (we still need a gesture on each page load to resume). */
export const soundPreferred = () => { try { return localStorage.getItem('br.soundEnabled') === '1'; } catch { return false; } };

function tone(freq: number, start: number, dur: number, vol: number, type: OscillatorType = 'square', sweepTo?: number) {
  const c = context();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (sweepTo) o.frequency.linearRampToValueAtTime(sweepTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), start + 0.02);
  g.gain.setValueAtTime(Math.max(0.0002, vol), start + dur - 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(master!);
  o.start(start);
  o.stop(start + dur + 0.02);
}

/**
 * One alarm cycle. High: firm repeating beep. Critical: louder, faster two-tone siren.
 * Volume is capped so it is never painfully loud.
 */
function cycle(level: 'high' | 'critical', volume: number) {
  const c = context();
  const now = c.currentTime + 0.05;
  const v = Math.min(0.6, Math.max(0.05, volume)) * (level === 'critical' ? 1 : 0.7);
  if (level === 'high') {
    for (let k = 0; k < 3; k++) tone(880, now + k * 0.5, 0.25, v, 'square');
    return 1800; // ms per cycle
  }
  for (let k = 0; k < 4; k++) {
    tone(650, now + k * 0.5, 0.25, v, 'sawtooth', 1250);
    tone(1250, now + k * 0.5 + 0.25, 0.25, v, 'sawtooth', 650);
  }
  return 2100;
}

/** Play an alarm for `seconds` (repeating cycles). Returns false if audio is still locked. */
export function playAlarm(level: 'high' | 'critical', volume = 0.5, seconds = 8) {
  if (!audioUnlocked()) return false;
  stopAlarm();
  const end = Date.now() + seconds * 1000;
  const run = () => {
    const ms = cycle(level, volume);
    if (Date.now() + ms < end) loopTimer = setTimeout(run, ms);
  };
  run();
  return true;
}

export function stopAlarm() {
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
  if (ctx && master) {
    // Cut anything still scheduled.
    master.disconnect();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
}

/** Short inbox chime: subtle for High, stronger for Critical. */
export function playChime(level: 'high' | 'critical', volume = 0.35) {
  if (!audioUnlocked()) return;
  const c = context();
  const now = c.currentTime + 0.02;
  if (level === 'high') tone(740, now, 0.18, volume * 0.6, 'sine');
  else { tone(880, now, 0.16, volume, 'triangle'); tone(660, now + 0.2, 0.16, volume, 'triangle'); tone(880, now + 0.4, 0.22, volume, 'triangle'); }
}

export function vibrate(pattern: number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

// Voices load asynchronously in some browsers: ask early so they are ready by the first tap.
if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.getVoices();

/** Read text aloud in the chosen language. Returns false if this device can't (no speech, or no voice for the script). */
export function speak(text: string, lang: string) {
  if (!('speechSynthesis' in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  // Assamese: an Assamese voice, else a Bengali one (same script). English voices can't read the script, so say no.
  if (lang === 'as') {
    const v = voices.find((x) => x.lang.toLowerCase().startsWith('as')) || voices.find((x) => x.lang.toLowerCase().startsWith('bn'));
    if (!v) return false;
    u.voice = v;
    u.lang = v.lang;
    window.speechSynthesis.speak(u);
    return true;
  }
  // Nepali voices are rare on phones: use one if present, else a Hindi voice (same script, widely understood).
  const want = lang === 'ne' ? (voices.some((v) => v.lang.toLowerCase().startsWith('ne')) ? 'ne' : 'hi') : lang === 'hi' ? 'hi' : 'en-in';
  u.lang = want === 'ne' ? 'ne-NP' : want === 'hi' ? 'hi-IN' : 'en-IN';
  const voice = voices.find((v) => v.lang.toLowerCase().startsWith(want));
  if (voice) u.voice = voice;
  window.speechSynthesis.speak(u);
  return true;
}
export const stopSpeaking = () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); };
export const canSpeak = () => 'speechSynthesis' in window;

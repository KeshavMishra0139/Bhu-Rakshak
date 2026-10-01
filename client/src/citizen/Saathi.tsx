// Bhu-Rakshak Saathi: the citizen safety assistant, styled after the team portal's Saathi.
// A floating "Ask Saathi" button opens a chat panel on every citizen page. Answers come from /api/assistant,
// which builds them from live risk, forecast and road data for the chosen place (no external AI service).
// Voice input uses the browser's speech recognition where available; "Read aloud" speaks each answer.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Languages, Loader2, MapPin, Megaphone, MessageCircle, Mic, MicOff, Phone, Route as RouteIcon, Send, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { api } from '../api/client';
import { useRiskStream } from '../live/RiskStreamProvider';
import { useCitizen } from './CitizenContext';
import { placeName, secondsSince, timeIST } from '../lib/format';
import { speak, stopSpeaking } from '../lib/audio';
import { useNow } from '../lib/useNow';
import { isEmergency } from '../lib/emergency';
import { EmergencyCard, EMERGENCY_STEPS } from '../components/EmergencyCard';
import { SafePlace } from '../components/SafePlace';
import { withPane } from '../lib/viewAs';

type Lang = 'en' | 'hi';
/** What the server says an answer relied on, and how fresh it was (see insights.js basisFor). */
type Basis = { risk_ok: boolean; weather_ok: boolean; risk_updated_at: string | null; weather_fetched_at: string | null; drill: boolean; forced: boolean; preview: boolean; confidence: number | null };
/** Something an answer offers to open: the road checker with a route, or the report form (after a danger check). */
type Action = { type: 'route_check'; from: string; to: string } | { type: 'report'; report_type: string | null; ask_danger: boolean };
type Reply = { text: string; sources?: string[]; basis?: Basis; action?: Action | null };
type Msg = { id: number; role: 'user' | 'assistant'; text: string; sources?: string[]; basis?: Basis; action?: Action | null };
type Ask = { question?: string; intent?: string; label: string };

const CHIP = 'min-h-[40px] rounded-full border border-[#cfe0d2] bg-white px-3.5 py-2 text-left text-[14px] font-semibold text-[#17392b] hover:border-[#2d765b] hover:bg-[#e8f3ed]';

/** Suggested questions, each answered by a fixed intent so the reply is always on topic. */
export const SAATHI_PROMPTS = ['status', 'roads', 'travel', 'why', 'prepare', 'signs', 'report', 'rain'] as const;

const SaathiCtx = createContext<{ open: (ask?: Ask) => void } | null>(null);
export const useSaathi = () => {
  const ctx = useContext(SaathiCtx);
  if (!ctx) throw new Error('useSaathi outside SaathiProvider');
  return ctx;
};

/** Renders **bold** spans from the assistant's plain-text answers. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part))}</>;
}

type SpeechRec = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
const SpeechRecognitionCtor = (): (new () => SpeechRec) | null =>
  ((window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition ?? null);

export function SaathiProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { list, locations } = useRiskStream();
  const { viewingId, homeId } = useCitizen();
  const navigate = useNavigate();
  const [isOpen, setOpen] = useState(false);
  // Saathi answers in English or Hindi; with the interface in Nepali it starts in Hindi (same script).
  const [lang, setLang] = useState<Lang>(i18n.language === 'hi' || i18n.language === 'ne' ? 'hi' : 'en');
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [readAloud, setReadAloud] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [emergency, setEmergency] = useState(false);
  const nextId = useRef(1);
  const rec = useRef<SpeechRec | null>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const lastMsg = useRef<HTMLDivElement>(null);
  const queued = useRef<Ask | null>(null);

  // Answer for the place the person is looking at, unless they pick another in the panel.
  const place = placeId || viewingId || homeId;
  const placeLoc = list.find((l) => l.id === place);
  const places = useMemo(() => [...list].sort((a, b) => placeName(a, lang).localeCompare(placeName(b, lang))), [list, lang]);
  const T = (key: string, opts?: Record<string, unknown>) => t(key, { lng: lang, ...opts });

  // Show the start of the newest answer (long answers read from the top); while waiting, show the spinner.
  useEffect(() => {
    if (busy) logEnd.current?.scrollIntoView({ block: 'end' });
    else lastMsg.current?.scrollIntoView({ block: 'start' });
  }, [msgs, busy]);
  useEffect(() => () => { rec.current?.stop(); stopSpeaking(); }, []);

  const send = useCallback(async (ask: Ask) => {
    if (busy) return;
    setNotice(null);
    setMsgs((m) => [...m, { id: nextId.current++, role: 'user', text: ask.label }]);
    // Words of immediate danger: stop the chat and show the emergency screen at once (no network, no place needed).
    if (ask.intent === 'emergency' || (ask.question && isEmergency(ask.question))) {
      setEmergency(true);
      if (readAloud) speak([T('citizen.em_title'), T('citizen.em_call'), ...EMERGENCY_STEPS.map((k) => T(k))].join('. '), lang);
      return;
    }
    if (!place) {
      setMsgs((m) => [...m, { id: nextId.current++, role: 'assistant', text: t('citizen.saathi_need_place', { lng: lang }) }]);
      return;
    }
    setBusy(true);
    try {
      const d = await api.post<Reply>('/assistant', { question: ask.question, intent: ask.intent, location_id: place, lang });
      setMsgs((m) => [...m, { id: nextId.current++, role: 'assistant', text: d.text, sources: d.sources, basis: d.basis, action: d.action }]);
      if (readAloud) speak(d.text.replace(/\*\*/g, ''), lang);
    } catch {
      setMsgs((m) => [...m, { id: nextId.current++, role: 'assistant', text: t('citizen.saathi_error', { lng: lang }) }]);
    } finally {
      setBusy(false);
    }
  }, [busy, place, lang, readAloud, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback((ask?: Ask) => {
    setOpen(true);
    if (ask) queued.current = ask;
  }, []);

  // Questions passed to open() are sent once the panel is showing.
  useEffect(() => {
    if (!isOpen) return;
    input.current?.focus();
    if (queued.current) { const a = queued.current; queued.current = null; send(a); }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setOpen(false);
    setEmergency(false);
    rec.current?.stop();
    stopSpeaking();
    setTimeout(() => fab.current?.focus(), 0);
  };

  // Open a page an answer offers, and move the panel out of the way so the person sees it.
  const go = (path: string) => { navigate(withPane(path)); close(); };
  const BTN = 'inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[14px] font-bold';
  const actionRow = (a: Action) => {
    if (a.type === 'route_check') {
      const from = placeName(locations[a.from], lang) || a.from;
      const to = placeName(locations[a.to], lang) || a.to;
      return (
        <button type="button" onClick={() => go(`/citizen/roads/check?from=${encodeURIComponent(a.from)}&to=${encodeURIComponent(a.to)}`)} className={`${BTN} bg-[#17392b] text-white hover:bg-[#21503c]`}>
          <RouteIcon size={16} aria-hidden />{T('citizen.saathi_check_road', { from, to })}
        </button>
      );
    }
    const report = () => go(`/citizen/report${a.report_type ? `?type=${encodeURIComponent(a.report_type)}` : ''}`);
    if (!a.ask_danger) {
      return <button type="button" onClick={report} className={`${BTN} bg-[#17392b] text-white hover:bg-[#21503c]`}><Megaphone size={16} aria-hidden />{T('citizen.saathi_open_report')}</button>;
    }
    // One question at a time: danger first, then the report form (which asks one thing per step).
    return (
      <div className="rounded-2xl border border-[#e3ebe3] bg-white p-3">
        <p className="font-bold">{T('citizen.saathi_danger_q')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => setEmergency(true)} className={`${BTN} bg-risk-critical text-white`}><Phone size={16} aria-hidden />{T('citizen.saathi_danger_yes')}</button>
          <button type="button" onClick={report} className={`${BTN} border border-[#cfe0d2] bg-white text-[#17392b] hover:bg-[#e8f3ed]`}><Megaphone size={16} aria-hidden />{T('citizen.saathi_danger_no')}</button>
        </div>
      </div>
    );
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    send({ question: text, label: text });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const toggleVoice = () => {
    if (listening) { rec.current?.stop(); setListening(false); return; }
    const Ctor = SpeechRecognitionCtor();
    if (!Ctor) { setNotice(T('citizen.saathi_no_voice')); return; }
    const r = new Ctor();
    r.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (ev) => { const said = ev.results[0]?.[0]?.transcript?.trim(); if (said) send({ question: said, label: said }); };
    r.onend = () => setListening(false);
    r.onerror = () => { setListening(false); setNotice(T('citizen.saathi_not_heard')); };
    rec.current = r;
    setNotice(null);
    setListening(true);
    r.start();
  };

  const greeting = T('citizen.saathi_greeting');

  return (
    <SaathiCtx.Provider value={{ open }}>
      {children}

      {isOpen && (
        <section role="dialog" aria-modal="false" aria-labelledby="saathi-title" lang={lang}
          onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
          className="saathi-panel fixed z-[60] inset-x-2 bottom-2 top-[7vh] flex flex-col overflow-hidden rounded-[24px] border border-[#d9e5da] bg-[#fbfcf8] text-[#1d2b24] shadow-[0_24px_80px_rgba(24,53,38,0.28)]
            sm:inset-x-auto sm:left-6 sm:bottom-6 sm:top-auto sm:h-[min(640px,calc(100vh-3rem))] sm:w-[420px]">
          <header className="bg-[#17392b] px-4 py-3.5 text-white">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#f4c993] text-[#49311f]" aria-hidden><Sparkles size={19} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#bcd7c0]">{T('citizen.saathi_name')}</p>
                <h2 id="saathi-title" className="text-lg font-bold leading-tight">{T('citizen.saathi_title')}</h2>
              </div>
              <button type="button" onClick={close} className="grid h-11 w-11 place-items-center rounded-full text-[#cfe3d1] hover:bg-white/10" aria-label={T('citizen.saathi_close')}>
                <X size={20} aria-hidden />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="flex min-h-[40px] items-center gap-2 rounded-full bg-white/10 px-3 text-[13px] font-bold">
                <Languages size={15} aria-hidden />
                <span className="sr-only">{T('citizen.saathi_lang')}</span>
                <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="bg-transparent text-white outline-none">
                  <option value="en" className="text-[#17392b]">English</option>
                  <option value="hi" className="text-[#17392b]">हिन्दी</option>
                </select>
              </label>
              <button type="button" onClick={toggleVoice} aria-pressed={listening}
                className={`flex min-h-[40px] items-center gap-2 rounded-full px-3 text-[13px] font-bold ${listening ? 'bg-[#f4c993] text-[#49311f]' : 'bg-white/10 hover:bg-white/15'}`}>
                {listening ? <MicOff size={15} aria-hidden /> : <Mic size={15} aria-hidden />}
                {listening ? T('citizen.saathi_listening') : T('citizen.saathi_speak')}
              </button>
              <button type="button" onClick={() => { setReadAloud((v) => !v); stopSpeaking(); }} aria-pressed={readAloud}
                className={`flex min-h-[40px] items-center gap-2 rounded-full px-3 text-[13px] font-bold ${readAloud ? 'bg-[#f4c993] text-[#49311f]' : 'bg-white/10 hover:bg-white/15'}`}>
                {readAloud ? <Volume2 size={15} aria-hidden /> : <VolumeX size={15} aria-hidden />}
                {readAloud ? T('citizen.saathi_voice_on') : T('citizen.saathi_read')}
              </button>
            </div>
          </header>

          <div className="flex items-center gap-2 border-b border-[#e3ebe3] bg-[#f3f7f1] px-4 py-2 text-[13px]">
            <MapPin size={15} className="shrink-0 text-[#2d765b]" aria-hidden />
            <label htmlFor="saathi-place" className="font-semibold text-[#476350]">{T('citizen.saathi_place')}</label>
            <select id="saathi-place" value={place || ''} onChange={(e) => setPlaceId(e.target.value || null)}
              className="min-w-0 flex-1 rounded-lg border border-[#d9e5da] bg-white px-2 py-1.5 font-semibold text-[#1d2b24]">
              {!place && <option value="">{T('citizen.saathi_pick_place')}</option>}
              {places.map((l) => <option key={l.id} value={l.id}>{placeName(l, lang)}</option>)}
            </select>
          </div>

          {/* Danger: the emergency screen replaces the chat until "Back to chat". */}
          {emergency ? (
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <EmergencyCard district={placeLoc?.district ?? null} T={T} onBack={() => { setEmergency(false); stopSpeaking(); setTimeout(() => input.current?.focus(), 0); }}>
                {placeLoc && <SafePlace from={placeLoc} T={T} lang={lang} tone="saathi" />}
              </EmergencyCard>
            </div>
          ) : (<>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" role="log" aria-live="polite" aria-relevant="additions" aria-label={T('citizen.saathi_title')}>
            <Bubble role="assistant"><Rich text={greeting} /></Bubble>
            {msgs.map((m, i) => (
              <div key={m.id} ref={i === msgs.length - 1 ? lastMsg : undefined} className="scroll-mt-2">
                <Bubble role={m.role}>{m.role === 'assistant' ? <Rich text={m.text} /> : m.text}</Bubble>
                {m.role === 'assistant' && <SourceLine sources={m.sources} basis={m.basis} T={T} lang={lang} />}
                {m.role === 'assistant' && m.action && <div className="mt-2 pl-9">{actionRow(m.action)}</div>}
              </div>
            ))}
            {busy && (
              <Bubble role="assistant">
                <span className="inline-flex items-center gap-2 text-[#476350]"><Loader2 size={16} className="animate-spin" aria-hidden />{T('citizen.saathi_thinking')}</span>
              </Bubble>
            )}
            {/* Before the first question: the full list of suggestions. */}
            {msgs.length === 0 && !busy && (
              <div className="pt-1">
                <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[#7a8d80]">{T('citizen.saathi_suggest')}</p>
                <div className="flex flex-wrap gap-2">
                  {SAATHI_PROMPTS.map((k) => (
                    <button key={k} type="button" onClick={() => send({ intent: k, label: T(`citizen.q_${k}`) })} className={CHIP}>
                      {T(`citizen.q_${k}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div ref={logEnd} />
          </div>

          {/* After that: one scrollable row, so the newest answer stays in view. */}
          {msgs.length > 0 && (
            <div className="flex gap-2 overflow-x-auto border-t border-[#e3ebe3] bg-[#f3f7f1] px-3 py-2" role="group" aria-label={T('citizen.saathi_suggest')}>
              {SAATHI_PROMPTS.map((k) => (
                <button key={k} type="button" disabled={busy} onClick={() => send({ intent: k, label: T(`citizen.q_${k}`) })}
                  className={`${CHIP} shrink-0 whitespace-nowrap disabled:opacity-50`}>
                  {T(`citizen.q_${k}`)}
                </button>
              ))}
            </div>
          )}

          {notice && <p className="mx-4 mb-2 rounded-lg bg-[#fff3df] px-3 py-2 text-[13px] text-[#7a4a12]" role="alert">{notice}</p>}

          <form onSubmit={submit} className="flex items-end gap-2 border-t border-[#e3ebe3] bg-white px-3 py-3">
            <label htmlFor="saathi-input" className="sr-only">{T('citizen.saathi_input')}</label>
            <textarea id="saathi-input" ref={input} rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
              placeholder={T('citizen.saathi_input')}
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-[#d9e5da] bg-[#fbfcf8] px-3.5 py-2.5 text-[16px] text-[#1d2b24] placeholder:text-[#8a9a8f] focus:border-[#2d765b]" />
            <button type="submit" disabled={busy || !draft.trim()} aria-label={T('citizen.saathi_send')}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#d37e4c] text-white hover:bg-[#bf6d3d] disabled:opacity-50">
              {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Send size={18} aria-hidden />}
            </button>
          </form>
          <div className="flex items-center justify-between gap-2 bg-white px-4 pb-3 text-[12px] text-[#6b7d71]">
            <span className="truncate">{placeLoc ? T('citizen.saathi_note', { place: placeName(placeLoc, lang) }) : ''}</span>
            <a href="tel:112" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-risk-critical px-3 py-1.5 font-bold text-white">
              <Phone size={13} aria-hidden />{T('citizen.saathi_danger')}
            </a>
          </div>
          </>)}
        </section>
      )}

      {!isOpen && (
        <button ref={fab} type="button" onClick={() => open()} aria-haspopup="dialog" aria-label={t('citizen.saathi_open_label')}
          className="saathi-fab fixed z-40 left-4 bottom-24 md:bottom-6 inline-flex min-h-[52px] items-center gap-2 rounded-full bg-[#d37e4c] px-5 text-[15px] font-bold text-white shadow-[0_12px_28px_rgba(211,126,76,0.38)] transition hover:-translate-y-0.5 hover:bg-[#bf6d3d]">
          <MessageCircle size={20} aria-hidden />{t('citizen.saathi_open')}
        </button>
      )}
    </SaathiCtx.Provider>
  );
}

/** Where an answer's facts came from and when they were last updated, under the bubble. Nothing for general advice. */
function SourceLine({ sources, basis, T, lang }: { sources?: string[]; basis?: Basis; T: (key: string, opts?: Record<string, unknown>) => string; lang: Lang }) {
  const now = useNow(30000);
  if (!basis || !sources?.length) return null;
  const ago = (iso: string | null) => {
    const m = Math.floor((secondsSince(iso, now) ?? 0) / 60);
    return m < 1 ? T('citizen.saathi_ago_now') : m < 60 ? T('citizen.saathi_ago_min', { count: m }) : T('citizen.saathi_ago_h', { count: Math.floor(m / 60) });
  };
  const parts: string[] = [];
  if (sources.includes('risk_model')) {
    parts.push(T(basis.forced ? 'citizen.saathi_src_forced' : 'citizen.saathi_src_model', { time: timeIST(basis.risk_updated_at, lang), ago: ago(basis.risk_updated_at) }));
    if (basis.drill) parts.push(T('citizen.saathi_src_drill'));
  }
  if (sources.includes('forecast')) parts.push(T('citizen.saathi_src_rain', { time: timeIST(basis.weather_fetched_at, lang) }));
  if (sources.includes('roads')) parts.push(T('citizen.saathi_src_roads'));
  return <p className="mt-1 pl-9 text-[12px] leading-snug text-[#6b7d71]">{parts.join(' · ')}</p>;
}

function Bubble({ role, children }: { role: Msg['role']; children: ReactNode }) {
  if (role === 'user') {
    return <div className="flex justify-end"><p className="max-w-[85%] rounded-2xl rounded-br-md bg-[#17392b] px-3.5 py-2.5 text-[15px] leading-relaxed text-white">{children}</p></div>;
  }
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-[#e8f3ed] text-[#2d765b]" aria-hidden><Sparkles size={14} /></span>
      <p className="max-w-[85%] rounded-2xl rounded-tl-md border border-[#e3ebe3] bg-white px-3.5 py-2.5 text-[15px] leading-relaxed">{children}</p>
    </div>
  );
}

# Interface languages

| File | Language | Status |
|---|---|---|
| en.json | English | complete (source text) |
| hi.json | Hindi | complete |
| ne.json | Nepali | complete |
| as.json | Assamese | **draft — needs native-speaker review** |
| lus.json | Mizo | **draft — needs native-speaker review** |
| nag.json | Nagamese | **draft — needs native-speaker review** |

The three drafts cover the screens that matter most in an emergency: the citizen home page, the risk map and its
"Why" card (level, time window, reasons, what is exposed, what to do), alerts and the alarm banner, and the report
form. Anything they don't cover falls back to English. Drafts show a small "beta" tag in the language menu.
They also cover Saathi's buttons, emergency screen, offline notes and the first-visit tour; Saathi's answers
themselves come in English or Hindi. The danger words Saathi listens for in these languages (last lines of
`shared/config/emergency.json`) are drafts too.

The plain-language reasons in the Why card ("the soil is soaked", …) live in `shared/config/factors.json`
(`plainAs`, `plainLus`, `plainNag` on each driver).

**Reviewing:** edit the values only, never the keys. Keep `{{placeholders}}` exactly as they are. When a language has
been checked, set `"status"` in its `_meta` block to `"reviewed"` and remove it from `DRAFT_LANGS` in
`client/src/i18n/index.ts`.

**Adding Khasi:** the server already accepts the code `kha` (`server/src/config/languages.js`). Copy `as.json` to
`kha.json`, translate it, add `plainKha` to the drivers in `factors.json`, and register `kha` in
`client/src/i18n/index.ts` (import, `Lang`, `LANGS`, `LANG_NAMES`) and in `PLAIN_KEY` in `client/src/lib/factors.ts`.

Officer-written alert text and place/road names stay in English and Hindi (Nepali readers see Hindi; the others see
English).

# Attention-Sustaining Academic Reader

A local-first study reader that turns lecture PDFs and PowerPoint decks into short,
paced chunks. It runs entirely in the browser: no accounts, no uploads, no server.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173

No demo file? Click **Try a demo PDF** or **Try demo slides** on the upload screen.
Both demo files are bundled in `public/demo`.

## How a session works

1. **Import** a PDF or PPTX (or a demo). Text is extracted, running headers and
   footer page numbers are stripped, and the document is split into chunks of a
   uniform length (~220 words, hard 280-word cap) with real headings, bullet
   lists, and figures captioned by slide/page. Every heading starts a new chunk,
   PPTX slides and PDF exports of slide decks are chunked one page per slide,
   and PDF sections also break on page boundaries . so a chunk never swallows
   several headings or pages. Bullet glyphs extracted inside a heading line are
   split onto their own lines so titles stay short and lists stay readable.
2. **Plan** the session. Pick a reading-time budget (10–45 minutes or a custom
   value) and the planner checks it against the chunks that are actually left,
   shows how many fit, and blocks budgets shorter than a single chunk. "Read
   without a time limit" skips the countdown.
3. **Read** in a slide-sized landscape card (16:9 on laptops/tablets, with its
   own scroll, fit-to-pane figures). A countdown chip tracks the budget; when
   time runs out you can extend by five minutes or finish.
4. **Check in** after every few chunks with a self-explanation prompt. Reading
   much faster than a comfortable pace tightens the interval, and repeated
   skimming opens a pop-up offering a five-minute break or to keep reading.
   Slowing down and back-navigation are also detected and summarised at the end.
5. **Mark** chunks as confusing or important with a note . every mark records
   its chunk number, and the session summary lists them with a jump-back link.
6. **Review** the summary (chunks completed, time per chunk, check-ins, marks)
   and continue reading or return to the library.

## Features

- PDF and PPTX import, chunked on this device
- Uniform chunks (~220 words, hard 280-word maximum) with formatted headings,
  bullets, numbered lists and figures
- One chunk per heading, per slide, and per slide-deck PDF page; PDF sections
  split across pages and long sections split so no chunk overflows
- Runs of page numbers and running headers removed automatically
- Reading goal planner that validates the budget against the remaining chunks,
  with countdown and time-up reminder
- Paced reading with checkpoints and self-explanation prompts
- Skimming detection that tightens checkpoints and opens a break pop-up
- Fatigue detection with a break suggestion on the summary screen
- Annotations (confusing / important) with chunk-aware marks list and jump-to-chunk
- Session summary with resume and next-step options
- Library with resume progress and per-document delete (removes saved chunks,
  sessions and marks from this device)
- Instant-apply preferences (text size, reading font, light/dark, check-in frequency)
- Installable PWA that works offline after the first load

## Offline / PWA

The app registers a service worker in production builds only:

```bash
npm run build
npm run serve
```

Open http://127.0.0.1:4173, then use the browser's Install option. After the first
load the app, library, and demo files work without a network connection.

In development (`npm run dev`) any previously installed service worker is removed
so you always see fresh code.

## Tests

```bash
npm test             # engine regression tests
npm run e2e          # full browser flow against the production build (needs Chrome)
npm run smoke        # browser smoke test on the dev server
npm run smoke:offline # production build served offline
npm run demo         # regenerate the bundled demo files
```

`npm run e2e` serves `dist/`, so run `npm run build` first.

## Project structure

```
src/engines/chunking/   PDF/PPTX detection, text extraction, uniform chunking
src/engines/pacing/     Skimming detection and checkpoint pacing
src/engines/scheduler/  Fatigue detection
src/engines/planner/    Reading goal feasibility
src/engines/reporting/  Session summary
src/storage/db.js       IndexedDB persistence (documents, chunks, sessions, marks)
src/components/         Import, goal planner, reading, checkpoint, summary, settings
scripts/                Demo generator and tests
public/demo/            Bundled demo PDF and PPTX
```

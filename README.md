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

## Features

- PDF and PPTX import, chunked on this device
- Paced reading with checkpoints and self-explanation prompts
- Fatigue and skimming detection
- Annotations (confusing / important marks)
- Reading goal planner
- Session summary and next-step suggestions
- Resume from the library (IndexedDB)
- Preferences (text size, contrast, checkpoint frequency)
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
npm test        # engine regression tests
npm run smoke   # optional browser smoke test (needs Chrome)
npm run demo    # regenerate the bundled demo files
```

## Project structure

```
src/engines/chunking/   PDF/PPTX detection, text extraction, chunking
src/engines/pacing/     Skimming detection and checkpoint pacing
src/engines/scheduler/  Fatigue detection
src/engines/planner/    Reading goal feasibility
src/engines/reporting/  Session summary
src/storage/db.js       IndexedDB persistence
scripts/                Demo generator and tests
public/demo/            Bundled demo PDF and PPTX
```

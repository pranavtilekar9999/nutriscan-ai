# NutriScan AI

An AI-assisted nutrition assistant: scan a barcode or paste an ingredients list
and get an instant, personalized "should I eat this?" verdict.

```
nutriscan-ai/
├── backend/     Express API (auth, product lookup, analysis engine)
│   ├── server.js
│   ├── package.json
│   ├── .env             ← your local secrets (already filled in for you)
│   ├── .env.example      template with no secrets, safe to commit
│   └── data/              JSON "database" — created automatically on first run
└── frontend/     Static site served by the backend
    ├── index.html
    ├── css/style.css
    └── js/script.js
```

## What was fixed

- **"express not found"** — this just meant `npm install` had never been run
  in this project, so the `node_modules/` folder (where `express` lives)
  didn't exist. It's not included in the download — see **Setup** below.
- **`backend/server.js` never loaded `.env`** — `dotenv` was listed as a
  dependency but `require('dotenv').config()` was never called, so `PORT`
  and `AUTH_SECRET` were silently ignored. Added the missing line.
- **`AUTH_SECRET` was a placeholder string** (`your-long-random-secret`) —
  replaced with a real randomly generated secret, since this is what signs
  login tokens.
- **`frontend/css/style.css` and `frontend/js/script.js` didn't exist** —
  `index.html` referenced both, but only the HTML was in the files you
  uploaded, so the site had no styling and none of the buttons (sign in,
  scan, save profile, etc.) worked. Both were written from scratch to match
  the existing HTML and wire up every screen to the backend API:
  navigation, sign in/register, barcode entry, live camera barcode scanning
  (where the browser supports the `BarcodeDetector` API), ingredient
  analysis, the results/verdict view, and the health profile form.
- **Unused `mongodb` dependency removed** from `package.json` — `server.js`
  stores data in local JSON files under `backend/data/`, not MongoDB, so
  the dependency was dead weight. Your `MONGO_URI` is still kept in `.env`
  in case you wire it in later.
- Reorganized into `backend/` and `frontend/` folders (the code already
  expected this layout — `server.js` serves static files from `../frontend`).

## Setup

You'll need [Node.js 18+](https://nodejs.org) installed.

```bash
cd backend
npm install
npm start
```

Open **http://localhost:3000** — the backend serves the frontend directly,
so there's nothing separate to run for the UI.

For development with auto-restart on file changes:

```bash
npm run dev
```

## Notes

- `backend/.env` already contains a real generated `AUTH_SECRET` and your
  `MONGO_URI`. **Don't commit this file** — `.gitignore` excludes it, and
  `.env.example` is there as the safe-to-share template.
- Product/user/profile data lives in `backend/data/*.json` and is created
  automatically the first time the server runs.
- Barcode lookups first check the local cache, then fall back to the live
  [Open Food Facts](https://world.openfoodfacts.org/) catalogue — this
  requires internet access.
- Live camera scanning uses the browser's `BarcodeDetector` API, which
  currently works in Chrome/Edge on desktop and Android; other browsers
  will fall back to manual barcode entry.

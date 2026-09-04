# Mala — Japa Tracker (PWA)

A complete, installable japa/mala tracking app. Everything runs in the browser and saves data **only on your device** (no account, no server).

## What's inside
- `index.html` — the app
- `app.js` — all logic
- `manifest.json` — makes it installable
- `sw.js` — service worker, so it works offline once installed
- `icon-192.png`, `icon-512.png`, `icon-180.png` — app icons

## How to install it on your phone

A PWA has to be served over **https** for "Install app" / full offline support to work — you can't just open the HTML file from your Downloads folder and get the install prompt. The good news: hosting it is free and takes about two minutes.

### Option A — GitHub Pages (recommended, free, keeps your own copy)
1. Create a free GitHub account if you don't have one, and make a new repository (e.g. `mala-app`).
2. Upload all the files in this folder to that repository (drag-and-drop works on github.com).
3. Go to the repo's **Settings → Pages**, set the source to the `main` branch, and save.
4. GitHub gives you a URL like `https://yourname.github.io/mala-app/`. Open that on your phone.

### Option B — Netlify Drop (fastest, no account needed)
1. On a computer, go to **app.netlify.com/drop**.
2. Drag this whole folder onto the page.
3. Netlify gives you a live URL instantly. Open it on your phone.

### Once it's live, add it to your home screen
- **iPhone (Safari):** open the link → tap the Share icon → **Add to Home Screen**.
- **Android (Chrome):** open the link → tap the ⋮ menu → **Install app** (or you'll see an automatic install banner).

After that, it opens full-screen like a native app, works offline, and your data stays on your phone.

## A few honest limitations (since this is a browser app, not a native app)
- **Cloud backup / multi-device sync** isn't included — that needs a real backend and account system. Instead, use **Settings → Backup & Export** to download a JSON backup any time, and restore it on any device. It's a manual sync, but it's dependable and fully private.
- **Reminders** only fire reliably while the app is open or was recently used — a pure web app can't wake your phone the way a native app's push notifications can.
- **Face ID / Touch ID** isn't available to a web app directly, so Privacy uses a simple 4-digit PIN instead.
- **Apple Watch app / home screen widgets** aren't possible from a PWA — those require a native app built in Xcode.

Everything else from your spec — the 108-bead counter, auto mala conversion, targets, calendar history, dashboard, streaks, manual entries, multiple mantras, sankalp goals, stats, and CSV/JSON export — is fully built and working offline.

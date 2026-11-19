# Deal Terms Flashcards

Spaced-repetition flashcards for capital-markets, deal-document, SEC EDGAR and data-platform vocabulary (106 cards in 3 priority tiers). Plain HTML/CSS/JS with no build step, hosted on GitHub Pages. Works the same in mobile and desktop browsers.

## Deploy to GitHub Pages (about 5 minutes)

1. On github.com, click **New repository**. Name it, e.g. `deal-terms-flashcards`, and make it **Public** (free GitHub Pages needs a public repo).
2. On the new repo page, click **uploading an existing file**. Drag in everything from this folder (`index.html`, `style.css`, `app.js`, `.nojekyll`, `README.md`, and the `data` and `tools` folders), then **Commit changes**.
   - Or with git: `git init && git add . && git commit -m "Flashcards v1" && git branch -M main && git remote add origin https://github.com/<you>/deal-terms-flashcards.git && git push -u origin main`
3. Go to **Settings → Pages**. Under *Build and deployment*, set Source = **Deploy from a branch**, Branch = **main**, folder = **/ (root)**, then **Save**.
4. After about a minute the site is live at `https://<you>.github.io/deal-terms-flashcards/`. Bookmark it on each device. On iPhone, use Share → **Add to Home Screen** to get an app icon.

## How studying works

- **Three modes:** term → definition, definition → term, and example → term. The two harder modes unlock for a card after you've rated it Good twice in term → definition. Turn modes on or off in Settings.
- **Ratings:** after you reveal the answer, rate yourself. Same controls everywhere:

  | Rating | Phone | Computer | What happens |
  |---|---|---|---|
  | Again | swipe ← | ← or 1 | back to box 1; you see it again in a few cards |
  | Hard | swipe ↓ | ↓ or 2 | stays in its box; back tomorrow |
  | Good | swipe → | → or 3 | up one box |
  | Easy | swipe ↑ | ↑ or 4 | up two boxes |

  Tap the card, or press Space / Enter, to reveal. Z undoes the last rating; Esc exits. You can also tap the rating buttons.
- **Scheduling:** Leitner boxes with intervals of 1, 2, 4, 7, 14 and 30 days. Every interval is capped so each card comes back at least once before your target date (set in Settings).
- **New cards:** 15 per day by default, introduced Tier 1 first.

## Moving progress between devices

Progress is saved in each browser, so phone and laptop each start separately. To carry progress over:
**Settings → Show export code → Copy** on one device, then **Settings → paste → Import pasted code** on the other. You can also use Download file / Choose file. Import merges: for each card, the most recent review wins, so importing in either direction is safe.

## Editing cards

The cards live in `data/cards.json`. You can edit that file directly; each card has `term`, `definition`, optional `example` and `why`, `topic`, `tier`, plus `definitionMasked` / `exampleMasked`, which are the versions shown in the recall modes with the answer blanked out (`_____`).
`tools/make_cards.py` regenerates the whole file from `tools/raw_cards.json`, and adds tiers, examples and masking.

## Tests

`tools/test_app.py` uses Playwright to run the scheduler checks, the desktop keyboard flow, mobile touch swipes on iPhone sizes, and an export/import round trip:
`pip install playwright && playwright install chromium && python tools/test_app.py`. Set `CHROME=/path/to/chrome` to use an installed Chrome instead.

## Running locally

Browsers block `fetch` from `file://`, so serve the folder: `python3 -m http.server` and open http://localhost:8000.

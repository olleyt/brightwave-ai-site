# TideLearn — adaptive exam-prep demo (BrightWave AI)

One daily session: **Recall → Read → Learn → Check → Results**. Spaced repetition (SM-2, Anki-style 4-button grading with interval previews), review-mode speed reading (RSVP with ORP focus, chunking, sentence replay), comprehension quiz that gates topic pacing, tune-mode mnemonic chants, and a paste-based lesson importer.

## Run locally
Any static server from this folder:
```bash
cd adaptlearn
python3 -m http.server 8080     # then open http://localhost:8080
```
(Opening index.html via file:// also works — storage falls back to in-memory.)

## Deploy to your Netlify site
Copy `index.html`, `styles.css`, `data.js`, `app.js` into a `/learn/` folder in `brightwave-ai-site`, then link it, e.g. from the services grid: `<a href="/learn/">Try our adaptive learning demo →</a>`.

## Architecture decisions (deliberate)
- **No backend.** State lives in a safe storage adapter (localStorage with in-memory fallback). Validates the learning loop before any AWS spend.
- **Scheduler is swappable.** `Scheduler.schedule()` is pure; replace with FSRS later without touching UI.
- **RSVP is a review mode, not a first-exposure mode** — comprehension drops at high WPM and RSVP removes regressions, so it's applied to notes you're revising, with a Full-text toggle, 1–3 word chunking, and `R` sentence replay.
- **Quiz updates topic mastery (pacing); card grades update scheduling.** Recognition and recall signals are kept separate on purpose.
- **Importer** tries the Claude API (works when hosted inside a claude.ai artifact) and falls back to a heuristic generator everywhere else — same output shape.

## Tests (run with node)
```bash
node test-scheduler.js   # SM-2 unit tests
node test-smoke.js       # full-session end-to-end in jsdom (needs: npm i jsdom)
node test-rsvp.js        # live RSVP playback: timing, pause, replay, WPM keys
```

## Playwright checklist (for Claude Code + Playwright MCP)
Ask Claude Code to verify visually what jsdom can't:
1. **Dashboard** at 1280px and 380px — hero card readable, stat row wraps to 2×2 on mobile.
2. **Wave progress** fills left-to-right as phases complete; labels change done/now states.
3. **Flashcard flip** — 3D rotateX animation smooth; grade row hidden until flip.
4. **RSVP focus** — ORP letter is dead-centre horizontally; guides align; no layout jitter between long/short words.
5. **Chunk selector** — switching 1→3 restarts with multi-word flashes (no ORP at chunk>1).
6. **Keyboard** — space (flip/pause), 1–4 (grade), R (replay), ←/→ (WPM) all work; focus ring visible when tabbing.
7. **Tune mode** — click ♪ on "S3 Storage Classes": lines highlight on the bar, audio plays kick+hat, close stops audio.
8. **Quiz** — wrong answer marks red and reveals green correct + explanation.
9. **Results** — 100% quiz shows "The tide is with you"; failing a topic shows "re-queued".
10. **Import** — paste ≥40 words → topic appears under Topics with "(imported)"; next session's Read phase includes it.
11. **Persistence** — reload mid-progress: streak, mastery, due counts survive (on http://, not file://).
12. **Reduced motion** — with `prefers-reduced-motion`, no flip/rise animations.

## Known limits / next iterations
- Quiz questions aren't generated for imported topics (heuristic path) — Claude path does generate; wire your API key or run inside claude.ai.
- Tune mode has 2 hand-written chants; production path = Claude writes lyrics from the note + Web Audio beat (already scaffolded).
- FSRS upgrade, exam-date setting UI, and per-topic analytics are the obvious next three.

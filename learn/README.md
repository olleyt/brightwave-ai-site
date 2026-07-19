# TideLearn — adaptive exam-prep demo (BrightWave AI)

One daily session: **Recall → Read → Learn → Check → Results**. Spaced repetition (SM-2, Anki-style 4-button grading with interval previews), review-mode speed reading (RSVP with ORP focus, chunking, sentence replay), comprehension quiz that gates topic pacing, tune-mode mnemonic chants, and a lesson importer available both as a GUI screen and a CLI/subagent pipeline.

## Run locally
Any static server from this folder:
```bash
cd adaptlearn
python3 -m http.server 8080     # then open http://localhost:8080
```
(Opening index.html via file:// also works — storage falls back to in-memory.)

## Deploy to your Netlify site
Copy `index.html`, `styles.css`, `data.js`, `app.js` into a `/learn/` folder in `brightwave-ai-site`, then link it, e.g. from the services grid: `<a href="/learn/">Try our adaptive learning demo →</a>`.

To get real Claude-generated cards (not the heuristic fallback) out of the Import screen, set an `ANTHROPIC_API_KEY` environment variable on the Netlify site (Site configuration → Environment variables) — `netlify/functions/generate-topic.mjs` reads it server-side; the key never reaches the browser. Without it configured, the Import screen still works via the heuristic generator.

## Building cards from documents (CLI, subagent, skill)
Beyond the in-app paste-a-lesson screen, there's a repeatable pipeline for turning documents into permanent, site-wide topics in `learn/custom-topics.js`:

- **`node tools/import-doc.mjs <url-or-file> [--title "..."] [--dry-run]`** — the mechanical single-topic path. Accepts a `http(s)://` URL or a local file: `.html`/`.htm`, `.md`/`.txt` for Notion/Obsidian exports and plain notes, or `.pdf` (text-layer extraction only — a scanned/image-only PDF won't yield usable text). `--dry-run` previews the extracted title/text without calling Claude or writing anything.
- **`node tools/import-doc.mjs --apply <topics.json>`** — takes one topic object or a JSON array of them (already fully drafted, e.g. by a subagent that read the whole source itself) and mechanically validates, assigns collision-safe ids, appends into `learn/custom-topics.js`, and bumps the cache version. No Claude call in this mode.
- **`card-builder` subagent** (`.claude/agents/card-builder.md`) — reads a single source in full (local file, URL, or a Notion page via the Notion MCP tools) itself, exercises judgment on topic boundaries and card quality, then calls `--apply` to commit. Returns only a compact summary (names, counts, a couple of sample cards) — never the full source or full card list.
- **`cards-from-docs` skill** (`.claude/skills/cards-from-docs/SKILL.md`) — orchestrates a batch of sources against the `card-builder` subagent, one dispatch per source, so a whole batch's source text never has to live in the main conversation. Run `/cards-from-docs`.

Shared logic (schema, extraction, id generation, validation) lives in `tools/lib/topic.mjs` and is used by both the CLI and `netlify/functions/generate-topic.mjs` (the GUI's backend), so the two paths stay in sync.

## Architecture decisions (deliberate)
- **No backend for state.** Topic/card/schedule state lives in a safe storage adapter (localStorage with in-memory fallback). Validates the learning loop before any AWS spend. The one server-side piece, `netlify/functions/generate-topic.mjs`, exists only to keep the Anthropic API key off the client — it returns topic JSON, it doesn't persist anything.
- **Scheduler is swappable.** `Scheduler.schedule()` is pure; replace with FSRS later without touching UI.
- **RSVP is a review mode, not a first-exposure mode** — comprehension drops at high WPM and RSVP removes regressions, so it's applied to notes you're revising, with a Full-text toggle, 1–3 word chunking, and `R` sentence replay.
- **Quiz updates topic mastery (pacing); card grades update scheduling.** Recognition and recall signals are kept separate on purpose.
- **Importer (GUI)** calls `netlify/functions/generate-topic.mjs` and falls back to a heuristic generator when that's unreachable (e.g. a plain static server locally, or the env var isn't set yet) — same output shape either way. GUI imports save to the visiting browser's local storage only; use the CLI/subagent/skill above (or the Import screen's "Copy topic JSON" + `--apply`) to make a topic permanent and visible to every visitor.

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
- Quiz questions aren't generated for imported topics on the heuristic path (no `ANTHROPIC_API_KEY` configured, or the function is unreachable) — set the env var on Netlify (see Deploy section above) to get the real Claude path, which does generate a quiz.
- Tune mode has 2 hand-written chants; production path = Claude writes lyrics from the note + Web Audio beat (already scaffolded).
- FSRS upgrade, exam-date setting UI, and per-topic analytics are the obvious next three.

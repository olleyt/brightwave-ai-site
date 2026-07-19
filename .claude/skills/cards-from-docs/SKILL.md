---
name: cards-from-docs
description: Turn a batch of documents, local files (markdown, text, HTML, PDF), URLs, or Notion pages into TideLearn study topics (note + flashcards + quiz) in learn/custom-topics.js, one at a time, without loading full source text into the main conversation. Use when the user wants to build study cards from notes — from Notion, Obsidian, plain files, PDFs, or web docs — for the /learn app, especially across several sources or anything long enough to matter for context size.
---

# cards-from-docs

Orchestrates a batch of sources against the `card-builder` subagent so that the full text of any document only ever lives inside that subagent's own context — this conversation holds nothing bigger than a compact summary and the final JSON that lands in `learn/custom-topics.js`.

**Don't `Read`/`WebFetch` a source directly in the main conversation "just to check it" before dispatching** — that defeats the entire point. If a source is worth running through this skill at all, its full text belongs in the subagent's context only, never here.

## Protocol

1. **Collect the batch.** Ask the user (if not already given) for the sources for this batch: local file paths, URLs, or Notion page/database references. A batch is whatever set of sources they want processed before the next `/clear`.

2. **One `card-builder` dispatch per source.** For each source, launch the `card-builder` subagent (`Agent` tool, `subagent_type: card-builder`) with a self-contained prompt that:
   - Names the exact source (path, URL, or Notion reference) — the subagent has no memory of this conversation.
   - Restates the return contract: compact summary only (topic names, card/quiz counts, 1-2 sample cards, test result) — never the full source or full card list.
   - If a source obviously covers multiple distinct subtopics, tell the subagent it's fine to split it into multiple topics in one pass.

3. **Relay, don't re-derive.** When a subagent returns, pass its compact summary straight to the user. Don't re-fetch the source or re-print anything the subagent already condensed — that defeats the point of delegating.

4. **Close out the batch.** Once all sources in the batch are done:
   - Remind the user to run `git diff learn/custom-topics.js` before committing — nothing here auto-commits, matching the file's own header comment ("review before committing").
   - Suggest `/clear` before starting the next batch, so each batch's subagent transcripts don't accumulate in this conversation's context.

## GUI counterpart

The deployed `/learn` Import screen (paste text or a URL) hits `netlify/functions/generate-topic.mjs`, which uses the same shared logic (`tools/lib/topic.mjs`) and schema as this pipeline — but it only saves into the visiting browser's local storage, not into `learn/custom-topics.js`. If someone wants a GUI-drafted topic to become permanent and visible to every visitor, they can copy its JSON (via the Import screen's "Copy topic JSON" action) and run `node tools/import-doc.mjs --apply <file>` — the same mechanical step this skill uses.

## When not to use this

For a single, small, single-topic source where you're confident no judgment/splitting is needed — including a short PDF — it's simpler to just run `node tools/import-doc.mjs <url-or-file>` directly (or `--dry-run` first to preview extraction) — no need to spin up a subagent for that, and it costs zero conversation context either way since the script runs standalone.

For a **long** source (a multi-page PDF, a long article, anything you're not confident fits in one clean topic), always route it through the `card-builder` subagent instead — `--dry-run`'s extraction preview is capped at 8000 characters and will silently truncate anything longer, which is exactly the failure mode this skill exists to avoid.

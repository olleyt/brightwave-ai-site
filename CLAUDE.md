# CLAUDE.md

## Building TideLearn study cards from documents

This repo has a repeatable pipeline for turning documents/URLs/Notion pages into TideLearn topics (`learn/custom-topics.js`): the `card-builder` subagent (`.claude/agents/card-builder.md`) and the `cards-from-docs` skill (`.claude/skills/cards-from-docs/SKILL.md`) that batches sources against it.

**Never `Read`/`WebFetch` a document yourself in the main conversation to draft study cards from it — always delegate.**

- A batch of sources, or anything long/uncertain (a multi-page PDF, a long article, anything you're not sure fits one topic) → invoke the `cards-from-docs` skill, which dispatches `card-builder` once per source.
- A single, short, single-topic source where no judgment/splitting is needed → run `node tools/import-doc.mjs <url-or-file>` directly (or `--dry-run` first). This is fine without a subagent because it's a standalone Node process — it never touches your conversation context.
- What's **not** fine: opening the source yourself "just to take a quick look" before deciding, or drafting/editing cards inline from content you read directly. That's exactly the failure mode this pipeline exists to prevent — full document text belongs in the subagent's isolated context (or nowhere, in the script-only path), never in the main conversation.

See `learn/README.md` ("Building cards from documents") for the full pipeline reference.

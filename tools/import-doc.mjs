#!/usr/bin/env node
/* Local-only importer: turns a URL or a local file (markdown/text/html) into a
   TideLearn topic (note + flashcards + quiz) with Claude, and appends it to
   learn/custom-topics.js. The API key never leaves this machine — the deployed
   site stays fully static.

   Usage:
     node tools/import-doc.mjs <url-or-file> [--title "Topic Title"] [--dry-run]
     node tools/import-doc.mjs --apply <topics.json>
     npm run import-doc -- <url-or-file>

   --apply takes a JSON file with one topic object or an array of them (already
   fully drafted — e.g. by the card-builder subagent) and mechanically validates,
   ids, and writes them in, with no Claude call.

   Auth: ANTHROPIC_API_KEY env var, or an `ant auth login` profile.
   Model: CLAUDE_MODEL env var (default claude-opus-4-8). */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractFromHtml,
  extractFromText,
  generateTopic,
  slugId,
  buildTopic,
  validateTopic,
  isTooShort,
} from "./lib/topic.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const topicsFile = path.join(here, "..", "learn", "custom-topics.js");

/* ---------- custom-topics.js read/write ---------- */

function readTopics() {
  const src = fs.readFileSync(topicsFile, "utf8");
  const m = src.match(/\/\* BEGIN-TOPICS \*\/([\s\S]*?)\/\* END-TOPICS \*\//);
  if (!m) throw new Error(`Markers not found in ${topicsFile}`);
  return { src, topics: JSON.parse(m[1]) };
}

function writeTopics(src, topics) {
  const updated = src.replace(
    /\/\* BEGIN-TOPICS \*\/[\s\S]*?\/\* END-TOPICS \*\//,
    `/* BEGIN-TOPICS */${JSON.stringify(topics, null, 2)}/* END-TOPICS */`
  );
  fs.writeFileSync(topicsFile, updated);
}

/* Appends one or more topics, repairing missing/colliding ids against what's
   already in the file (and against each other, within this batch). */
function appendTopics(newTopics) {
  const { src, topics } = readTopics();
  const existingIds = topics.map((t) => t.id);
  for (const topic of newTopics) {
    if (!topic.id || existingIds.includes(topic.id)) {
      topic.id = slugId(topic.name, existingIds);
    }
    existingIds.push(topic.id);
    topics.push(topic);
  }
  writeTopics(src, topics);
}

/* Bump the ?v= cache-busting query on the learn assets so new topics
   show up without a hard refresh on already-visited devices. */
function bumpCacheVersion() {
  const indexFile = path.join(here, "..", "learn", "index.html");
  let html = fs.readFileSync(indexFile, "utf8");
  const current = Number(html.match(/\?v=(\d+)/)?.[1] || 1);
  html = html.replace(/\?v=\d+/g, `?v=${current + 1}`);
  fs.writeFileSync(indexFile, html);
  return current + 1;
}

/* ---------- --apply mode: mechanical validate + write, no Claude call ---------- */

async function runApply(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    console.error(`File not found: ${jsonPath}`);
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const topics = Array.isArray(parsed) ? parsed : [parsed];
  if (topics.length === 0) {
    console.error(`No topics found in ${jsonPath}`);
    process.exit(1);
  }
  for (const topic of topics) validateTopic(topic);

  appendTopics(topics);
  const v = bumpCacheVersion();

  for (const t of topics) {
    console.log(`Added "${t.name}" (${t.id}) — ${t.cards.length} cards, ${t.quiz.length} quiz questions.`);
  }
  console.log(`Bumped asset cache version to v=${v}.`);
  console.log(`Review learn/custom-topics.js, then commit and push to publish it to your sites.`);
}

/* ---------- full pipeline mode: fetch/read -> generate -> append ---------- */

async function readSource(input, titleArg) {
  if (/^https?:\/\//.test(input)) {
    const res = await fetch(input, { headers: { "User-Agent": "TideLearn-importer" } });
    if (!res.ok) {
      console.error(`Fetch failed: ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    return extractFromHtml(await res.text(), titleArg);
  }
  if (!fs.existsSync(input)) {
    console.error(`File not found: ${input}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(input, "utf8");
  const ext = path.extname(input).toLowerCase();
  return ext === ".html" || ext === ".htm" ? extractFromHtml(raw, titleArg) : extractFromText(raw, titleArg);
}

async function runPipeline(input, titleArg, dryRun) {
  const { title, text } = await readSource(input, titleArg);

  if (isTooShort(text)) {
    console.error("Extracted less than 40 words — this source may be too short or script-rendered. Copy-paste into the app's Import screen instead.");
    process.exit(1);
  }

  if (dryRun) {
    console.log(`Title: ${title}\n\n${text}`);
    return;
  }

  const generated = await generateTopic({ title, text });
  const topic = buildTopic(null, title, generated);
  appendTopics([topic]);
  const v = bumpCacheVersion();

  console.log(`\nAdded "${topic.name}" — ${topic.cards.length} cards, ${topic.quiz.length} quiz questions.`);
  console.log(`Bumped asset cache version to v=${v}.`);
  console.log(`Review learn/custom-topics.js, then commit and push to publish it to your sites.`);
}

/* ---------- main ---------- */

const USAGE = `Usage:
  node tools/import-doc.mjs <url-or-file> [--title "Topic Title"] [--dry-run]
  node tools/import-doc.mjs --apply <topics.json>`;

const args = process.argv.slice(2);
const applyIdx = args.indexOf("--apply");

if (applyIdx !== -1) {
  const jsonPath = args[applyIdx + 1];
  if (!jsonPath) {
    console.error(USAGE);
    process.exit(1);
  }
  await runApply(jsonPath);
} else {
  const dryRun = args.includes("--dry-run");
  const titleIdx = args.indexOf("--title");
  const titleArg = titleIdx !== -1 ? args[titleIdx + 1] : null;
  const input = args.filter((a, i) => a !== "--dry-run" && a !== "--title" && (titleIdx === -1 || i !== titleIdx + 1))[0];
  if (!input) {
    console.error(USAGE);
    process.exit(1);
  }
  await runPipeline(input, titleArg, dryRun);
}

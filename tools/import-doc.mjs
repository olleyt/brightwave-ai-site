#!/usr/bin/env node
/* Local-only importer: fetches a documentation URL, generates a TideLearn topic
   (note + flashcards + quiz) with Claude, and appends it to learn/custom-topics.js.
   The API key never leaves this machine — the deployed site stays fully static.

   Usage:
     node tools/import-doc.mjs <url> [--title "Topic Title"] [--dry-run]
     npm run import-doc -- <url>

   Auth: ANTHROPIC_API_KEY env var, or an `ant auth login` profile.
   Model: CLAUDE_MODEL env var (default claude-opus-4-8). */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const titleIdx = args.indexOf("--title");
const titleArg = titleIdx !== -1 ? args[titleIdx + 1] : null;
const url = args.find((a) => /^https?:\/\//.test(a));

if (!url) {
  console.error("Usage: node tools/import-doc.mjs <url> [--title \"Topic Title\"] [--dry-run]");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const topicsFile = path.join(here, "..", "learn", "custom-topics.js");

/* ---------- fetch & extract ---------- */

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<(?:aside|footer|header)[\s\S]*?<\/(?:aside|footer|header)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;|&\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extract(html) {
  // AWS docs put the article in #main-col-body. Nested divs make matching the exact
  // closing tag unreliable, so take everything from the marker on and trim the tail.
  const markers = [/<div[^>]+id="main-col-body"[^>]*>/i, /<main[\s\S]*?>/i, /<body[\s\S]*?>/i];
  let container = html;
  for (const m of markers) {
    const hit = html.match(m);
    if (hit) { container = html.slice(hit.index + hit[0].length); break; }
  }
  let text = stripTags(container);
  for (const tail of ["Javascript is disabled", "Did this page help you", "Discover highly rated pages"]) {
    const i = text.indexOf(tail);
    if (i > 200) text = text.slice(0, i);
  }
  const title =
    titleArg ||
    stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "") ||
    stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") ||
    "Imported topic";
  return { title, text: text.slice(0, 8000) };
}

/* ---------- topic generation ---------- */

const TOPIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["keyConcept", "points", "mnemonic", "cards", "quiz"],
  properties: {
    keyConcept: { type: "string", description: "One sentence capturing the core idea" },
    points: { type: "array", items: { type: "string" }, description: "4-6 short factual sentences" },
    mnemonic: { type: "string", description: "One vivid memory trigger" },
    cards: {
      type: "array",
      description: "4-6 flashcards",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["front", "back"],
        properties: { front: { type: "string" }, back: { type: "string" } },
      },
    },
    quiz: {
      type: "array",
      description: "3-4 multiple-choice questions",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["q", "opts", "a", "explain"],
        properties: {
          q: { type: "string" },
          opts: { type: "array", items: { type: "string" }, description: "Exactly 4 options" },
          a: { type: "integer", description: "0-based index of the correct option" },
          explain: { type: "string", description: "One-sentence explanation of the answer" },
        },
      },
    },
  },
};

async function generate(title, text) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const model = process.env.CLAUDE_MODEL || "claude-opus-4-8";
  console.log(`Generating topic with ${model}…`);
  const response = await client.messages.create({
    model,
    max_tokens: 3000,
    output_config: { format: { type: "json_schema", schema: TOPIC_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Turn this documentation page into spaced-repetition study material for an exam-prep app.
Write 4-6 factual points, 4-6 flashcards testing distinct facts, and 3-4 multiple-choice questions with plausible distractors (exactly 4 options each, "a" = 0-based index of the correct one).

Title: ${title}

Content:
${text}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") {
    throw new Error("The model declined this content (stop_reason: refusal).");
  }
  const raw = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(raw);
}

/* ---------- write back ---------- */

function slugId(title) {
  return "custom-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) + "-" + Date.now().toString(36);
}

function appendTopic(topic) {
  const src = fs.readFileSync(topicsFile, "utf8");
  const m = src.match(/\/\* BEGIN-TOPICS \*\/([\s\S]*?)\/\* END-TOPICS \*\//);
  if (!m) throw new Error(`Markers not found in ${topicsFile}`);
  const topics = JSON.parse(m[1]);
  topics.push(topic);
  const updated = src.replace(
    /\/\* BEGIN-TOPICS \*\/[\s\S]*?\/\* END-TOPICS \*\//,
    `/* BEGIN-TOPICS */${JSON.stringify(topics, null, 2)}/* END-TOPICS */`
  );
  fs.writeFileSync(topicsFile, updated);
}

/* Bump the ?v= cache-busting query on the learn assets so the new topic
   shows up without a hard refresh on already-visited devices. */
function bumpCacheVersion() {
  const indexFile = path.join(here, "..", "learn", "index.html");
  let html = fs.readFileSync(indexFile, "utf8");
  const current = Number(html.match(/\?v=(\d+)/)?.[1] || 1);
  html = html.replace(/\?v=\d+/g, `?v=${current + 1}`);
  fs.writeFileSync(indexFile, html);
  return current + 1;
}

/* ---------- main ---------- */

const res = await fetch(url, { headers: { "User-Agent": "TideLearn-importer" } });
if (!res.ok) {
  console.error(`Fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const { title, text } = extract(await res.text());

if (text.split(/\s+/).length < 40) {
  console.error("Extracted less than 40 words — this page may be script-rendered. Copy-paste into the app's Import screen instead.");
  process.exit(1);
}

if (dryRun) {
  console.log(`Title: ${title}\n\n${text}`);
  process.exit(0);
}

const generated = await generate(title, text);
const topic = {
  id: slugId(title),
  name: title,
  note: { keyConcept: generated.keyConcept, points: generated.points, mnemonic: generated.mnemonic },
  cards: generated.cards,
  quiz: generated.quiz,
};
appendTopic(topic);
const v = bumpCacheVersion();

console.log(`\nAdded "${topic.name}" — ${topic.cards.length} cards, ${topic.quiz.length} quiz questions.`);
console.log(`Bumped asset cache version to v=${v}.`);
console.log(`Review learn/custom-topics.js, then commit and push to publish it to your sites.`);

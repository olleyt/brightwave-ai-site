/* Server-side counterpart to tools/import-doc.mjs, for the /learn Import screen.
   Runs the same extraction + Claude generation as the CLI (shared via
   tools/lib/topic.mjs) but returns the topic JSON to the browser instead of
   writing to learn/custom-topics.js — the deployed site stays static, and the
   browser decides what to do with the result (today: add to local storage).

   ANTHROPIC_API_KEY must be set as a Netlify site environment variable.
   It is read server-side only and never reaches the client. */

import { extractFromHtml, extractFromText, generateTopic, buildTopic, validateTopic, slugId, isTooShort } from "../../tools/lib/topic.mjs";

const MAX_BODY_BYTES = 200_000;
const GENERATE_TIMEOUT_MS = 20_000;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "Request body too large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  let extracted;
  try {
    if (typeof body.url === "string" && body.url) {
      if (!/^https?:\/\//.test(body.url)) return json({ error: "url must be http(s)" }, 400);
      const res = await fetch(body.url, { headers: { "User-Agent": "TideLearn-importer" } });
      if (!res.ok) return json({ error: `Fetch failed: ${res.status} ${res.statusText}` }, 502);
      extracted = extractFromHtml(await res.text(), body.title);
    } else if (typeof body.text === "string" && body.text) {
      extracted = extractFromText(body.text, body.title);
    } else {
      return json({ error: "Provide either { url } or { title, text }" }, 400);
    }
  } catch {
    return json({ error: "Could not extract text from that source" }, 400);
  }

  if (isTooShort(extracted.text)) {
    return json({ error: "That source has less than ~40 words of usable content." }, 422);
  }

  let generated;
  try {
    generated = await withTimeout(
      generateTopic({ title: extracted.title, text: extracted.text }),
      GENERATE_TIMEOUT_MS,
      "Card generation timed out"
    );
  } catch {
    return json({ error: "Card generation failed" }, 502);
  }

  const topic = buildTopic(slugId(extracted.title), extracted.title, generated);
  try {
    validateTopic(topic);
  } catch {
    return json({ error: "Generated content failed validation" }, 502);
  }

  return json(topic, 200);
};

/* Shared logic for turning a document into a TideLearn topic
   ({id, name, note, cards, quiz} — see learn/data.js for the shape).
   Used by tools/import-doc.mjs (CLI) and netlify/functions/generate-topic.mjs
   (website Import screen) so both paths stay in sync. No fs/CLI-arg parsing
   here — that stays in the callers. */

export const MAX_CHARS = 8000;
export const MIN_WORDS = 40;

export function isTooShort(text) {
  return text.split(/\s+/).filter(Boolean).length < MIN_WORDS;
}

/* ---------- extraction ---------- */

export function stripTags(html) {
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

/* AWS docs put the article in #main-col-body. Nested divs make matching the exact
   closing tag unreliable, so take everything from the marker on and trim the tail. */
export function extractFromHtml(html, titleOverride) {
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
    titleOverride ||
    stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "") ||
    stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") ||
    "Imported topic";
  return { title, text: text.slice(0, MAX_CHARS) };
}

/* For local markdown/plain-text files (Notion/Obsidian exports). Claude reads
   markdown natively, so this mostly passes content through — it only strips a
   leading YAML frontmatter block and collapses excess blank lines. */
export function extractFromText(raw, titleOverride) {
  let text = raw.replace(/\r\n/g, "\n");
  const frontmatter = text.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
  if (frontmatter) text = text.slice(frontmatter[0].length);
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  const title =
    titleOverride ||
    text.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    text.split("\n").find((l) => l.trim())?.trim() ||
    "Imported topic";
  return { title, text: text.slice(0, MAX_CHARS) };
}

/* For local PDF files. Only pulls text out of the content layer — a scanned/
   image-only PDF will come back empty and fail the isTooShort check upstream. */
export async function extractFromPdf(buffer, titleOverride) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const { text: raw } = await parser.getText();
    const text = (raw || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

    let title = titleOverride;
    if (!title) {
      try {
        const info = await parser.getInfo();
        title = info?.info?.Title?.trim();
      } catch {
        // metadata isn't always present — fall through to text-derived title
      }
    }
    title = title || text.split("\n").find((l) => l.trim())?.trim() || "Imported topic";

    return { title, text: text.slice(0, MAX_CHARS) };
  } finally {
    await parser.destroy();
  }
}

/* ---------- topic generation ---------- */

export const TOPIC_SCHEMA = {
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

export async function generateTopic({ title, text, model, client }) {
  let anthropic = client;
  if (!anthropic) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    anthropic = new Anthropic();
  }
  const useModel = model || process.env.CLAUDE_MODEL || "claude-opus-4-8";
  console.log(`Generating topic with ${useModel}…`);
  const response = await anthropic.messages.create({
    model: useModel,
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

/* ---------- id + assembly ---------- */

export function slugId(title, existingIds = []) {
  const used = new Set(existingIds);
  const base = "custom-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) + "-" + Date.now().toString(36);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function buildTopic(id, title, generated) {
  return {
    id,
    name: title,
    note: { keyConcept: generated.keyConcept, points: generated.points, mnemonic: generated.mnemonic },
    cards: generated.cards,
    quiz: generated.quiz,
  };
}

/* ---------- validation ---------- */

function collectTopicErrors(topic) {
  const errors = [];
  if (!topic || typeof topic !== "object") return ["topic must be an object"];
  // id is optional here — appendTopics() assigns/repairs it mechanically after validation.
  if (topic.id !== undefined && (typeof topic.id !== "string" || !topic.id)) errors.push("id must be a non-empty string if provided");
  if (typeof topic.name !== "string" || !topic.name) errors.push("name must be a non-empty string");

  const note = topic.note;
  if (!note || typeof note !== "object") {
    errors.push("note must be an object");
  } else {
    if (typeof note.keyConcept !== "string" || !note.keyConcept) errors.push("note.keyConcept must be a non-empty string");
    if (!Array.isArray(note.points) || note.points.length === 0 || note.points.some((p) => typeof p !== "string"))
      errors.push("note.points must be a non-empty array of strings");
    if (typeof note.mnemonic !== "string" || !note.mnemonic) errors.push("note.mnemonic must be a non-empty string");
  }

  if (!Array.isArray(topic.cards) || topic.cards.length === 0) {
    errors.push("cards must be a non-empty array");
  } else {
    topic.cards.forEach((c, i) => {
      if (!c || typeof c.front !== "string" || !c.front) errors.push(`cards[${i}].front must be a non-empty string`);
      if (!c || typeof c.back !== "string" || !c.back) errors.push(`cards[${i}].back must be a non-empty string`);
    });
  }

  if (!Array.isArray(topic.quiz)) {
    errors.push("quiz must be an array");
  } else {
    topic.quiz.forEach((q, i) => {
      if (!q || typeof q.q !== "string" || !q.q) errors.push(`quiz[${i}].q must be a non-empty string`);
      if (!q || !Array.isArray(q.opts) || q.opts.length !== 4 || q.opts.some((o) => typeof o !== "string"))
        errors.push(`quiz[${i}].opts must be an array of exactly 4 strings`);
      if (!q || !Number.isInteger(q.a) || q.a < 0 || q.a > 3) errors.push(`quiz[${i}].a must be an integer 0-3`);
      if (!q || typeof q.explain !== "string" || !q.explain) errors.push(`quiz[${i}].explain must be a non-empty string`);
    });
  }

  return errors;
}

export function validateTopic(topic) {
  const errors = collectTopicErrors(topic);
  if (errors.length) {
    throw new Error(`Invalid topic "${topic?.name ?? "?"}":\n  - ${errors.join("\n  - ")}`);
  }
}

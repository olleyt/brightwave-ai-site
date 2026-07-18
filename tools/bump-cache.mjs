#!/usr/bin/env node
/* Bump the ?v= cache-busting query on the /learn assets in index.html so
   already-visited browsers fetch the new files instead of stale cached ones.
   Run after hand-editing learn/app.js, styles.css, custom-topics.js, or data.js. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const indexFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "learn", "index.html");
let html = fs.readFileSync(indexFile, "utf8");
const current = Number(html.match(/\?v=(\d+)/)?.[1] || 1);
const next = current + 1;
html = html.replace(/\?v=\d+/g, `?v=${next}`);
fs.writeFileSync(indexFile, html);
console.log(`Bumped /learn asset cache version: v=${current} → v=${next}`);

/* RSVP playback test: let the engine run on real timers. */
const { JSDOM } = require("jsdom");
const path = require("path");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dom = await JSDOM.fromFile(path.join(__dirname, "..", "learn", "index.html"), {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    beforeParse(w) { w.scrollTo = () => {}; w.fetch = () => Promise.reject(new Error("no net")); }
  });
  const { window } = dom;
  await new Promise(res => window.addEventListener("load", res));
  await sleep(300);
  const doc = window.document;
  const $ = s => doc.querySelector(s);

  // fast-forward to Read phase
  $("#startSessionBtn").click();
  let safety = 40;
  while ($(".card-counter") && $(".card-counter").textContent.includes("Recall") && safety--) {
    if (!$(".flashcard").classList.contains("flipped")) $(".flashcard").click();
    $('.grade-btn[data-grade="good"]').click();
  }
  ok($(".reader") !== null, "reached reader");

  // first item is the key-concept slide
  ok($(".rsvp-slide") !== null, "opens on key-concept slide");
  const slideText = $(".rsvp-slide .slide-text").textContent;

  await sleep(4200); // slide lasts 3600ms → should now be flashing words
  ok($(".rsvp-word") !== null, "advances from slide to words on its own");
  ok($(".rsvp-word .orp") !== null, "ORP letter highlighted at chunk=1");
  const fill1 = parseInt($("#readerFill").style.width) || 0;
  ok(fill1 > 0, `progress fill advancing (${fill1}%)`);

  const wordA = $(".rsvp-word").textContent;
  await sleep(700);
  const wordB = $(".rsvp-word") ? $(".rsvp-word").textContent : "(slide)";
  ok(wordA !== wordB, `words change over time ("${wordA.trim()}" → "${wordB.trim()}")`);

  // space pauses
  doc.dispatchEvent(new window.KeyboardEvent("keydown", { code: "Space", bubbles: true }));
  const frozen = $(".rsvp-word") ? $(".rsvp-word").textContent : null;
  await sleep(800);
  const still = $(".rsvp-word") ? $(".rsvp-word").textContent : null;
  ok(frozen === still, "space pauses playback");

  // R replays current sentence (also resumes)
  doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "r", bubbles: true }));
  await sleep(300);
  ok($(".rsvp-word") !== null || $(".rsvp-slide") !== null, "replay resumes without crashing");

  // arrow keys nudge wpm
  const wpmBefore = Number($("#wpmVal").textContent);
  doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  ok(Number($("#wpmVal").textContent) === wpmBefore + 25, "ArrowRight bumps WPM by 25");

  console.log(fails === 0 ? "\nRSVP PLAYBACK TESTS PASSED" : `\n${fails} FAILURES`);
  window.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error("TEST CRASHED:", e); process.exit(1); });

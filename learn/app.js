/* ============================================================
   TideLearn — app logic
   Modules: store, scheduler (SM-2, swappable), router, dashboard,
   session flow (recall → read → learn → check → results),
   RSVP engine, quiz, tune mode, importer.
   ============================================================ */
"use strict";

/* ---------- safe storage (works in sandboxed previews too) ---------- */
const store = (() => {
  let mem = {};
  let ok = false;
  try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); ok = true; } catch (e) { ok = false; }
  return {
    get(key, fallback) {
      try { if (ok) { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } } catch (e) {}
      return key in mem ? mem[key] : fallback;
    },
    set(key, val) {
      mem[key] = val;
      try { if (ok) localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
    }
  };
})();

/* ---------- date helpers ---------- */
const DAY = 86400000;
const todayStr = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

/* ---------- state ---------- */
let state = store.get("tidelearn-state", null);
if (!state) { state = seedState(); persist(); }
migrateImportedTopics();

function seedState() {
  const cards = {};
  const topics = {};
  CURRICULUM.forEach((t, ti) => {
    const introduced = ti < 3; // first three topics already in progress
    topics[t.id] = {
      id: t.id, name: t.name, introduced,
      mastery: introduced ? [0.55, 0.7, 0.45][ti] : 0,
      custom: false
    };
    t.cards.forEach((c, ci) => {
      const id = t.id + "#" + ci;
      cards[id] = introduced
        ? { id, topicId: t.id, ef: 2.5, reps: 1 + (ci % 2), interval: 1 + (ci % 3), due: daysFromNow(-(ci % 2)), lapses: 0 }
        : { id, topicId: t.id, ef: 2.5, reps: 0, interval: 0, due: null, lapses: 0 };
    });
  });
  return {
    cards, topics,
    customTopics: [],            // full topic objects created via import
    streak: 2, lastSession: daysFromNow(-1),
    examDate: daysFromNow(30),
    settings: { wpm: 300, chunk: 1 },
    history: []
  };
}

function persist() { store.set("tidelearn-state", state); }

/* Topics generated locally by tools/import-doc.mjs and committed in custom-topics.js */
function customCurriculum() {
  return typeof CUSTOM_CURRICULUM !== "undefined" ? CUSTOM_CURRICULUM : [];
}

function allTopics() {
  const byId = {};
  CURRICULUM.forEach(t => byId[t.id] = t);
  customCurriculum().forEach(t => byId[t.id] = t);
  (state.customTopics || []).forEach(t => byId[t.id] = t);
  return byId;
}
function migrateImportedTopics() {
  const sources = [...customCurriculum(), ...(state.customTopics || [])];
  sources.forEach(t => {
    if (!state.topics[t.id]) state.topics[t.id] = { id: t.id, name: t.name, introduced: false, mastery: 0, custom: true };
    t.cards.forEach((c, ci) => {
      const id = t.id + "#" + ci;
      if (!state.cards[id]) state.cards[id] = { id, topicId: t.id, ef: 2.5, reps: 0, interval: 0, due: null, lapses: 0 };
    });
  });
  // Prune custom topics (and their cards) that were removed or renamed in the curriculum,
  // so saved state doesn't leave orphaned rows behind. Built-in topics are never pruned.
  const validCustom = new Set(sources.map(t => t.id));
  let pruned = false;
  Object.keys(state.topics).forEach(id => {
    if (state.topics[id].custom && !validCustom.has(id)) {
      delete state.topics[id];
      Object.keys(state.cards).forEach(cid => { if (state.cards[cid].topicId === id) delete state.cards[cid]; });
      pruned = true;
    }
  });
  if (pruned) persist();
}

/* ============================================================
   SCHEDULER — SM-2 variant with Anki-style 4-button grading.
   Swappable: replace `schedule()` with FSRS later; UI is agnostic.
   ============================================================ */
const Scheduler = {
  GRADES: [
    { key: "again", label: "Again", hotkey: "1" },
    { key: "hard",  label: "Hard",  hotkey: "2" },
    { key: "good",  label: "Good",  hotkey: "3" },
    { key: "easy",  label: "Easy",  hotkey: "4" }
  ],
  /* returns the card fields after applying a grade (pure) */
  schedule(card, grade) {
    let { ef, reps, interval, lapses } = card;
    if (grade === "again") {
      ef = Math.max(1.3, ef - 0.2);
      return { ef, reps: 0, interval: 0, lapses: lapses + 1, due: todayStr() }; // relearn in-session
    }
    if (grade === "hard") {
      ef = Math.max(1.3, ef - 0.15);
      interval = reps === 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
    } else if (grade === "good") {
      interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(interval * ef);
    } else { // easy
      ef = ef + 0.15;
      interval = reps === 0 ? 2 : Math.max(2, Math.round(interval * ef * 1.3));
    }
    return { ef, reps: reps + 1, interval, lapses, due: daysFromNow(interval) };
  },
  preview(card, grade) {
    if (grade === "again") return "<10m";
    const next = this.schedule(card, grade);
    return next.interval + "d";
  },
  dueCards() {
    const t = todayStr();
    return Object.values(state.cards).filter(c => c.due && c.due <= t);
  }
};

/* ============================================================
   ROUTER
   ============================================================ */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const screens = ["dashboard", "topics", "import", "session"];
function nav(name) {
  screens.forEach(s => { $("#screen-" + s).hidden = s !== name; });
  $$(".navlink").forEach(b => b.classList.toggle("active", b.dataset.nav === name));
  if (name === "dashboard") renderDashboard();
  if (name === "topics") renderTopics($("#topicsList"), true);
  window.scrollTo(0, 0);
}
$$("[data-nav]").forEach(el => el.addEventListener("click", (e) => { e.preventDefault(); nav(el.dataset.nav); }));

/* ============================================================
   DASHBOARD
   ============================================================ */
function buildSessionPlan() {
  const topicsById = allTopics();
  // topics to read: new (not introduced) first, then weakest below 0.85 — max 2
  const notIntroduced = Object.values(state.topics).filter(t => !t.introduced);
  const weak = Object.values(state.topics)
    .filter(t => t.introduced && t.mastery < 0.85)
    .sort((a, b) => a.mastery - b.mastery);
  const readTopics = [...notIntroduced.slice(0, 1), ...weak].slice(0, 2).map(t => t.id);

  // recall: due cards from introduced topics, interleaved across topics, cap 12
  const due = Scheduler.dueCards().filter(c => state.topics[c.topicId].introduced);
  const byTopic = {};
  due.forEach(c => { (byTopic[c.topicId] = byTopic[c.topicId] || []).push(c); });
  const interleaved = [];
  let added = true;
  while (added && interleaved.length < 12) {
    added = false;
    for (const tid of Object.keys(byTopic)) {
      const c = byTopic[tid].shift();
      if (c) { interleaved.push(c.id); added = true; }
      if (interleaved.length >= 12) break;
    }
  }
  // learn: first-pass cards of the topics being read that are still new
  const learnCards = [];
  readTopics.forEach(tid => {
    Object.values(state.cards)
      .filter(c => c.topicId === tid && c.reps === 0)
      .slice(0, 5)
      .forEach(c => learnCards.push(c.id));
  });
  // quiz: questions from the topics read (fallback: weakest introduced topics)
  let quizTopicIds = readTopics.filter(tid => (topicsById[tid].quiz || []).length);
  if (!quizTopicIds.length) quizTopicIds = weak.slice(0, 2).map(t => t.id);
  const quiz = [];
  quizTopicIds.forEach(tid => (topicsById[tid].quiz || []).forEach((q, qi) => quiz.push({ topicId: tid, qi })));

  const est = Math.round(interleaved.length * 0.25 + readTopics.length * 2 + learnCards.length * 0.35 + quiz.length * 0.5);
  return { recall: interleaved, readTopics, learn: learnCards, quiz, estMinutes: Math.max(3, est) };
}

function renderDashboard() {
  const plan = buildSessionPlan();
  $("#dashDate").textContent = new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
  $("#streakCount").textContent = state.streak;

  const topicsById = allTopics();
  const readNames = plan.readTopics.map(tid => topicsById[tid].name);
  $("#heroSummary").textContent = plan.recall.length || plan.readTopics.length
    ? `${plan.recall.length} cards to recall · ${readNames.length ? readNames.join(" + ") : "review"} to read`
    : "All caught up — nothing due today";

  const planEl = $("#heroPlan");
  planEl.innerHTML = "";
  const steps = [];
  if (plan.recall.length) steps.push(["Recall", `${plan.recall.length} due flashcards — retrieval before re-reading`]);
  if (plan.readTopics.length) steps.push(["Read", `Speed-read notes: ${readNames.join(", ")}`]);
  if (plan.learn.length) steps.push(["Learn", `${plan.learn.length} new cards from today's topics`]);
  if (plan.quiz.length) steps.push(["Check", `${plan.quiz.length} comprehension questions`]);
  steps.forEach(([tag, text]) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="plan-step">${tag}</span><span>${text}</span>`;
    planEl.appendChild(li);
  });
  $("#heroEstimate").textContent = `≈ ${plan.estMinutes} min`;
  $("#startSessionBtn").disabled = !steps.length;

  // stats
  $("#statDue").textContent = Scheduler.dueCards().length;
  const hist = state.history.slice(-7);
  const rets = hist.map(h => h.retention).filter(r => r != null);
  $("#statRetention").textContent = rets.length ? Math.round(rets.reduce((a, b) => a + b, 0) / rets.length * 100) + "%" : "–";
  const tvals = Object.values(state.topics);
  $("#statMastered").textContent = tvals.filter(t => t.mastery >= 0.85).length + "/" + tvals.length;
  const examDays = Math.max(0, Math.ceil((new Date(state.examDate) - Date.now()) / DAY));
  $("#statExamDays").textContent = examDays;

  renderTopics($("#dashTopicList"), false);
}

function renderTopics(el, verbose) {
  const topicsById = allTopics();
  el.innerHTML = "";
  Object.values(state.topics).forEach(t => {
    const src = topicsById[t.id];
    const status = !t.introduced ? "new" : t.mastery >= 0.85 ? "strong" : "learning";
    const statusText = !t.introduced ? "not started" : t.mastery >= 0.85 ? "mastered" : "learning";
    const cardCount = Object.values(state.cards).filter(c => c.topicId === t.id).length;
    const row = document.createElement("div");
    row.className = "topic-row topic-row-clickable";
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-label", `Practice ${t.name}`);
    row.innerHTML = `
      <span class="topic-status ${status}" title="${statusText}"></span>
      <span class="topic-name">${t.name}${t.custom ? ' <span class="topic-meta">(imported)</span>' : ""}</span>
      ${src && src.tune ? `<button class="tune-chip" data-tune="${t.id}">♪ Tune</button>` : ""}
      <span class="topic-meta">${cardCount} cards${verbose ? " · " + statusText : ""}</span>
      <div class="mastery-bar"><div class="mastery-fill" style="width:${Math.round(t.mastery * 100)}%"></div></div>
      <span class="topic-practice-hint" aria-hidden="true">Practice →</span>`;
    row.addEventListener("click", () => startTopicSession(t.id));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.code === "Space") { e.preventDefault(); startTopicSession(t.id); }
    });
    el.appendChild(row);
  });
  // Tune chip is a control inside a clickable row — don't let its click start a session
  $$("[data-tune]", el).forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); openTune(b.dataset.tune); }));
}

/* ============================================================
   SESSION FLOW
   ============================================================ */
let session = null;
let clockTimer = null;

$("#startSessionBtn").addEventListener("click", startSession);
$("#exitSessionBtn").addEventListener("click", endSessionEarly);

function startSession() {
  const plan = buildSessionPlan();
  const phases = [];
  if (plan.recall.length) phases.push("Recall");
  if (plan.readTopics.length) phases.push("Read");
  if (plan.learn.length) phases.push("Learn");
  if (plan.quiz.length) phases.push("Check");
  phases.push("Done");
  session = {
    plan, phases, phaseIdx: -1, startedAt: Date.now(),
    graded: [],        // {cardId, grade}
    quizResults: []    // {topicId, correct}
  };
  nav("session");
  renderWave();
  startClock();
  nextPhase();
}

/* Focused practice for a single topic (clicked from a topic row):
   read its note, drill all its cards, then take its quiz. Reuses the phase engine. */
function startTopicSession(tid) {
  const src = allTopics()[tid];
  if (!src) return;
  const cardIds = Object.values(state.cards).filter(c => c.topicId === tid).map(c => c.id);
  const quiz = (src.quiz || []).map((q, qi) => ({ topicId: tid, qi }));
  const plan = {
    recall: [], readTopics: [tid], learn: cardIds, quiz,
    estMinutes: Math.max(2, Math.round(2 + cardIds.length * 0.35 + quiz.length * 0.5)),
    focus: tid
  };
  const phases = [];
  if (plan.readTopics.length) phases.push("Read");
  if (plan.learn.length) phases.push("Learn");
  if (plan.quiz.length) phases.push("Check");
  phases.push("Done");
  session = { plan, phases, phaseIdx: -1, startedAt: Date.now(), graded: [], quizResults: [], focus: tid };
  nav("session");
  renderWave();
  startClock();
  nextPhase();
}

function endSessionEarly() {
  stopClock(); RSVP.stop(); session = null; nav("dashboard");
}

function startClock() {
  const el = $("#sessionClock");
  stopClock();
  clockTimer = setInterval(() => {
    const s = Math.floor((Date.now() - session.startedAt) / 1000);
    el.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }, 1000);
}
function stopClock() { if (clockTimer) clearInterval(clockTimer); clockTimer = null; }

function renderWave() {
  const holder = $("#wavePhases");
  holder.innerHTML = "";
  session.phases.forEach((p, i) => {
    const span = document.createElement("span");
    span.className = "wave-phase" + (i < session.phaseIdx ? " done" : i === session.phaseIdx ? " now" : "");
    span.textContent = p;
    holder.appendChild(span);
  });
  const pct = Math.max(0, session.phaseIdx) / (session.phases.length - 1);
  $("#waveClipRect").setAttribute("width", String(600 * pct));
}

function nextPhase() {
  session.phaseIdx++;
  renderWave();
  const phase = session.phases[session.phaseIdx];
  if (phase === "Recall") return runCards(session.plan.recall, "Recall", "Retrieve before you re-read — the struggle is the workout.");
  if (phase === "Read")   return runReader();
  if (phase === "Learn")  return runCards(session.plan.learn, "Learn", session.focus ? "Every card in this topic — flip, then grade honestly." : "First pass on today's new cards. Flip, then be honest.");
  if (phase === "Check")  return runQuiz();
  return runResults();
}

/* ---------- flashcard phase ---------- */
function runCards(cardIds, phaseName, blurb) {
  const queue = cardIds.slice();
  if (!queue.length) return nextPhase();
  const body = $("#sessionBody");
  const topicsById = allTopics();
  let flipped = false;

  function showCard() {
    if (!queue.length) return nextPhase();
    const card = state.cards[queue[0]];
    const src = topicsById[card.topicId];
    const srcCard = src.cards[Number(card.id.split("#")[1])];
    flipped = false;
    body.innerHTML = `
      <div class="card-stage">
        <p class="card-counter">${phaseName} · ${queue.length} left · <span style="color:var(--mist)">${blurb}</span></p>
        <div class="flashcard" id="flashcard" tabindex="0" role="button" aria-label="Flashcard — press space to flip">
          <div class="flashcard-inner">
            <div class="card-face">
              <p class="card-topic-tag">${src.name}</p>
              <p class="card-text">${srcCard.front}</p>
              <p class="card-hint">tap or press space to flip</p>
            </div>
            <div class="card-face card-face-back">
              <p class="card-topic-tag">Answer</p>
              <p class="card-text">${srcCard.back}</p>
              <p class="card-hint">grade yourself below</p>
            </div>
          </div>
        </div>
        <div class="grade-row" id="gradeRow" style="visibility:hidden">
          ${Scheduler.GRADES.map(g => `
            <button class="grade-btn grade-${g.key}" data-grade="${g.key}">
              <span class="g-label">${g.label}</span>
              <span class="g-int">${Scheduler.preview(card, g.key)}</span>
              <span class="g-key">${g.hotkey}</span>
            </button>`).join("")}
        </div>
      </div>`;

    const fc = $("#flashcard");
    fc.addEventListener("click", flip);
    fc.focus();
    $$("#gradeRow [data-grade]").forEach(b => b.addEventListener("click", () => grade(b.dataset.grade)));

    function flip() {
      if (flipped) return;
      flipped = true;
      fc.classList.add("flipped");
      $("#gradeRow").style.visibility = "visible";
    }
    function grade(g) {
      if (!flipped) return;
      Object.assign(state.cards[card.id], Scheduler.schedule(card, g));
      session.graded.push({ cardId: card.id, grade: g });
      persist();
      queue.shift();
      if (g === "again") queue.splice(Math.min(3, queue.length), 0, card.id); // relearn shortly
      showCard();
    }
    session.keyHandler = (e) => {
      if (e.code === "Space") { e.preventDefault(); flip(); }
      const g = Scheduler.GRADES.find(x => x.hotkey === e.key);
      if (g && flipped) grade(g.key);
    };
  }
  showCard();
}

/* ---------- reader phase (RSVP + prose) ---------- */
const RSVP = (() => {
  let timer = null, seq = [], idx = 0, playing = false, onDone = null, els = {};

  function orpIndex(len) { return len <= 1 ? 0 : len <= 5 ? 1 : len <= 9 ? 2 : len <= 13 ? 3 : 4; }

  function buildSequence(topicSrc, chunk) {
    const s = [];
    const push = (text, sentenceId) => {
      const words = text.split(/\s+/).filter(Boolean);
      for (let i = 0; i < words.length; i += chunk) {
        const group = words.slice(i, i + chunk);
        s.push({ type: "word", words: group, sentenceId });
      }
    };
    s.push({ type: "slide", kicker: "Key concept", text: topicSrc.note.keyConcept, ms: 3600 });
    let sid = 0;
    topicSrc.note.points.forEach(p => push(p, sid++));
    s.push({ type: "slide", kicker: "Memory trigger", text: topicSrc.note.mnemonic, ms: 4200 });
    return s;
  }

  function wordMs(item, wpm) {
    const base = 60000 / wpm;
    const last = item.words[item.words.length - 1];
    let mult = 1;
    if (/[.!?]$/.test(last)) mult = 2.1;
    else if (/[,;:]$/.test(last)) mult = 1.5;
    if (last.replace(/\W/g, "").length > 8) mult = Math.max(mult, 1.3);
    return base * item.words.length * mult;
  }

  function renderItem(item) {
    if (item.type === "slide") {
      els.stage.innerHTML = `<div class="rsvp-slide"><p class="slide-kicker">${item.kicker}</p><p class="slide-text">${item.text}</p></div>`;
      return;
    }
    if (item.words.length === 1) {
      const w = item.words[0];
      const clean = w.replace(/^[^A-Za-z0-9]+/, "");
      const lead = w.length - clean.length;
      const o = lead + orpIndex(clean.length);
      const pre = w.slice(0, o), orp = w[o] || "", post = w.slice(o + 1);
      els.stage.innerHTML = `
        <div class="rsvp-guides top"></div><div class="rsvp-guides bottom"></div>
        <div class="rsvp-word" style="display:grid;grid-template-columns:1fr auto 1fr;width:100%;">
          <span style="text-align:right">${pre}</span><span class="orp">${orp}</span><span style="text-align:left">${post}</span>
        </div>`;
    } else {
      els.stage.innerHTML = `<div class="rsvp-word" style="font-size:clamp(26px,4.5vw,40px)">${item.words.join(" ")}</div>`;
    }
  }

  function tick() {
    if (!playing) return;
    if (idx >= seq.length) { playing = false; setPlayIcon(); if (onDone) onDone(); return; }
    const item = seq[idx];
    renderItem(item);
    els.fill.style.width = Math.round(idx / seq.length * 100) + "%";
    const ms = item.type === "slide" ? item.ms : wordMs(item, state.settings.wpm);
    idx++;
    timer = setTimeout(tick, ms);
  }

  function setPlayIcon() { if (els.play) els.play.textContent = playing ? "❚❚" : "▶"; }

  return {
    start(topicSrc, mountEls, doneCb) {
      this.stop();
      els = mountEls; onDone = doneCb;
      seq = buildSequence(topicSrc, state.settings.chunk);
      idx = 0; playing = true; setPlayIcon(); tick();
    },
    toggle() { playing = !playing; setPlayIcon(); if (playing) tick(); else clearTimeout(timer); },
    replaySentence() {
      // jump back to the start of the current/previous sentence
      let i = Math.max(0, idx - 1);
      const sid = seq[i] && seq[i].sentenceId != null ? seq[i].sentenceId : null;
      while (i > 0 && seq[i - 1].sentenceId === sid && sid != null) i--;
      if (sid == null && i > 0) i--;
      idx = i;
      if (!playing) { playing = true; setPlayIcon(); }
      clearTimeout(timer); tick();
    },
    nudgeWpm(delta) {
      state.settings.wpm = Math.min(700, Math.max(150, state.settings.wpm + delta));
      persist();
      if (els.wpmVal) els.wpmVal.textContent = state.settings.wpm;
      if (els.wpmRange) els.wpmRange.value = state.settings.wpm;
    },
    stop() { clearTimeout(timer); playing = false; },
    get playing() { return playing; }
  };
})();

function runReader() {
  const topicsById = allTopics();
  const list = session.plan.readTopics.slice();
  const body = $("#sessionBody");

  function showTopic() {
    if (!list.length) return nextPhase();
    const tid = list[0];
    const src = topicsById[tid];
    body.innerHTML = `
      <div class="reader">
        <div class="reader-head">
          <p class="reader-topic">${src.name}</p>
          <div class="reader-mode-toggle">
            <button class="mode-btn active" data-mode="rsvp">Speed read</button>
            <button class="mode-btn" data-mode="prose">Full text</button>
          </div>
        </div>
        <div class="reader-stage" id="readerStage"></div>
        <div class="reader-controls">
          <button class="play-btn" id="playBtn" aria-label="Play or pause">❚❚</button>
          <div class="reader-progress"><div class="reader-progress-fill" id="readerFill"></div></div>
          <div class="wpm-control">
            <span id="wpmVal">${state.settings.wpm}</span> wpm
            <input type="range" id="wpmRange" min="150" max="700" step="25" value="${state.settings.wpm}" aria-label="Words per minute">
          </div>
          <div class="wpm-control" title="Words shown per flash">
            <span>chunk</span>
            <select id="chunkSel" class="chunk-sel" aria-label="Words per flash">
              ${[1,2,3].map(n => `<option value="${n}" ${state.settings.chunk === n ? "selected" : ""}>${n}</option>`).join("")}
            </select>
          </div>
        </div>
        <p class="reader-kbd"><span class="kbd">space</span> pause · <span class="kbd">R</span> replay sentence · <span class="kbd">←</span>/<span class="kbd">→</span> speed · review mode works best on material you've met before</p>
        <div class="reader-done-row" id="readerDoneRow" hidden>
          <button class="btn btn-primary" id="readerDoneBtn">${list.length > 1 ? "Next topic →" : "Continue →"}</button>
        </div>
      </div>`;

    const mountEls = {
      stage: $("#readerStage"), fill: $("#readerFill"), play: $("#playBtn"),
      wpmVal: $("#wpmVal"), wpmRange: $("#wpmRange")
    };
    const finish = () => {
      $("#readerFill").style.width = "100%";
      $("#readerDoneRow").hidden = false;
      // mark topic introduced once read
      state.topics[tid].introduced = true;
      // schedule its unseen cards for grading (they enter Learn phase / future sessions)
      Object.values(state.cards).filter(c => c.topicId === tid && !c.due).forEach(c => c.due = todayStr());
      persist();
    };
    RSVP.start(src, mountEls, finish);

    $("#playBtn").addEventListener("click", () => RSVP.toggle());
    $("#wpmRange").addEventListener("input", (e) => {
      state.settings.wpm = Number(e.target.value); persist();
      $("#wpmVal").textContent = state.settings.wpm;
    });
    $("#chunkSel").addEventListener("change", (e) => {
      state.settings.chunk = Number(e.target.value); persist();
      RSVP.start(src, mountEls, finish); // rebuild sequence with new grouping
    });
    $$(".mode-btn").forEach(b => b.addEventListener("click", () => {
      $$(".mode-btn").forEach(x => x.classList.toggle("active", x === b));
      if (b.dataset.mode === "prose") {
        RSVP.stop();
        $("#readerStage").innerHTML = `
          <div class="reader-prose">
            <h4>Key concept</h4><p>${src.note.keyConcept}</p>
            <h4>Main points</h4><ul>${src.note.points.map(p => `<li>${p}</li>`).join("")}</ul>
            <h4>Memory trigger</h4><p class="mnemonic">${src.note.mnemonic}</p>
          </div>`;
        finish();
      } else {
        RSVP.start(src, mountEls, finish);
      }
    }));
    $("#readerDoneBtn").addEventListener("click", () => { RSVP.stop(); list.shift(); showTopic(); });

    session.keyHandler = (e) => {
      if (e.code === "Space") { e.preventDefault(); RSVP.toggle(); }
      if (e.key === "r" || e.key === "R") RSVP.replaySentence();
      if (e.key === "ArrowRight") RSVP.nudgeWpm(25);
      if (e.key === "ArrowLeft") RSVP.nudgeWpm(-25);
    };
  }
  showTopic();
}

/* ---------- quiz phase ---------- */
function runQuiz() {
  const topicsById = allTopics();
  const queue = session.plan.quiz.slice();
  const body = $("#sessionBody");

  function showQ() {
    if (!queue.length) return nextPhase();
    const { topicId, qi } = queue[0];
    const src = topicsById[topicId];
    const q = src.quiz[qi];
    body.innerHTML = `
      <div class="quiz-stage">
        <p class="card-counter">Check · ${queue.length} question${queue.length > 1 ? "s" : ""} left</p>
        <div class="quiz-q">
          <p class="quiz-topic">${src.name}</p>
          <p class="quiz-text">${q.q}</p>
          <div class="quiz-opts">
            ${q.opts.map((o, i) => `<button class="quiz-opt" data-i="${i}">${o}</button>`).join("")}
          </div>
          <div id="quizExplain"></div>
          <div class="quiz-next-row" id="quizNextRow" hidden>
            <button class="btn btn-primary" id="quizNextBtn">Next →</button>
          </div>
        </div>
      </div>`;
    let answered = false;
    $$(".quiz-opt").forEach(btn => btn.addEventListener("click", () => {
      if (answered) return;
      answered = true;
      const i = Number(btn.dataset.i);
      const correct = i === q.a;
      btn.classList.add(correct ? "correct" : "wrong");
      $$(".quiz-opt")[q.a].classList.add("correct");
      $("#quizExplain").innerHTML = `<div class="quiz-explain">${q.explain}</div>`;
      $("#quizNextRow").hidden = false;
      session.quizResults.push({ topicId, correct });
      $("#quizNextBtn").addEventListener("click", () => { queue.shift(); showQ(); });
    }));
    session.keyHandler = null;
  }
  showQ();
}

/* ---------- results ---------- */
function runResults() {
  stopClock();
  const body = $("#sessionBody");
  const graded = session.graded;
  const retention = graded.length
    ? graded.filter(g => g.grade !== "again").length / graded.length : null;
  const quizByTopic = {};
  session.quizResults.forEach(r => {
    (quizByTopic[r.topicId] = quizByTopic[r.topicId] || []).push(r.correct ? 1 : 0);
  });
  // update topic mastery from quiz (EMA) — mastery gates pacing, never card scheduling
  const topicRows = [];
  Object.entries(quizByTopic).forEach(([tid, arr]) => {
    const score = arr.reduce((a, b) => a + b, 0) / arr.length;
    const t = state.topics[tid];
    t.mastery = Math.round((t.mastery * 0.5 + score * 0.5) * 100) / 100;
    topicRows.push({ tid, name: t.name, score, mastery: t.mastery, source: "quiz" });
  });
  // fallback for topics with graded cards but no quiz (e.g. imported): gentler EMA from recall retention
  const retByTopic = {};
  graded.forEach(g => {
    const tid = state.cards[g.cardId].topicId;
    (retByTopic[tid] = retByTopic[tid] || []).push(g.grade !== "again" ? 1 : 0);
  });
  Object.entries(retByTopic).forEach(([tid, arr]) => {
    if (quizByTopic[tid]) return;
    const score = arr.reduce((a, b) => a + b, 0) / arr.length;
    const t = state.topics[tid];
    t.mastery = Math.round((t.mastery * 0.7 + score * 0.3) * 100) / 100;
  });
  const quizScore = session.quizResults.length
    ? session.quizResults.filter(r => r.correct).length / session.quizResults.length : null;

  // streak & history
  const mins = Math.round((Date.now() - session.startedAt) / 60000 * 10) / 10;
  if (state.lastSession !== todayStr()) state.streak += 1;
  state.lastSession = todayStr();
  state.history.push({ date: todayStr(), retention, quizScore, minutes: mins, cards: graded.length });
  persist();

  const headline = quizScore == null ? (retention != null ? Math.round(retention * 100) + "%" : "✓")
    : Math.round(quizScore * 100) + "%";
  body.innerHTML = `
    <div class="results">
      <p class="results-score">${headline}</p>
      <h2>${quizScore == null ? "Session complete" : quizScore >= 0.85 ? "The tide is with you" : quizScore >= 0.6 ? "Solid — a few gaps to close" : "Rough water — we'll circle back"}</h2>
      <div class="results-grid">
        <div class="stat-card"><p class="stat-num">${graded.length}</p><p class="stat-label">cards reviewed</p></div>
        <div class="stat-card"><p class="stat-num">${retention != null ? Math.round(retention * 100) + "%" : "–"}</p><p class="stat-label">recall retention</p></div>
        <div class="stat-card"><p class="stat-num">${mins}m</p><p class="stat-label">session time</p></div>
      </div>
      <div class="results-topics">
        ${topicRows.map(r => `
          <div class="result-topic">
            <span class="rt-badge ${r.score >= 0.75 ? "up" : "review"}">${r.score >= 0.75 ? "advancing" : "re-queued"}</span>
            <span class="rt-name">${r.name}</span>
            <span class="rt-note">${r.score >= 0.75 ? "mastery " + Math.round(r.mastery * 100) + "% — pacing forward" : "notes return in tomorrow's read phase"}</span>
          </div>`).join("")}
      </div>
      <button class="btn btn-primary btn-lg" id="resultsDoneBtn">Back to today</button>
    </div>`;
  $("#resultsDoneBtn").addEventListener("click", () => { session = null; nav("dashboard"); });
  session.keyHandler = null;
}

/* global keyboard routing for session phases */
document.addEventListener("keydown", (e) => {
  if (session && session.keyHandler && !$("#screen-session").hidden) session.keyHandler(e);
});

/* ============================================================
   TUNE MODE — mnemonic chants over a Web Audio beat
   ============================================================ */
let tuneCtx = null, tuneTimer = null;
function openTune(topicId) {
  const src = allTopics()[topicId];
  if (!src || !src.tune) return;
  const overlay = document.createElement("div");
  overlay.className = "tune-overlay";
  overlay.innerHTML = `
    <div class="tune-panel">
      <button class="tune-close" aria-label="Close">✕</button>
      <p class="tune-kicker">Tune mode · learn it like a chorus</p>
      <h3 class="tune-title">${src.tune.title}</h3>
      <div class="tune-lines">
        ${src.tune.lines.map((l, i) => `<p class="tune-line" data-line="${i}">${l}</p>`).join("")}
      </div>
      <button class="btn btn-primary" id="tunePlayBtn">▶ Play the chant</button>
      <p class="tune-bpm">${src.tune.bpm} bpm · loops twice · sing along, seriously</p>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { stopTune(); overlay.remove(); };
  overlay.querySelector(".tune-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#tunePlayBtn").addEventListener("click", () => playTune(src.tune, overlay));
}

function playTune(tune, overlay) {
  stopTune();
  tuneCtx = new (window.AudioContext || window.webkitAudioContext)();
  const beatMs = 60000 / tune.bpm;
  const totalBeats = tune.lines.length * 4 * 2; // 1 line per bar, loop twice
  let beat = 0;
  const lines = $$(".tune-line", overlay);

  function kick(t) {
    const o = tuneCtx.createOscillator(), g = tuneCtx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(tuneCtx.destination); o.start(t); o.stop(t + 0.2);
  }
  function hat(t) {
    const buf = tuneCtx.createBuffer(1, 2205, 44100);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const s = tuneCtx.createBufferSource(); s.buffer = buf;
    const f = tuneCtx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7000;
    const g = tuneCtx.createGain(); g.gain.value = 0.25;
    s.connect(f).connect(g).connect(tuneCtx.destination); s.start(t);
  }

  tuneTimer = setInterval(() => {
    if (beat >= totalBeats) { stopTune(); lines.forEach(l => l.classList.remove("on")); return; }
    const t = tuneCtx.currentTime + 0.01;
    hat(t);
    if (beat % 2 === 0) kick(t);
    const lineIdx = Math.floor(beat / 4) % tune.lines.length;
    lines.forEach((l, i) => l.classList.toggle("on", i === lineIdx));
    beat++;
  }, beatMs);
}
function stopTune() {
  if (tuneTimer) clearInterval(tuneTimer); tuneTimer = null;
  if (tuneCtx) { tuneCtx.close().catch(() => {}); tuneCtx = null; }
}

/* ============================================================
   IMPORT — paste a lesson, get a topic
   Tries Claude API (works when hosted inside claude.ai artifacts),
   falls back to a heuristic generator everywhere else.
   ============================================================ */
$("#importBtn").addEventListener("click", async () => {
  const title = $("#importTitle").value.trim();
  const text = $("#importText").value.trim();
  const status = $("#importStatus");
  if (!title || text.split(/\s+/).length < 40) {
    status.style.color = "#C87F1E";
    status.textContent = "Add a title and at least a few paragraphs of lesson text.";
    return;
  }
  status.style.color = "";
  status.textContent = "Generating note and cards…";
  let topic = null;
  try { topic = await generateWithClaude(title, text); } catch (e) { /* fall through */ }
  if (!topic) topic = generateHeuristic(title, text);

  state.customTopics.push(topic);
  migrateImportedTopics();
  persist();
  status.textContent = `Added "${topic.name}" with ${topic.cards.length} cards. It'll appear in your next session's Read phase.`;
  $("#importTitle").value = ""; $("#importText").value = "";
});

async function generateWithClaude(title, text) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 12000);
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `Turn this lesson into study material. Respond ONLY with JSON, no markdown fences:
{"keyConcept":"one sentence","points":["4-6 short factual sentences"],"mnemonic":"one vivid memory trigger","cards":[{"front":"question","back":"answer"} x4-6]}
Title: ${title}
Lesson: ${text.slice(0, 6000)}`
      }]
    })
  });
  clearTimeout(to);
  const data = await resp.json();
  const raw = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  return buildTopic(title, parsed.keyConcept, parsed.points, parsed.mnemonic, parsed.cards);
}

function generateHeuristic(title, text) {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]/g) || [clean];
  const keyConcept = sentences[0].trim();
  // pick informative sentences: contain a defining verb, reasonable length
  const defining = sentences.slice(1).filter(s => /\b(is|are|means|provides|allows|requires|uses|enables)\b/i.test(s) && s.split(" ").length < 32);
  const points = (defining.length >= 3 ? defining : sentences.slice(1)).slice(0, 6).map(s => s.trim());
  const cards = points.slice(0, 6).map(s => {
    const m = s.match(/^(.{10,80}?)\s+\b(is|are|means|provides|allows|requires|uses|enables)\b\s+(.+)$/i);
    return m
      ? { front: `${m[1]} ${m[2]}…?`, back: s }
      : { front: `Recall the point about: "${s.split(" ").slice(0, 6).join(" ")}…"`, back: s };
  });
  return buildTopic(title, keyConcept, points,
    "Write your own hook for this one — the mnemonics you invent stick hardest.", cards);
}

function buildTopic(title, keyConcept, points, mnemonic, cards) {
  const id = "custom-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) + "-" + Date.now().toString(36);
  return { id, name: title, note: { keyConcept, points, mnemonic }, cards, quiz: [] };
}

/* ============================================================
   BOOT
   ============================================================ */
nav("dashboard");

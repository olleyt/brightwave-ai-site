/* End-to-end smoke test: loads index.html in jsdom and drives a full session. */
const { JSDOM } = require("jsdom");
const path = require("path");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("FAIL:", msg); } else console.log("ok:", msg); };

(async () => {
  const dom = await JSDOM.fromFile(path.join(__dirname, "..", "learn", "index.html"), {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.fetch = () => Promise.reject(new Error("network disabled in test")); // force importer fallback
    }
  });
  const { window } = dom;
  await new Promise(res => window.addEventListener("load", res));
  await new Promise(res => setTimeout(res, 300)); // let scripts settle
  const doc = window.document;
  const $ = s => doc.querySelector(s);
  const $$ = s => Array.from(doc.querySelectorAll(s));

  /* ---- dashboard ---- */
  ok(!$("#screen-dashboard").hidden, "dashboard visible on boot");
  ok($$("#heroPlan li").length >= 3, "session plan shows recall/read/learn/check steps");
  const dueBefore = Number($("#statDue").textContent);
  ok(dueBefore >= 10, `due cards seeded (${dueBefore})`);
  ok($$("#dashTopicList .topic-row").length === 6, "6 topics listed");
  ok($$("#dashTopicList [data-tune]").length === 2, "2 topics expose Tune mode");
  const streakBefore = Number($("#streakCount").textContent);

  /* ---- start session → Recall phase ---- */
  $("#startSessionBtn").click();
  ok(!$("#screen-session").hidden, "session screen opens");
  ok($$(".wave-phase").length === 5, "wave shows 5 phases (Recall Read Learn Check Done)");
  ok($(".flashcard") !== null, "recall phase shows a flashcard");

  // grade every recall card as Good
  let safety = 40;
  while ($(".flashcard") && $(".card-counter") && $(".card-counter").textContent.includes("Recall") && safety--) {
    $(".flashcard").click(); // flip
    ok($(".flashcard").classList.contains("flipped"), "card flips on click");
    const goodBtn = $('.grade-btn[data-grade="good"]');
    ok(/\dd/.test(goodBtn.querySelector(".g-int").textContent), "grade button shows interval preview");
    goodBtn.click();
    // only assert flip/preview once to keep output readable
    if (safety === 38) { /* noop */ }
    break;
  }
  // finish remaining recall cards quietly
  safety = 40;
  while ($(".card-counter") && $(".card-counter").textContent.includes("Recall") && safety--) {
    if ($(".flashcard") && !$(".flashcard").classList.contains("flipped")) $(".flashcard").click();
    const b = $('.grade-btn[data-grade="good"]');
    if (b) b.click(); else break;
  }
  ok(safety > 0, "recall queue drains");

  /* ---- Read phase (use Full text mode to complete instantly) ---- */
  ok($(".reader") !== null, "read phase shows the reader");
  ok($(".rsvp-word, .rsvp-slide") !== null, "RSVP renders a slide or word");
  ok($("#chunkSel") !== null, "chunk-size control present");
  const readerTopic1 = $(".reader-topic").textContent;
  $('.mode-btn[data-mode="prose"]').click();
  ok($(".reader-prose") !== null, "prose mode renders full note");
  ok(!$("#readerDoneRow").hidden, "done button appears after finishing");
  $("#readerDoneBtn").click();
  const readerTopic2 = $(".reader-topic") ? $(".reader-topic").textContent : null;
  ok(readerTopic2 && readerTopic2 !== readerTopic1, `advances to second read topic (${readerTopic1} → ${readerTopic2})`);
  $('.mode-btn[data-mode="prose"]').click();
  $("#readerDoneBtn").click();

  /* ---- Learn phase (new cards from the just-read topic) ---- */
  ok($(".card-counter") && $(".card-counter").textContent.includes("Learn"), "learn phase starts with new cards");
  safety = 20;
  while ($(".card-counter") && $(".card-counter").textContent.includes("Learn") && safety--) {
    if ($(".flashcard") && !$(".flashcard").classList.contains("flipped")) $(".flashcard").click();
    const b = $('.grade-btn[data-grade="good"]');
    if (b) b.click(); else break;
  }
  ok(safety > 0, "learn queue drains");

  /* ---- Check phase (quiz) ---- */
  ok($(".quiz-q") !== null, "quiz phase shows a question");
  const CURR = window.eval("CURRICULUM");
  safety = 10;
  while ($(".quiz-q") && safety--) {
    const topicName = $(".quiz-topic").textContent;
    const qText = $(".quiz-text").textContent;
    const topic = CURR.find(t => t.name === topicName);
    const q = topic.quiz.find(x => x.q === qText);
    $$(".quiz-opt")[q.a].click(); // answer correctly
    const explained = $(".quiz-explain") !== null;
    if (safety === 9) ok(explained, "explanation shown after answering");
    $("#quizNextBtn").click();
  }
  ok(safety > 0, "quiz queue drains");

  /* ---- Results ---- */
  ok($(".results") !== null, "results screen renders");
  ok($(".results-score").textContent.includes("100%"), "perfect quiz → 100% headline");
  ok($$(".result-topic").length === 2, "per-topic outcomes listed");
  ok($$(".rt-badge.up").length === 2, "both topics advancing");
  $("#resultsDoneBtn").click();

  /* ---- back on dashboard: state actually changed ---- */
  ok(!$("#screen-dashboard").hidden, "returns to dashboard");
  const dueAfter = Number($("#statDue").textContent);
  ok(dueAfter < dueBefore, `graded cards rescheduled into the future (due ${dueBefore} → ${dueAfter})`);
  ok(Number($("#streakCount").textContent) === streakBefore + 1, "streak incremented");
  const st = window.eval("state");
  ok(st.topics["vpc-basics"].introduced === true, "new topic marked introduced after reading");
  ok(st.topics["vpc-basics"].mastery > 0, "quiz updated new topic mastery");
  ok(st.history.length === 1 && st.history[0].cards > 0, "session recorded in history");

  /* ---- importer fallback (fetch disabled → heuristic path) ---- */
  $$('.navlink').find(b => b.dataset.nav === "import").click();
  $("#importTitle").value = "Kubernetes Services";
  $("#importText").value = "A Kubernetes Service is an abstraction that exposes a set of pods as a network service. " +
    "ClusterIP is the default type and provides a virtual IP inside the cluster. " +
    "NodePort exposes the service on a static port on every node. " +
    "LoadBalancer provisions an external load balancer from the cloud provider. " +
    "Selectors are labels that determine which pods receive the traffic. " +
    "kube-proxy uses iptables or IPVS rules to route service traffic to healthy pods.";
  $("#importBtn").click();
  await new Promise(res => setTimeout(res, 400));
  ok($("#importStatus").textContent.includes("Added"), "importer creates topic via heuristic fallback");
  const st2 = window.eval("state");
  const custom = st2.customTopics[st2.customTopics.length - 1];
  ok(custom && custom.cards.length >= 3, `imported topic has ${custom ? custom.cards.length : 0} cards`);
  ok(Object.values(st2.topics).some(t => t.custom), "imported topic joins the schedule");

  console.log(fails === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error("TEST CRASHED:", e); process.exit(1); });

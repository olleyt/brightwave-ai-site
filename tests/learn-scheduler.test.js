/* Node unit test: extract Scheduler behaviour without a DOM */
const DAY = 86400000;
const todayStr = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

// mirror of app.js Scheduler.schedule (kept in sync manually for the test)
function schedule(card, grade) {
  let { ef, reps, interval, lapses } = card;
  if (grade === "again") {
    ef = Math.max(1.3, ef - 0.2);
    return { ef, reps: 0, interval: 0, lapses: lapses + 1, due: todayStr() };
  }
  if (grade === "hard") {
    ef = Math.max(1.3, ef - 0.15);
    interval = reps === 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
  } else if (grade === "good") {
    interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(interval * ef);
  } else {
    ef = ef + 0.15;
    interval = reps === 0 ? 2 : Math.max(2, Math.round(interval * ef * 1.3));
  }
  return { ef, reps: reps + 1, interval, lapses, due: daysFromNow(interval) };
}

let fails = 0;
const assert = (cond, msg) => { if (!cond) { fails++; console.log("FAIL:", msg); } else console.log("ok:", msg); };

// new card graded Good three times: 1d → 3d → ~8d (2.5 ef)
let c = { ef: 2.5, reps: 0, interval: 0, lapses: 0 };
c = { ...c, ...schedule(c, "good") };
assert(c.interval === 1 && c.reps === 1, "first Good → 1d");
c = { ...c, ...schedule(c, "good") };
assert(c.interval === 3 && c.reps === 2, "second Good → 3d");
c = { ...c, ...schedule(c, "good") };
assert(c.interval === 8 && c.ef === 2.5, "third Good → round(3*2.5)=8d, EF unchanged");

// Again resets reps, bumps lapses, floors EF at 1.3
let d = { ef: 1.35, reps: 4, interval: 20, lapses: 1 };
d = { ...d, ...schedule(d, "again") };
assert(d.reps === 0 && d.interval === 0 && d.lapses === 2 && d.ef === 1.3, "Again resets + EF floor 1.3");

// Hard grows slowly, Easy grows fast with EF bonus
let h = { ef: 2.5, reps: 2, interval: 10, lapses: 0 };
const hres = schedule(h, "hard");
assert(hres.interval === 12 && Math.abs(hres.ef - 2.35) < 1e-9, "Hard → 12d, EF −0.15");
const eres = schedule(h, "easy");
assert(eres.interval === Math.round(10 * 2.65 * 1.3) && Math.abs(eres.ef - 2.65) < 1e-9, "Easy → interval*newEF*1.3, EF +0.15");

// monotonicity: easy >= good >= hard for a mature card
const g = schedule(h, "good").interval;
assert(eres.interval >= g && g >= hres.interval, "Easy ≥ Good ≥ Hard intervals");

console.log(fails === 0 ? "\nALL SCHEDULER TESTS PASSED" : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);

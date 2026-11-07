// Mock of solo.blooket.com built from real request captures: server-action POST [gameId, qNum, answer, ms] -> RSC reply.
const { JSDOM } = require(process.env.JSDOM || "jsdom");
const code = require("fs").readFileSync(__dirname + "/../blooket-lite.js", "utf8");
const dom = new JSDOM(`<body><main></main></body>`, { runScripts: "outside-only", url: "https://solo.blooket.com/fish?id=GAME1", pretendToBeVisual: true });
const w = dom.window, d = w.document;
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : fail++, console.log((c ? "PASS " : "FAIL ") + m));
Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { return this.parentNode; } });

const bank = [
  { n: 7, q: "Labor day honors a ___?", a: ["homerun", "strike", "party", "boycott"], c: ["strike"] },
  { n: 13, q: "The first state to celebrate Labor day in the US was..", a: ["California ", "Florida", "Oregon", "Massachusetts"], c: ["Oregon"] },
];
let cur = 0, submitted = [], serverCalls = 0;
w.Response = class { constructor(t) { this.t = t; this.status = 200; } text() { return Promise.resolve(this.t); } clone() { return this; } json() { return Promise.resolve(JSON.parse(this.t)); } };
w.fetch = async (url, init) => {
  if (String(url).includes("/api/data/gameanswers")) return new w.Response(JSON.stringify({ questionSetId: "SET1" }));
  serverCalls++;
  const [gid, num, ans, ms] = JSON.parse(init.body);
  const q = bank.find((b) => b.n === num);
  submitted.push({ num, ans, ms });
  return new w.Response(`0:["$@1",["x",null]]\n1:${JSON.stringify({ data: { result: { isCorrect: q.c.includes(ans), isInvalidQuestion: false, correctAnswers: q.c, totalCorrect: 1 }, nextQuestion: { correctAnswers: [] } }, error: "" })}\n`);
};

const main = d.querySelector("main");
let shownAt = 0;
function render(state) {
  main.replaceChildren();
  const q = bank[cur];
  const qt = d.createElement("div"); qt.className = "_questionText_1w7yk_73"; qt.textContent = q.q; main.append(qt);
  const wrap = d.createElement("div"); wrap.className = "_answersWrapper_zlv04_1"; main.append(wrap);
  const order = [...q.a].sort(() => Math.random() - 0.5); // shuffled like "random": true
  for (const a of order) {
    const b = d.createElement("button"); b.className = "_answerButton_1rz5f_14" + (state == "feedback" ? " _answerButtonDisabled_1rz5f_101" : "");
    b.disabled = state == "feedback";
    const t = d.createElement("div"); t.className = "_answerText_1rz5f_129"; t.textContent = a; b.append(t);
    b.onclick = () => { w.fetch("", { method: "POST", headers: { Accept: "text/x-component", "Next-Action": "ccea84", "Next-Router-State-Tree": "x" }, body: JSON.stringify(["GAME1", q.n, a, Date.now() - shownAt]) }).then(() => setTimeout(() => render("feedback"), 50)); };
    wrap.append(b);
  }
  if (state == "feedback") { const n = d.createElement("button"); n.className = "_goNextButton_1w7yk_168"; n.onclick = () => { cur = (cur + 1) % bank.length; shownAt = Date.now(); render("question"); }; main.append(n); }
}
render("question"); shownAt = Date.now();
w.confirm = () => true;
w.eval(code);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const panel = [...d.body.children].find((e) => e.textContent.startsWith("Blooket Lite"));
const card = (n) => [...panel.querySelectorAll("div")].find((e) => e.firstChild?.textContent === n && e.style.cursor === "pointer");

(async () => {
  ok(panel && panel.textContent.includes("Solo"), "detects solo host, shows Solo panel");
  ok(!!card("Auto Answer") && !card("Swap Gold"), "solo tab shown, live-only cheats hidden");
  ok(typeof w.fetch === "function" && w.fetch.toString().includes("async"), "fetch hooked");
  card("Auto Answer").click();
  // lap 1: 2 guesses, lap 2: both known -> correct
  const deadline = Date.now() + 40000;
  while (submitted.length < 4 && Date.now() < deadline) await sleep(100);
  card("Auto Answer").click();
  console.log("   submissions:", JSON.stringify(submitted));
  ok(submitted.length >= 4, "ran two laps");
  const lap2 = submitted.slice(2, 4);
  ok(lap2.every((s) => bank.find((b) => b.n === s.num).c.includes(s.ans)), "lap 2 answers are all correct (learned from server replies, despite shuffle)");
  ok(submitted.every((s) => s.ms >= 1100), "every answer waited a human delay (>=1.1s): " + submitted.map((s) => s.ms).join(","));
  const saved = JSON.parse(w.localStorage.getItem("bl.solo.SET1") || "{}");
  ok(Object.keys(saved).length === 2, "answers saved under the question-set id (SET1), 2 entries");
  // highlight on known question
  await sleep(200);
  d.querySelector("[class*=goNextButton]")?.click();
  card("Highlight Known").click(); await sleep(300);
  const good = [...d.querySelectorAll("button[class*=answerButton]")].filter((b) => b.style.outline.includes("solid"));
  ok(good.length === 1 && bank[cur].c.includes(good[0].textContent), "highlight outlines exactly the correct answer");
  card("Highlight Known").click();

  // Close, then paste again on the same page: the one fetch hook must feed the NEW panel, and nothing after a close.
  const x = [...panel.querySelectorAll("span")].find((e) => e.textContent == "✕");
  x.click(); x.click();
  ok(!d.body.contains(panel), "close removes the solo panel");
  w.localStorage.removeItem("bl.solo.SET1");
  bank.push({ n: 21, q: "Fresh question?", a: ["yes", "no"], c: ["no"] }); cur = bank.length - 1; render("question");
  d.querySelector("button[class*=answerButton]").click(); await sleep(150);
  ok(!w.localStorage.getItem("bl.solo.SET1"), "a closed panel learns nothing");
  w.eval(code); await sleep(50);
  const panel2 = [...d.body.children].find((e) => e.textContent.startsWith("Blooket Lite"));
  const card2 = (n) => [...panel2.querySelectorAll("div")].find((e) => e.firstChild?.textContent === n && e.style.cursor === "pointer");
  render("question"); d.querySelector("button[class*=answerButton]").click(); await sleep(150);
  render("question"); card2("Highlight Known").click(); await sleep(300);
  const lit = [...d.querySelectorAll("button[class*=answerButton]")].filter((b) => b.style.outline.includes("solid"));
  ok(lit.length === 1 && lit[0].textContent === "no", "after close + paste again, the new panel learns from the same hook");
  card2("Highlight Known").click();
  // reload simulation: fresh page, new game id, same set -> knowledge persists
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

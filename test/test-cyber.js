// Mock of cyber.blooket.com (Colyseus) built from real message captures.
const { JSDOM } = require(process.env.JSDOM || "jsdom");
const code = require("fs").readFileSync(__dirname + "/../blooket-lite.js", "utf8");
const dom = new JSDOM(`<body><div id=root></div></body>`, { runScripts: "outside-only", url: "https://cyber.blooket.com/G1/play/P1" });
const w = dom.window, d = w.document;
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : fail++, console.log((c ? "PASS " : "FAIL ") + m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- server ----
const bank = {
  9: { text: "A group of people that protect your rights are work are call", answers: ["Squad", "Awesome", "Union", "Team"], c: ["Union"] },
  7: { text: "When a group of people refuse to work its called a...", answers: ["strike", "boycott", "party", "homerun"], c: ["strike"] },
  11: { text: "When did Labor Day become an federal holiday?", answers: ["2000", "1620", "its not a holiday", "1894"], c: ["1894"] },
};
const passwords = { player2: 149, otherguy: 50 };
const sent = [];
let cur = null, hackTarget = null;
const room = {
  sessionId: "me1", roomId: "G1", name: "main",
  onMessageHandlers: { events: {} },
  onMessage(type, cb) { const ev = this.onMessageHandlers.events; (ev[type] ||= []).push(cb); return () => { ev[type] = ev[type].filter((x) => x !== cb); }; },
  send(type, msg) {
    sent.push([type, msg]);
    if (type == "playerAnswerQuestion") emit("answerResult", { isCorrect: cur.c.includes(msg.answer), correctAnswers: cur.c, incorrectTime: 3 });
    if (type == "submitPasswordGuess") emit("passwordGuessResult", msg.passwordIndex === passwords[hackTarget] ? { correct: true, creditsStolen: 29 } : { correct: false });
  },
  state: {
    players: {
      player1: { name: "player1", sessionId: "me1", score: 265, stage: "question", defensiveHackerName: "" },
      player2: { name: "player2", sessionId: "s2", score: 75, stage: "hack", defensiveHackerName: "player1" },
      "<img src=x onerror=alert(1)>": { name: "x", sessionId: "s3", score: 900, stage: "question", defensiveHackerName: "" },
    },
    hackEvents: [],
  },
};
const origSend = room.send;
const emit = (type, msg) => { const ev = room.onMessageHandlers.events; if (ev[type]) ev[type].slice().forEach((cb) => cb(msg)); else (ev["*"] || []).slice().forEach((cb) => cb(type, msg)); }; // colyseus.js dispatch rule

// ---- React tree: #root container -> context provider {room, send, userId} -> (hack options) ----
const rootEl = d.getElementById("root");
const ctxFiber = { type: { _context: {} }, memoizedProps: { value: { room, send: (t, m) => room.send(t, m), userId: "player1" } }, child: null };
rootEl.__reactContainer$abc = { child: ctxFiber };
const main = d.createElement("div"); rootEl.append(main);

function showQuestion(n) {
  cur = bank[n];
  const order = [...cur.answers].sort(() => Math.random() - 0.5); // server shuffles each ask
  emit("showQuestion", { number: n, text: cur.text, answers: order, qType: "", answerTypes: [], image: "", audio: "" });
  main.replaceChildren();
  const qt = d.createElement("div"); qt.className = "_questionText_1w7yk_73"; qt.textContent = cur.text; main.append(qt);
  for (const a of order) {
    const b = d.createElement("div"); b.className = "_answerButton_1rz5f_14";
    const t = d.createElement("div"); t.className = "_answerText_1rz5f_129"; t.textContent = a; b.append(t);
    b.onclick = () => room.send("playerAnswerQuestion", { answer: a });
    main.append(b);
  }
}
// Hack screen: option fibers keyed by password index (withFibers=false = unmappable UI).
function showHack(target, options, withFibers = true) {
  hackTarget = target;
  main.replaceChildren();
  const kids = options.map((i) => {
    const el = d.createElement("div"); el.className = "_passwordOption_x"; el.onclick = () => room.send("submitPasswordGuess", { passwordIndex: i }); main.append(el);
    return { key: String(i), type: "div", memoizedProps: {}, child: { type: "div", stateNode: el } };
  });
  kids.forEach((k, i) => (k.sibling = kids[i + 1] || null));
  ctxFiber.child = withFibers ? kids[0] : null;
  emit("hackPasswordOptions", { passwordIndexes: options, targetPlayerName: target });
  return kids.map((k) => k.child.stateNode);
}
const sentOf = (type) => sent.filter(([t]) => t == type).map(([, m]) => m);

w.fetch = () => Promise.resolve(null);
w.confirm = () => true;
const realCreate = d.createElement.bind(d);
d.createElement = (t, ...r) => { const el = realCreate(t, ...r); if (t == "iframe") Object.defineProperty(el, "contentWindow", { get: () => ({ confirm: () => true }) }); return el; };
w.eval("Math.random = () => 0"); // shortest human delays; guesses pick the first answer
showQuestion(9);
w.eval(code);
const panel = [...d.body.children].find((e) => e.textContent.startsWith("Blooket Lite"));
const tab = (n) => [...panel.querySelectorAll("div")].find((e) => e.textContent === n && e.children.length === 0 && e.style.cursor === "pointer");
const card = (n) => [...panel.querySelectorAll("div")].find((e) => e.firstChild?.textContent === n && e.style.cursor === "pointer");
const statusText = () => panel.lastChild.textContent;
const radar = () => panel.children[3];
// Auto Answer + Correct ESP start on; switch them off so each test below starts from a clean slate.
const defaultsOn = card("Auto Answer").style.background !== card("Learned Count").style.background && card("Correct ESP").style.background === card("Auto Answer").style.background;
card("Auto Answer").click(); card("Correct ESP").click();

(async () => {
  ok(panel && panel.textContent.includes("Crypto"), "detects cyber host, shows new-server Crypto panel");
  ok(tab("Answers") && tab("Players") && tab("Crypto") && !tab("Gold"), "Colyseus tabs only (no dead Firebase tabs)");
  ok(room.send !== origSend, "room.send observed");
  ok(defaultsOn, "Auto Answer + Correct ESP are on by default");

  // Learning happens with every cheat off. First ask of q9 arrived before the script, so key falls back to the DOM.
  main.querySelector("._answerButton_1rz5f_14").click(); // manual (wrong or right) answer
  ok(sentOf("playerAnswerQuestion").length === 1, "manual answer passes through room.send unchanged");
  tab("Answers").click(); card("Learned Count").click();
  ok(/^1 answers saved/.test(statusText()), `learns from answerResult with cheats off (${statusText()})`);

  // Auto Answer: known question comes back shuffled -> clicks the right one exactly once.
  card("Auto Answer").click();
  showQuestion(9);
  await sleep(1900);
  let a = sentOf("playerAnswerQuestion");
  ok(a.length === 2 && a[1].answer === "Union", `auto answers known question correctly (${JSON.stringify(a.slice(1))})`);
  await sleep(2500);
  ok(sentOf("playerAnswerQuestion").length === 2, "answers each ask once (no re-click while feedback is up)");

  // Unknown question: guesses once, learns from the reply.
  showQuestion(7);
  await sleep(1900);
  a = sentOf("playerAnswerQuestion");
  ok(a.length === 3, "guesses an unknown question once");
  // Same question asked again (new showQuestion) -> answered again, now correctly.
  showQuestion(7);
  await sleep(1900);
  a = sentOf("playerAnswerQuestion");
  ok(a.length === 4 && a[3].answer === "strike", `repeat ask answered with the learned answer (${a[3]?.answer})`);
  card("Auto Answer").click();

  // Known Only skips unknowns.
  card("Known Only").click();
  showQuestion(11);
  await sleep(1900);
  ok(sentOf("playerAnswerQuestion").length === 4, "Known Only leaves unknown questions alone");
  card("Known Only").click();

  // Highlight Known
  showQuestion(9);
  card("Correct ESP").click(); await sleep(250);
  const lit = [...main.querySelectorAll("._answerButton_1rz5f_14")].filter((b) => b.style.outline);
  ok(lit.length === 1 && lit[0].textContent === "Union", "highlights only the known correct answer");
  ok([...main.querySelectorAll("._answerButton_1rz5f_14")].filter((b) => b.style.opacity === "0.45").length === 3, "fades the 3 wrong answers");
  card("Correct ESP").click(); await sleep(50);
  ok(![...main.querySelectorAll("._answerButton_1rz5f_14")].some((b) => b.style.outline), "highlight cleared on off");

  // Prize ESP
  tab("Crypto").click();
  card("Prize ESP").click();
  emit("prizeSelected", { type: "hack", rate: 0.18, blook: "Mega Bot", text: "HACK" });
  emit("showQuestion"); // the payload-less showQuestion seen in captures must not clear it
  await sleep(250);
  ok(d.querySelector(".bl-prize")?.textContent === "Prize: HACK", "Prize ESP shows the pre-rolled prize");
  showQuestion(9); await sleep(250);
  ok(!d.querySelector(".bl-prize"), "prize badge clears on the next question");
  card("Prize ESP").click();

  // Auto Guess: unknown target -> server's first option; correct -> learned.
  card("Auto Guess").click();
  showHack("player2", [149, 161, 67]);
  await sleep(1500);
  let g = sentOf("submitPasswordGuess");
  ok(g.length === 1 && g[0].passwordIndex === 149, `unknown target: guesses the first option (${JSON.stringify(g)})`);
  // Learned: next time 149 is not first, still picked.
  showHack("player2", [161, 131, 149]); // 161 survives the list intersection too; only the learned guess result pins 149
  await sleep(1500);
  g = sentOf("submitPasswordGuess");
  ok(g.length === 2 && g[1].passwordIndex === 149, "known password picked wherever it sits in the list");
  await sleep(500);
  ok(sentOf("submitPasswordGuess").length === 2, "one guess per hack screen");
  card("Auto Guess").click();

  // Intersection + wrong-guess elimination (manual play, ESP only).
  card("Password ESP").click();
  let els = showHack("otherguy", [12, 50, 77]);
  els[0].click(); // manual wrong guess on 12
  els = showHack("otherguy", [50, 99, 3]);
  await sleep(250);
  ok(els[0].style.outline.includes("0, 207, 119") && els[1].style.outline.includes("189, 15, 38"), "ESP: intersection of option lists finds the password (green) and marks others red");
  ok(/otherguy's password: option #50/.test(statusText()), `ESP status names it (${statusText()})`);
  // Password changed: nothing fits -> starts over instead of marking everything red.
  passwords.otherguy = 5;
  els = showHack("otherguy", [5, 6, 7]);
  await sleep(250);
  ok(!els.some((e) => e.style.outline.includes("189, 15, 38")), "changed password resets instead of all-red");
  card("Password ESP").click(); await sleep(50);
  ok(!els.some((e) => e.style.outline), "ESP outlines cleared on off");

  // No mappable option buttons -> Auto Guess falls back to the game's own message.
  card("Auto Guess").click();
  showHack("player2", [300, 149, 301], false);
  await sleep(1500);
  g = sentOf("submitPasswordGuess");
  ok(g.at(-1).passwordIndex === 149, "falls back to room.send when option buttons can't be mapped");
  card("Auto Guess").click();

  // Speed settings + Auto Continue on Crypto.
  const setSpeed = (name, ms) => {
    const el = card(name).querySelector("input"); el.value = ms;
    el.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  };
  const showNext = (msg, label = "Click anywhere to continue") => {
    main.replaceChildren();
    const el = d.createElement("div"); el.textContent = label; el.onclick = () => room.send(msg, {}); main.append(el);
  };
  tab("Answers").click();
  ok(card("Answer Speed").textContent.includes("Now 0 ms") && card("Continue Speed").textContent.includes("Now 250 ms"), "speeds default to the old behaviour (instant / 250 ms)");
  setSpeed("Answer Speed", 400); await sleep(20);
  ok(JSON.parse(w.localStorage.getItem("bl.coly.speed")).answer === 400 && card("Answer Speed").textContent.includes("Now 400 ms"), "Answer Speed saved and shown");
  setSpeed("Answer Speed", -5); await sleep(20);
  ok(card("Answer Speed").textContent.includes("Now 0 ms"), "negative speed clamps to 0");
  setSpeed("Answer Speed", 400); await sleep(20);
  card("Auto Answer").click();
  let n = sentOf("playerAnswerQuestion").length;
  showQuestion(11); await sleep(200);
  ok(sentOf("playerAnswerQuestion").length === n, "Answer Speed: no click before the delay");
  await sleep(350);
  ok(sentOf("playerAnswerQuestion").length === n + 1, "Answer Speed: clicks once after the delay");
  n = sentOf("playerAnswerQuestion").length;
  showQuestion(11); await sleep(200);
  ok(sentOf("playerAnswerQuestion").length === n, "Answer Speed also delays known answers");
  await sleep(350);
  ok(sentOf("playerAnswerQuestion").at(-1)?.answer === "1894", "known answer still right after the delay");
  card("Auto Answer").click();
  setSpeed("Answer Speed", 0); setSpeed("Continue Speed", 500); await sleep(20);

  tab("Crypto").click();
  card("Auto Continue").click();
  emit("answerResult", { isCorrect: true, correctAnswers: bank[11].c });
  showNext("playerAnswerNext"); await sleep(300);
  ok(sentOf("playerAnswerNext").length === 0, "Continue Speed: no click before the delay");
  await sleep(350);
  ok(sentOf("playerAnswerNext").length === 1, "Crypto feedback screen clicked -> playerAnswerNext");
  await sleep(600);
  ok(sentOf("playerAnswerNext").length === 1, "clicks once (stops when the game moved on)");
  tab("Answers").click(); setSpeed("Continue Speed", 250); await sleep(20); tab("Crypto").click();
  showQuestion(7); room.send("playerRequestPrize", {}); emit("prizeSelected", { type: "credits", text: "+50 Credits" });
  await sleep(50); showNext("claimPrize", "Continue"); await sleep(400);
  ok(sentOf("claimPrize").length === 1, "Crypto prize screen clicked -> claimPrize");
  showQuestion(7); room.send("playerRequestPrize", {}); emit("prizeSelected", { type: "hack", text: "Hack a player" });
  await sleep(50); showNext("claimPrize", "Continue"); await sleep(500);
  ok(sentOf("claimPrize").length === 1, "leaves a hack prize alone (your choice to hack or skip)");
  showQuestion(7); room.send("playerRequestPrize", {}); room.send("requestHackPasswordOptions", {});
  await sleep(50); showNext("claimPrize", "Continue"); await sleep(500);
  ok(sentOf("claimPrize").length === 1, "going to hack ends the continue screen");
  showQuestion(7); emit("answerResult", { isCorrect: true, correctAnswers: bank[7].c });
  const pwEls = showHack("otherguy", [50, 51, 52]); const before = sentOf("submitPasswordGuess").length;
  const stray = d.createElement("div"); stray.textContent = "Continue"; stray.onclick = () => room.send("playerAnswerNext", {}); main.append(stray);
  await sleep(500);
  ok(sentOf("playerAnswerNext").length === 1 && sentOf("submitPasswordGuess").length === before && pwEls.length === 3, "never clicks on the hack screen");
  card("Auto Continue").click();
  ctxFiber.child = null;

  // Record Messages is on the Crypto tab too.
  tab("Crypto").click();
  ok(card("Record Messages") && card("Auto Chest") && card("Auto Guess") && card("Auto Continue"), "Crypto tab has Record Messages, Auto Chest, Auto Guess, Auto Continue");

  // Autoplay: the whole Crypto loop from the captured message order, on one switch.
  const showBoxes = (wrapped, then) => {
    main.replaceChildren();
    const holder = d.createElement("div"); if (wrapped) holder.className = "_boxesWrap_x"; main.append(holder);
    [0, 1, 2].forEach((i) => {
      const b = d.createElement("div");
      if (wrapped) b.className = `_item_${i}`; else { b.className = "_tile_x"; b.__reactProps$abc = { onClick() {} }; }
      b.onclick = then; holder.append(b);
    });
  };
  const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await sleep(20); return fn(); };
  tab("Answers").click();
  ok(card("Autoplay").style.background === card("Learned Count").style.background, "Autoplay starts off");
  card("Autoplay").click();
  const counts = () => Object.fromEntries(["playerAnswerNext", "playerRequestPrize", "claimPrize", "requestHackPasswordOptions", "submitPasswordGuess", "playerGetNewQuestion"].map((k) => [k, sentOf(k).length]));
  let c0 = counts(), a0 = sentOf("playerAnswerQuestion").length;
  showQuestion(11);
  ok(await until(() => sentOf("playerAnswerQuestion").length === a0 + 1) && sentOf("playerAnswerQuestion").at(-1).answer === "1894", "Autoplay answers the question");
  showNext("playerAnswerNext");
  ok(await until(() => counts().playerAnswerNext === c0.playerAnswerNext + 1), "Autoplay clicks the feedback screen");
  emit("prizeSelected", { type: "credits", text: "+20 Credits" });
  showBoxes(true, () => room.send("playerRequestPrize", {}));
  ok(await until(() => counts().playerRequestPrize === c0.playerRequestPrize + 1), "Autoplay opens a prize box");
  showNext("claimPrize", "Continue");
  ok(await until(() => counts().claimPrize === c0.claimPrize + 1), "Autoplay claims the prize");
  await sleep(500);
  ok(counts().playerRequestPrize === c0.playerRequestPrize + 1, "only one box opened per prize");
  let strayBox = 0; showBoxes(true, () => strayBox++); await sleep(500);
  ok(strayBox === 0, "no box-like clicks once the prize is picked (only between prizeSelected and the pick)");
  // Next round: hack prize, boxes found by click handlers only.
  a0 = sentOf("playerAnswerQuestion").length;
  showQuestion(7);
  ok(await until(() => sentOf("playerAnswerQuestion").length === a0 + 1), "Autoplay answers the next question (guess)");
  showNext("playerAnswerNext");
  ok(await until(() => counts().playerAnswerNext === c0.playerAnswerNext + 2), "second feedback screen clicked");
  emit("prizeSelected", { type: "hack", text: "HACK" });
  showBoxes(false, () => room.send("playerRequestPrize", {}));
  ok(await until(() => counts().playerRequestPrize === c0.playerRequestPrize + 2), "boxes with no useful class name are still found");
  showNext("claimPrize", "Hack!");
  ok(await until(() => counts().claimPrize === c0.claimPrize + 2), "Autoplay takes the hack prize");
  room.send("requestHackPasswordOptions", {});
  const n0 = sentOf("submitPasswordGuess").length;
  passwords.hack3 = 77;
  showHack("hack3", [77, 12, 33]);
  ok(await until(() => sentOf("submitPasswordGuess").length === n0 + 1) && sentOf("submitPasswordGuess").at(-1).passwordIndex === 77, "Autoplay picks the password");
  showNext("playerGetNewQuestion", "Continue");
  ok(await until(() => counts().playerGetNewQuestion === c0.playerGetNewQuestion + 1), "Autoplay clicks past the hack result");
  ctxFiber.child = null;
  card("Autoplay").click();
  a0 = sentOf("playerAnswerQuestion").length;
  showQuestion(9); await sleep(400);
  ok(sentOf("playerAnswerQuestion").length === a0, "Autoplay off stops answering");

  // Radar
  tab("Players").click();
  room.state.hackEvents.push({ playerName: "player1", targetPlayerName: "player2", amount: 55 }, { playerName: "player2", targetPlayerName: "player1", amount: 20 });
  card("Player Radar").click(); await sleep(1100);
  const lines = [...radar().children].map((e) => e.textContent);
  ok(lines[1].startsWith("★ <img") && lines[2].startsWith("2. player1") && lines[3].includes("hacking") && lines[3].includes("hit by player1"), `radar sorted, leader starred, stages shown (${JSON.stringify(lines.slice(1, 4))})`);
  ok(!radar().querySelector("img"), "player names rendered as text, not HTML");
  const feed = [...radar().children].filter((e) => e.textContent.includes("→"));
  ok(feed.length === 2 && feed[0].style.color === "rgb(255, 138, 138)", "hack feed shows newest first, hits on me in red");
  card("Player Radar").click();

  // Close: one click only arms it; the second removes listeners and restores room.send.
  panel.querySelector("span").click();
  ok(d.body.contains(panel) && room.send !== origSend, "one click on close does not close");
  panel.querySelector("span").click();
  ok(room.send === origSend, "close restores room.send");
  ok(Object.values(room.onMessageHandlers.events).every((l) => l.length === 0), "close removes every listener");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

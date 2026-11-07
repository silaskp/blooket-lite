// Mock of gold.blooket.com: assumes Gold Quest moved to the same Colyseus server as Crypto (cyber.blooket.com).
// Gold's real message names are unverified until Record Messages is run live, so the chest message here uses a
// made-up name on purpose: the engine has to find prizes by shape, not by name.
const { JSDOM } = require(process.env.JSDOM || "jsdom");
const code = require("fs").readFileSync(__dirname + "/../blooket-lite.js", "utf8");
const dom = new JSDOM(`<body><div id=root></div></body>`, { runScripts: "outside-only", url: "https://gold.blooket.com/G1/play/P1" });
const w = dom.window, d = w.document;
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : fail++, console.log((c ? "PASS " : "FAIL ") + m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SET = "64f0c0ffee0123456789abcd";
const bank = {
  1: { text: "2 + 2?", answers: ["3", "4", "5", "22"], c: ["4"] },
  2: { text: "Capital of France?", answers: ["Rome", "Paris", "Oslo", "Bern"], c: ["Paris"] },
  3: { text: "Largest planet?", answers: ["Mars", "Venus", "Jupiter", "Earth"], c: ["Jupiter"] },
  4: { text: "Color of the sky?", answers: ["Green", "Blue", "Red", "Pink"], c: ["Blue"] },
};
const sent = [];
let cur = null;
const room = {
  sessionId: "me1", roomId: "G1", name: "main",
  onMessageHandlers: { events: {} },
  onMessage(type, cb) { const ev = this.onMessageHandlers.events; (ev[type] ||= []).push(cb); return () => { ev[type] = ev[type].filter((x) => x !== cb); }; },
  send(type, msg) {
    sent.push([type, msg]);
    if (type == "playerAnswerQuestion") emit("answerResult", { isCorrect: cur.c.includes(msg.answer), correctAnswers: cur.c });
  },
  state: {
    setId: SET,
    questions: [{ text: bank[3].text, answers: bank[3].answers, correctAnswers: bank[3].c }], // answer key sitting in synced state
    players: { me: { sessionId: "me1", gold: 120 }, rich: { sessionId: "s2", gold: 5000 }, poor: { sessionId: "s3", gold: 300 } },
  },
};
const origSend = room.send;
// Same dispatch rule as colyseus.js Room.dispatchMessage.
const emit = (type, msg) => {
  const ev = room.onMessageHandlers.events;
  if (ev[type]) ev[type].slice().forEach((cb) => cb(msg)); // colyseus.js dispatchMessage: per-type handlers if the key exists,
  else (ev["*"] || []).slice().forEach((cb) => cb(type, msg)); // else "*" (an empty array still counts as "exists")
};
const rootEl = d.getElementById("root");
rootEl.__reactContainer$abc = { child: { type: { _context: {} }, memoizedProps: { value: { room, send: (t, m) => room.send(t, m), userId: "me" } }, child: null } };
const main = d.createElement("div"); rootEl.append(main);
function showQuestion(n) {
  cur = bank[n];
  emit("showQuestion", { number: n, text: cur.text, answers: cur.answers });
  main.replaceChildren();
  const qt = d.createElement("div"); qt.className = "_questionText_1w7yk_73"; qt.textContent = cur.text; main.append(qt);
  for (const a of cur.answers) {
    const b = d.createElement("div"); b.className = "_answerButton_1rz5f_14";
    const t = d.createElement("div"); t.className = "_answerText_1rz5f_129"; t.textContent = a; b.append(t);
    b.onclick = () => (deadAnswers > 0 ? deadAnswers-- : room.send("playerAnswerQuestion", { answer: a })); // deadAnswers: clicks the game drops (still animating)
    main.append(b);
  }
}
let picked = null, targeted = null, deadTargets = false, deadAnswers = 0, deadChests = false;
// "Click anywhere to continue" screen: the whole box takes the click and sends `msg`.
function showContinue(msg, label = "Click anywhere to continue") {
  main.replaceChildren();
  const box = d.createElement("div"); box.className = "_feedbackContainer_q1"; box.onclick = () => room.send(msg, {});
  const t = d.createElement("div"); t.textContent = label; box.append(t); main.append(box);
}
function showChests() {
  main.replaceChildren();
  [0, 1, 2].forEach((i) => {
    const c = d.createElement("div"); c.className = `_choice${i + 1}_9ab_1`; c.onclick = () => { picked = i; if (!deadChests) room.send("revealPrize", {}); };
    const img = d.createElement("img"); c.append(img); main.append(c);
  });
}
function showTargets(names) {
  main.replaceChildren();
  for (const n of names) {
    const row = d.createElement("div"); row.className = "_playerContainer_x"; row.onclick = () => { targeted = n; if (!deadTargets) room.send("swapOrTake", { targetUserId: n }); };
    const label = d.createElement("div"); label.textContent = n; row.append(label); main.append(row);
  }
}
const sentOf = (type) => sent.filter(([t]) => t == type).map(([, m]) => m);
const fetched = [];
w.fetch = (url) => {
  fetched.push(url);
  if (url == `https://play.blooket.com/api/gamequestionsets?gameId=${SET}`)
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ questions: [1, 2].map((n) => ({ question: bank[n].text, answers: bank[n].answers, correctAnswers: bank[n].c })) }) });
  return Promise.reject(new TypeError("Failed to fetch")); // what CORS looks like
};
w.confirm = () => true;
const realCreate = d.createElement.bind(d);
d.createElement = (t, ...r) => { const el = realCreate(t, ...r); if (t == "iframe") Object.defineProperty(el, "contentWindow", { get: () => ({ confirm: () => true }) }); return el; };
let copied = null;
w.copy = (t) => (copied = t);
w.eval("Math.random = () => 0");
w.eval(code);
const panel = [...d.body.children].find((e) => e.textContent.startsWith("Blooket Lite"));
const tab = (n) => [...panel.querySelectorAll("div")].find((e) => e.textContent === n && e.children.length === 0 && e.style.cursor === "pointer");
const card = (n) => [...panel.querySelectorAll("div")].find((e) => e.firstChild?.textContent === n && e.style.cursor === "pointer");
const statusText = () => panel.lastChild.textContent;
const radar = () => panel.children[3];
const isOn = (n) => card(n).style.background === "rgb(47, 143, 91)";

(async () => {
  ok(panel && panel.textContent.includes("Gold"), "detects gold host, shows new-server Gold panel");
  ok(tab("Answers") && tab("Players") && tab("Gold") && !tab("Crypto"), "Gold tab present, Crypto-only tab absent");
  ok(isOn("Auto Answer") && isOn("Correct ESP") && !isOn("Known Only"), "Auto Answer + Correct ESP on by default");
  tab("Gold").click();
  ok(isOn("Chest ESP") && !isOn("Auto Chest") && !isOn("Auto Target"), "Chest ESP on by default, Auto Chest/Target off");

  // Pull Answers ran on load: state key + the set API (only the set's own endpoint answers; the rest "CORS fail").
  await sleep(50);
  ok(fetched.includes(`https://play.blooket.com/api/gamequestionsets?gameId=${SET}`), "pull asks the set API with the set id from state");
  tab("Answers").click(); card("Learned Count").click();
  ok(/^3 answers saved/.test(statusText()), `pulled 3 answers before any question (${statusText()})`);

  // Known question: answered instantly (no human delay).
  showQuestion(1);
  await sleep(150);
  let a = sentOf("playerAnswerQuestion");
  ok(a.length === 1 && a[0].answer === "4", `known question answered instantly (${JSON.stringify(a)})`);
  showQuestion(3);
  await sleep(150);
  a = sentOf("playerAnswerQuestion");
  ok(a.length === 2 && a[1].answer === "Jupiter", "question whose key was in synced state answered instantly");
  // Unknown: quick guess, then learned.
  showQuestion(4);
  await sleep(60);
  ok(sentOf("playerAnswerQuestion").length === 2, "unknown question not clicked instantly");
  await sleep(250);
  ok(sentOf("playerAnswerQuestion").length === 3, "unknown question guessed within ~0.3 s");
  showQuestion(4);
  await sleep(150);
  a = sentOf("playerAnswerQuestion");
  ok(a.length === 4 && a[3].answer === "Blue", "guess learned; repeat answered instantly + correctly");
  // Page renders the text differently from the server (extra spaces / a number badge in the button): still known.
  cur = bank[2];
  emit("showQuestion", { number: 2, text: cur.text, answers: cur.answers });
  main.replaceChildren();
  { const qt = d.createElement("div"); qt.className = "_questionText_1w7yk_73"; qt.textContent = "  Capital   of France? "; main.append(qt); }
  cur.answers.forEach((a, i) => {
    const b = d.createElement("div"); b.className = "_answerButton_1rz5f_14"; b.textContent = `${i + 1} ${a}`;
    b.onclick = () => room.send("playerAnswerQuestion", { answer: a }); main.append(b);
  });
  await sleep(60);
  a = sentOf("playerAnswerQuestion");
  ok(a.length === 5 && a[4].answer === "Paris", `page text differs from the server's: still known, answered instantly (${JSON.stringify(a[4])})`);
  // A dropped click is pressed again until the answer actually goes out.
  deadAnswers = 2; showQuestion(1);
  await sleep(150);
  ok(sentOf("playerAnswerQuestion").length === 5, "dropped clicks: nothing sent yet");
  await sleep(700);
  a = sentOf("playerAnswerQuestion");
  ok(a.length === 6 && a[5].answer === "4", `re-presses until the answer goes out, exactly once (${a.length})`);
  await sleep(400);
  ok(sentOf("playerAnswerQuestion").length === 6, "no extra answers after it went out");
  // Stale page: server already sent the next question but the old buttons are still up -> don't press them.
  const n0 = sentOf("playerAnswerQuestion").length;
  emit("showQuestion", { number: 3, text: bank[3].text, answers: bank[3].answers }); cur = bank[3];
  await sleep(150);
  ok(sentOf("playerAnswerQuestion").length === n0, "doesn't press the previous question's buttons");
  card("Auto Answer").click();

  // Correct ESP (default on)
  showQuestion(2);
  await sleep(250);
  const btns = [...main.querySelectorAll("._answerButton_1rz5f_14")];
  ok(btns.filter((b) => b.style.outline).map((b) => b.textContent).join() === "Paris", "Correct ESP outlines the right answer");
  ok(btns.filter((b) => b.style.opacity === "0.45").length === 3, "Correct ESP fades the wrong ones");

  // Chests: prize list arrives under an unknown message name; found by shape. me 120, rich 5000 -> SWAP is best.
  tab("Gold").click();
  emit("chestChoices", { choices: [{ type: "gold", val: 10, text: "+10 Gold" }, { type: "swap", text: "SWAP!" }, { type: "lose", val: 25, text: "Lose 25%" }] });
  showChests();
  await sleep(250);
  const badges = [...d.querySelectorAll(".bl-chest")].map((e) => e.textContent);
  ok(badges.join("|") === "+10 Gold|★ SWAP!|Lose 25%", `Chest ESP labels every chest, stars the best (${badges})`);
  card("Auto Chest").click(); await sleep(250);
  ok(picked === 1, `Auto Chest opens the best chest (${picked})`);
  picked = null; await sleep(400);
  ok(picked === null, "Auto Chest opens once per chest screen");
  main.replaceChildren(); await sleep(100);
  showChests(); await sleep(100); // same question, no new prize message: still a new chest screen
  ok(picked === 1, `Auto Chest opens again when chests appear again (${picked})`);
  picked = null; deadChests = true; main.replaceChildren(); await sleep(100);
  showChests(); await sleep(100);
  ok(picked !== null, "opens fast (within 100 ms)");
  picked = null; await sleep(400);
  ok(picked !== null, "dropped chest click is pressed again");
  deadChests = false; main.replaceChildren();
  card("Auto Chest").click();

  // Multiply vs gold: me 120 -> Triple (+240) beats +100.
  emit("chestChoices", { choices: [{ type: "gold", val: 100, text: "+100 Gold" }, { type: "multiply", val: 3, text: "Triple Gold!" }, { type: "take", val: 25, text: "Take 25%" }] });
  showChests(); await sleep(250);
  ok(d.querySelectorAll(".bl-chest")[2]?.textContent.startsWith("★"), "Take 25% of 5000 (1250) ranked above Triple (240) and +100");

  // One pre-rolled prize, no per-chest list: banner instead.
  showQuestion(1);
  emit("prizeSelected", { type: "gold", val: 50, text: "+50 Gold" });
  await sleep(250);
  ok(d.querySelector(".bl-prize")?.textContent === "Prize: +50 Gold" && !d.querySelector(".bl-chest"), "single pre-rolled prize shows as a banner");
  card("Chest ESP").click(); await sleep(50);
  ok(!d.querySelector(".bl-prize") && !d.querySelector(".bl-chest"), "Chest ESP clears on off");

  // Auto Target
  card("Auto Target").click();
  showTargets(["rich"]); await sleep(400);
  ok(targeted === null, "one stray name (not a pick screen) is ignored");
  showTargets(["poor", "rich"]); await sleep(400);
  ok(targeted === "rich", `Auto Target picks the richest player (${targeted})`);
  targeted = null; await sleep(500);
  ok(targeted === null, "Auto Target picks once per screen");
  main.replaceChildren(); await sleep(150);
  showTargets(["poor", "rich"]); await sleep(200);
  ok(targeted === "rich", "next Take/Swap screen (same players, no prize message) is picked again");
  targeted = null; deadTargets = true; main.replaceChildren(); await sleep(150);
  showTargets(["poor", "rich"]); await sleep(150);
  ok(targeted === "rich", "picks fast (within 150 ms)");
  targeted = null; await sleep(500);
  ok(targeted === "rich", "dropped target click is pressed again");
  deadTargets = false;
  card("Auto Target").click();

  // Auto Continue: clicks through feedback (-> playerAnswerNext) and prize (-> claimPrize) screens, nothing else.
  card("Auto Continue").click();
  d.elementFromPoint = () => main.querySelector("div div") || main.firstChild; // what sits mid-screen (a player row / an answer)
  emit("answerResult", { isCorrect: true, correctAnswers: ["4"] });
  showContinue("playerAnswerNext"); await sleep(150);
  ok(sentOf("playerAnswerNext").length === 0, "waits for the screen to render");
  await sleep(300);
  ok(sentOf("playerAnswerNext").length === 1, "feedback screen clicked -> playerAnswerNext");
  await sleep(600);
  ok(sentOf("playerAnswerNext").length === 1, "clicks once (stops when the game moved on)");
  showContinue("playerAnswerNext"); await sleep(600);
  ok(sentOf("playerAnswerNext").length === 1, "no click when the game isn't waiting for one");
  room.send("revealPrize", {}); showContinue("claimPrize", "+50 Gold"); await sleep(500);
  ok(sentOf("claimPrize").length === 1, "prize screen clicked (no label: clicks the container) -> claimPrize");
  emit("answerResult", { isCorrect: true, correctAnswers: ["4"] });
  targeted = null; showTargets(["poor", "rich"]); await sleep(600);
  ok(targeted === null && sentOf("playerAnswerNext").length === 1, "never clicks on a Take/Swap pick screen");
  showQuestion(1); await sleep(400);
  ok(sentOf("playerAnswerQuestion").length === n0, "never presses answers (Auto Answer off)");
  delete d.elementFromPoint;
  card("Auto Continue").click();

  // Find Set (backup): copies a helper -> run it on a mock dashboard -> it finds the set from Discover results -> Import.
  tab("Answers").click();
  copied = null;
  let opened = null;
  w.open = (url) => ((opened = url), {});
  card("Find Set (backup)").click(); await sleep(50);
  ok(copied && copied.includes("Color of the sky?") && /Helper copied/.test(statusText()), "Find Set copies a helper carrying the live questions");
  ok(opened === "https://dashboard.blooket.com/discover" && /Discover opened/.test(statusText()), "Find Set opens Discover in a new tab");
  w.open = () => null; card("Find Set (backup)").click(); await sleep(50);
  ok(/Popup blocked/.test(statusText()), `blocked popup is reported (${statusText()})`);
  const SET2 = "650000000000000000000abc", DECOY = "650000000000000000000def";
  const sets = {
    [DECOY]: { _id: DECOY, title: "Decoy", questions: [{ question: "Unrelated?", answers: ["a", "b"], correctAnswers: ["a"] }] },
    [SET2]: { _id: SET2, title: "Mixed Review", questions: [...Object.values(bank), { text: "Fastest land animal?", answers: ["Cheetah", "Horse", "Dog", "Cat"], c: ["Cheetah"] }].map((q) => ({ question: q.text, answers: q.answers, correctAnswers: q.c })) },
  };
  const dash = new JSDOM(`<body></body>`, { runScripts: "outside-only", url: "https://dashboard.blooket.com/discover" });
  const dw = dash.window, dd = dw.document;
  let helperOut = null;
  const dfetched = [];
  dw.fetch = (url) => {
    dfetched.push(url);
    const id = (String(url).match(/gameId=([0-9a-f]{24})/) || [])[1];
    if (String(url).startsWith("https://dashboard.blooket.com/api/games") && sets[id]) return Promise.resolve({ ok: true, json: () => Promise.resolve(sets[id]) });
    if (String(url).includes("search")) return Promise.resolve({ ok: true, clone() { return this; }, json: () => Promise.resolve({ results: [{ _id: DECOY, title: "Decoy" }] }) });
    return Promise.resolve({ ok: false });
  };
  Object.defineProperty(dw.navigator, "clipboard", { value: { writeText: (t) => ((helperOut = t), Promise.resolve()) } });
  dw.eval(copied);
  ok(dd.body.textContent.includes("Find Set"), "helper opens its panel on the dashboard");
  await dw.fetch("https://dashboard.blooket.com/api/search?q=sky"); // the page's own search reply: decoy set
  const link = dd.createElement("a"); link.href = `/set/${SET2}`; dd.body.append(link); // a Discover result link
  await sleep(1800);
  ok(dfetched.some((u) => u.includes(DECOY)) && dfetched.some((u) => u.includes(SET2)), "helper checks sets from API replies AND result links");
  ok(helperOut?.startsWith("BLSET:") && JSON.parse(helperOut.slice(6)).title === "Mixed Review", `helper picks the matching set, not the decoy (${helperOut?.slice(0, 60)})`);
  const closeBtn = [...dd.querySelectorAll("button")].find((b) => b.textContent === "Close");
  const wrapped = dw.fetch; closeBtn.click();
  ok(dw.fetch !== wrapped && !dd.body.textContent.includes("Find Set"), "helper Close restores fetch and removes itself");

  const imp = card("Import Answers"), field = imp.querySelector("input");
  field.value = "garbage"; field.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter" })); await sleep(50);
  ok(/not a Find Set export/.test(statusText()), "Import rejects junk");
  field.value = helperOut; field.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter" })); await sleep(50);
  ok(/^Imported 1 new answers from "Mixed Review" \(5 in set\)/.test(statusText()), `Import learns the new answers (${statusText()})`);

  // Live link: helper in a tab this game opened. Messages travel with real origins; forged ones are ignored.
  const DASH = "https://dashboard.blooket.com", GAME = w.location.origin;
  const dash2 = new JSDOM(`<body><form><input placeholder="Search for a set"></form></body>`, { runScripts: "outside-only", url: `${DASH}/discover` });
  const lw = dash2.window, ld = lw.document;
  const post = (win, data, origin, source) => { const ev = new win.MessageEvent("message", { data: JSON.parse(JSON.stringify(data)), origin }); Object.defineProperty(ev, "source", { value: source }); win.dispatchEvent(ev); };
  const toHelper = { closed: false, postMessage(data, target) { if (target === DASH) post(lw, data, GAME, null); } };
  const SET3 = "650000000000000000000111", SET4 = "650000000000000000000222";
  sets[SET3] = { _id: SET3, title: "Live Set", questions: [{ question: "Linked question?", answers: ["yes", "no"], correctAnswers: ["yes"] }] };
  sets[SET4] = { _id: SET4, title: "Second Set", questions: [{ question: "Another linked one?", answers: ["up", "down"], correctAnswers: ["down"] }] };
  lw.fetch = (url) => {
    const id = (String(url).match(/gameId=([0-9a-f]{24})/) || [])[1];
    return Promise.resolve(String(url).startsWith(`${DASH}/api/games`) && sets[id] ? { ok: true, json: () => Promise.resolve(sets[id]) } : { ok: false });
  };
  let linkClip = null;
  Object.defineProperty(lw.navigator, "clipboard", { value: { writeText: (x) => ((linkClip = x), Promise.resolve()) } });
  Object.defineProperty(lw, "opener", { value: { postMessage(data, target) { if (target === GAME) post(w, data, DASH, toHelper); } } });
  // Tab opened + helper pasted; the helper says hello on its own.
  w.open = () => toHelper; copied = null;
  card("Find Set (backup)").click(); await sleep(50);
  lw.eval(copied); await sleep(30);
  ok(/Find Set linked/.test(statusText()) && ld.body.textContent.includes("Linked to the game"), `tabs link up after pasting (${statusText()})`);
  const searchBox = ld.querySelector("input");
  ok(searchBox.value.length > 0, "helper searches Discover's own box straight away");
  copied = null; card("Find Set (backup)").click(); await sleep(30);
  ok(copied === null && /already linked/.test(statusText()), "pressing Find Set again doesn't open a second tab");
  // A new question in the game reaches the helper, which searches it and finds its set without touching the clipboard.
  emit("showQuestion", { number: 50, text: "Linked question?", answers: ["yes", "no"] }); await sleep(30);
  ok(ld.body.textContent.includes('Search Discover for: "Linked question?"') && searchBox.value === "Linked question?", "new game question reaches the helper and its search box");
  const r1 = ld.createElement("a"); r1.href = `/set/${SET3}`; ld.body.append(r1);
  await sleep(1800);
  ok(/Find Set: 1 new answers from "Live Set"/.test(statusText()) && linkClip === null, `set found -> answers import into the game with no copy/paste (${statusText()})`);
  const learnedBefore = statusText();
  emit("showQuestion", { number: 51, text: "Another linked one?", answers: ["up", "down"] }); await sleep(30);
  const r2 = ld.createElement("a"); r2.href = `/set/${SET4}`; ld.body.append(r2);
  await sleep(1800);
  ok(/Find Set: 1 new answers from "Second Set"/.test(statusText()) && statusText() !== learnedBefore, "a later question not in that set keeps the search going");
  // A set matching only older questions gets sent, but the search goes on for the current one.
  const SET5 = "650000000000000000000333", SET6 = "650000000000000000000444";
  sets[SET5] = { _id: SET5, title: "Old Only", questions: [{ question: "Linked question?", answers: ["yes", "no"], correctAnswers: ["yes"] }, { question: "Extra old?", answers: ["p", "q"], correctAnswers: ["p"] }] };
  sets[SET6] = { _id: SET6, title: "Third Set", questions: [{ question: "Third linked?", answers: ["l", "r"], correctAnswers: ["r"] }] };
  emit("showQuestion", { number: 52, text: "Third linked?", answers: ["l", "r"] }); await sleep(30);
  for (const id of [SET5, SET6]) { const a = ld.createElement("a"); a.href = `/set/${id}`; ld.body.append(a); }
  await sleep(1800);
  ok(/Third Set/.test(statusText()), `a set without the current question doesn't stop the search (${statusText()})`);
  // Forged messages: other origins can't feed answers to either side.
  const forged = 'BLSET:{"title":"Evil","q":[["Evil?",["a","b"],["a"]]]}';
  post(w, { bl: "findset", type: "set", text: forged }, "https://evil.example", null); await sleep(20);
  ok(!/Evil/.test(statusText()), "game ignores answer keys from other origins");
  post(lw, { bl: "findset", type: "questions", q: [{ text: "Forged question?", answers: [] }] }, "https://evil.example", null); await sleep(20);
  ok(!ld.body.textContent.includes("Forged question?"), "helper ignores questions from other origins");
  post(w, { bl: "findset", type: "set", text: forged }, DASH, { postMessage() {} }); await sleep(20);
  ok(!/Evil/.test(statusText()), "game ignores answer keys from a dashboard tab it didn't link with");
  post(w, { bl: "findset", type: "set", text: "junk" }, DASH, toHelper); await sleep(20);
  ok(/not a Find Set export/.test(statusText()), "bad data from the helper is reported, not thrown");
  [...ld.querySelectorAll("button")].find((b) => b.textContent === "Close").click(); await sleep(20);
  ok(/link closed/.test(statusText()), "closing the helper tells the game");
  w.open = () => null; copied = null;
  card("Find Set (backup)").click(); await sleep(30);
  ok(copied !== null, "after the link closes, Find Set offers a new helper");

  // Autoplay on Gold: answer -> continue -> chest -> continue -> target, one switch.
  const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await sleep(20); return fn(); };
  tab("Answers").click();
  card("Autoplay").click();
  const aN = sentOf("playerAnswerQuestion").length, nN = sentOf("playerAnswerNext").length, cN = sentOf("claimPrize").length;
  showQuestion(1);
  ok(await until(() => sentOf("playerAnswerQuestion").length === aN + 1), "Gold Autoplay answers");
  showContinue("playerAnswerNext");
  ok(await until(() => sentOf("playerAnswerNext").length === nN + 1), "Gold Autoplay clicks feedback");
  const rN = sentOf("revealPrize").length;
  showChests();
  ok(await until(() => sentOf("revealPrize").length === rN + 1), "Gold Autoplay opens a chest");
  showContinue("claimPrize", "+50 Gold");
  ok(await until(() => sentOf("claimPrize").length === cN + 1), "Gold Autoplay claims");
  targeted = null; showTargets(["poor", "rich"]);
  ok(await until(() => targeted === "rich"), "Gold Autoplay targets the richest player");
  card("Autoplay").click();
  card("Auto Answer").click();
  cur = { text: "Fastest land animal?", answers: ["Dog", "Cheetah", "Cat", "Horse"], c: ["Cheetah"] }; bank[5] = cur;
  showQuestion(5); await sleep(150);
  ok(sentOf("playerAnswerQuestion").slice(-1)[0]?.answer === "Cheetah", "imported answer used instantly");
  card("Auto Answer").click();

  tab("Players").click();
  card("Player Radar").click(); await sleep(1100);
  const lines = [...radar().children].map((e) => e.textContent);
  ok(lines[1].startsWith("★ rich — 5,000") && lines[3].startsWith("3. me — 120"), `radar falls back to gold when there's no score (${JSON.stringify(lines)})`);
  card("Player Radar").click();

  // Record Messages: passive, restores everything, copies a log. Fake the 60 s timer.
  const realST = w.setTimeout; let fire;
  w.setTimeout = (fn, ms) => (ms === 60000 ? (fire = fn) : realST(fn, ms));
  tab("Gold").click();
  const before = room.send;
  card("Record Messages").click(); await sleep(50);
  ok(room.send !== before, "recorder wraps send");
  emit("prizeSelected", { type: "multiply", val: 2, text: "Double Gold!" });
  room.send("playerRequestPrize", {});
  fire();
  w.setTimeout = realST;
  ok(room.send === before, "recorder restores send");
  const log = JSON.parse(copied || "{}").log || [];
  ok(log.some((e) => e.type === "prizeSelected") && log.some((e) => e.SENT === "playerRequestPrize"), "recorder copies incoming + sent messages");
  ok(sentOf("playerRequestPrize").length === 1, "recorder never sends anything itself");

  panel.querySelector("span").click(); panel.querySelector("span").click();
  ok(room.send === origSend, "close restores room.send");
  ok(Object.values(room.onMessageHandlers.events).every((l) => l.length === 0), "close removes every listener");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

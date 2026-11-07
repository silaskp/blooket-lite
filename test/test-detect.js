// Game detection on a host that doesn't say which game it is: the per-game tab must load once the game is recognised.
const { JSDOM } = require(process.env.JSDOM || "jsdom");
const code = require("fs").readFileSync(__dirname + "/../blooket-lite.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : fail++, console.log((c ? "PASS " : "FAIL ") + m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot(state, handlerTypes = [], url = "https://game.blooket.com/G1/play/P1", withRoom = true) {
  const dom = new JSDOM(`<body><div id=root></div></body>`, { runScripts: "outside-only", url });
  const w = dom.window, d = w.document;
  const room = {
    sessionId: "me1", name: "main", state,
    onMessageHandlers: { events: Object.fromEntries(handlerTypes.map((t) => [t, [() => {}]])) },
    onMessage(type, cb) { const ev = this.onMessageHandlers.events; (ev[type] ||= []).push(cb); return () => { ev[type] = ev[type].filter((x) => x !== cb); }; },
    send() {},
  };
  const emit = (type, msg) => {
    const ev = room.onMessageHandlers.events;
    if (ev[type]) ev[type].slice().forEach((cb) => cb(msg)); // colyseus.js dispatchMessage: per-type handlers if the key exists,
    else (ev["*"] || []).slice().forEach((cb) => cb(type, msg)); // else "*" (an empty array still counts as "exists")
  };
  if (withRoom) d.getElementById("root").__reactContainer$x = { child: { type: { _context: {} }, memoizedProps: { value: { room } }, child: null } };
  w.fetch = () => Promise.reject(new TypeError("x"));
  const realCreate = d.createElement.bind(d);
  d.createElement = (t, ...r) => { const el = realCreate(t, ...r); if (t == "iframe") Object.defineProperty(el, "contentWindow", { get: () => ({ confirm: () => true }) }); return el; };
  w.eval(code);
  const panel = [...d.body.children].find((e) => e.textContent.startsWith("Blooket Lite"));
  const tab = (n) => [...panel.querySelectorAll("div")].find((e) => e.textContent === n && e.children.length === 0 && e.style.cursor === "pointer");
  const card = (n) => [...panel.querySelectorAll("div")].find((e) => e.firstChild?.textContent === n && e.style.cursor === "pointer");
  const tabs = () => [...panel.children[1].children].map((e) => e.textContent);
  return { w, d, room, emit, panel, tab, tabs, card, title: () => panel.firstChild.firstChild.textContent, status: () => panel.lastChild.textContent };
}

(async () => {
  // 1. Crypto, recognised from the synced player state.
  let g = boot({ players: { me: { sessionId: "me1", score: 10, defensiveHackType: "" } } });
  ok(g.tab("Crypto") && !g.tab("Gold") && g.title() === "Blooket Lite · Crypto", "crypto recognised from state -> Crypto tab + title");
  ok(/Crypto Hack detected/.test(g.status()), `says so (${g.status()})`);

  // 2. Crypto, recognised from the game's own message handlers.
  g = boot({ players: { me: { sessionId: "me1", score: 10 } } }, ["showQuestion", "hackPasswordOptions"]);
  ok(g.tab("Crypto"), "crypto recognised from the game's registered handlers");

  // 3. Nothing to go on yet -> no game tab; then a gold prize arrives -> Gold tab, its default-on module starts.
  g = boot({ players: { me: { sessionId: "me1", score: 10 } } }, ["showQuestion"]);
  ok(!g.tab("Gold") && !g.tab("Crypto") && g.title() === "Blooket Lite · Live", "unknown game: base tabs only");
  g.emit("showQuestion", { number: 1, text: "Who started the gold rush? (password hint)", answers: ["a", "b"] });
  await sleep(50);
  ok(!g.tab("Gold") && !g.tab("Crypto"), "words inside a question don't count");
  g.emit("prizeSelected", { type: "gold", val: 50, text: "+50 Gold" });
  await sleep(50);
  ok(g.tab("Gold") && !g.tab("Crypto") && g.title() === "Blooket Lite · Gold", "gold recognised from a prize message -> Gold tab");
  g.tab("Gold").click();
  ok(g.card("Chest ESP").style.background === "rgb(47, 143, 91)", "Gold's default-on Chest ESP started when the tab loaded");
  g.emit("hackPasswordOptions", { passwordIndexes: [1], targetPlayerName: "x" });
  await sleep(50);
  ok(!g.tab("Crypto"), "once identified, the game doesn't flip");

  // 4. Gold recognised from players having gold.
  g = boot({ players: { me: { sessionId: "me1", gold: 0 } } });
  ok(g.tab("Gold"), "gold recognised from state");

  // 5. Host wins: gold. host never grows a Crypto tab.
  g = boot({ players: { me: { sessionId: "me1", defensiveHackType: "" } } }, [], "https://gold.blooket.com/G1/play/P1");
  ok(g.tab("Gold") && !g.tab("Crypto"), "host says gold -> stays gold");

  // 6. Close stops the late-loaded module too.
  g = boot({ players: { me: { sessionId: "me1", gold: 0 } } });
  g.panel.querySelector("span:last-child").click(); g.panel.querySelector("span:last-child").click();
  await sleep(50);
  ok(!g.d.body.contains(g.panel) && Object.values(g.room.onMessageHandlers.events).every((l) => l.length <= 1), "close removes panel + our listeners after a late load");

  // 7. An old host (play.blooket.com) that turns out to hold a Colyseus room still gets the new-server panel.
  g = boot({ players: { me: { sessionId: "me1" } } }, [], "https://play.blooket.com/play/x", true);
  ok(g.tab("Answers") && g.title() === "Blooket Lite · Live", "play. host with a Colyseus room -> new-server panel");

  // 8. An old host with no room: a clear message, no tabs, and close still works.
  g = boot({}, [], "https://play.blooket.com/play/gold", false);
  ok(g.tabs().length === 0 && /No supported game/.test(g.status()), `play. host without a room -> unsupported message (${g.status()})`);
  g.panel.querySelector("span:last-child").click(); g.panel.querySelector("span:last-child").click();
  ok(!g.d.body.contains(g.panel), "unsupported panel closes");

  // 9. Password index 0 is a real password: a correct guess of 0 is remembered.
  g = boot({ players: { me: { sessionId: "me1" } } }, [], "https://cyber.blooket.com/G1/play/P1");
  g.emit("hackPasswordOptions", { passwordIndexes: [0, 5, 9], targetPlayerName: "t" });
  g.room.send("submitPasswordGuess", { passwordIndex: 0 });
  g.emit("passwordGuessResult", { correct: true });
  g.emit("hackPasswordOptions", { passwordIndexes: [9, 5, 0], targetPlayerName: "t" });
  g.tab("Crypto").click();
  g.card("Password ESP").click();
  await sleep(250);
  ok(/t's password: option #0/.test(g.status()), `a correct guess of index 0 is learned (${g.status()})`);
  g.card("Password ESP").click();

  // 10. A hack that never got a result is over once the next question arrives: Auto Guess must not fire into it.
  g = boot({ players: { me: { sessionId: "me1" } } }, [], "https://cyber.blooket.com/G1/play/P1");
  const sent10 = []; g.room.send = (t, m) => sent10.push(t); // what the game would send (our hook wraps this on the next tick)
  await sleep(1100);
  g.emit("hackPasswordOptions", { passwordIndexes: [3, 4], targetPlayerName: "u" });
  g.emit("showQuestion", { number: 1, text: "Next?", answers: ["a", "b"] });
  g.tab("Crypto").click(); g.card("Auto Guess").click();
  await sleep(2400);
  ok(!sent10.includes("submitPasswordGuess"), `no guess on a hack that ended without a result (${sent10})`);
  g.card("Auto Guess").click();

  // 11. A remembered password that later guesses wrong is forgotten (they changed it).
  g = boot({ players: { me: { sessionId: "me1" } } }, [], "https://cyber.blooket.com/G1/play/P1");
  g.emit("hackPasswordOptions", { passwordIndexes: [5, 7, 9], targetPlayerName: "v" });
  g.room.send("submitPasswordGuess", { passwordIndex: 5 }); g.emit("passwordGuessResult", { correct: true });
  g.emit("hackPasswordOptions", { passwordIndexes: [5, 7, 9], targetPlayerName: "v" });
  g.room.send("submitPasswordGuess", { passwordIndex: 5 }); g.emit("passwordGuessResult", { correct: false });
  g.emit("hackPasswordOptions", { passwordIndexes: [9, 5, 7], targetPlayerName: "v" });
  g.tab("Crypto").click(); g.card("Password ESP").click(); await sleep(250);
  ok(!/option #5/.test(g.status()) && /2 possible/.test(g.status()), `a password that failed is dropped (${g.status()})`);
  g.card("Password ESP").click();

  // 12. A message type the game starts handling AFTER we hooked in still gets read (colyseus.js skips "*" for handled types).
  g = boot({ players: { me: { sessionId: "me1" } } });
  g.room.onMessage("chestOptions", () => {}); // a screen mounting and registering its handler
  await sleep(1100);
  g.emit("chestOptions", { list: [{ type: "gold", val: 10, text: "+10 Gold" }, { type: "gold", val: 50, text: "+50 Gold" }, { type: "lose", val: 25, text: "Lose 25%" }] });
  await sleep(50);
  ok(g.tab("Gold"), "a late-registered message type is still read (game recognised from it)");

  // 13. After close, no empty handler lists are left behind (they would starve the game's own "*").
  const ev13 = g.room.onMessageHandlers.events;
  g.panel.querySelector("span:last-child").click(); g.panel.querySelector("span:last-child").click();
  ok(!("showQuestion" in ev13) && !("*" in ev13) && ev13.chestOptions?.length === 1, `close deletes the lists only we used (${Object.keys(ev13)})`);

  // 14. Not a Blooket page: nothing hooks.
  g = boot({ players: { me: { sessionId: "me1" } } }, [], "https://example.com/x");
  ok(g.tabs().length === 0 && /No supported game/.test(g.status()), "non-Blooket host -> unsupported");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

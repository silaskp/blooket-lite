/*
 * Blooket Lite
 * Copyright (c) 2026 silaskp. MIT License, see LICENSE.
 *
 * A small helper panel for Blooket, pasted into the DevTools console. It works in two places:
 *   - The new game server (per-mode hosts like cyber.blooket.com and gold.blooket.com, which run on Colyseus).
 *     The server grades answers and rolls prizes there, so this script learns each correct answer from the
 *     server's reply and replays it, shows pre-rolled prizes, tracks hack passwords and can autoplay.
 *   - Solo mode (solo.blooket.com). Answers are graded server-side, so it learns them the same way and saves
 *     them per question set.
 * Run it again (or press \) to show/hide the panel. The X button stops everything and removes it.
 */
(() => {
    const KEY = Symbol.for("bl.lite");
    if (window[KEY]) return window[KEY].toggle();

    // ---------- solo engine (solo.blooket.com, Next.js) ----------
    // Solo submits answers through a Next server action: POST with a Next-Action header and body
    // [gameId, questionNumber, answer, msTaken]. The reply's RSC line holds result.correctAnswers.
    // We record that per question and replay it next time the question comes up.

    const SOLO = location.hostname.startsWith("solo.");
    const SOLO_REPLY = Symbol.for("bl.soloReply");
    const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const solo = {
        setId: new URLSearchParams(location.search).get("id") || "unknown",
        known: {},
        learned: 0,
        storeKey() { return `bl.solo.${this.setId}`; },
        load() { try { this.known = JSON.parse(localStorage.getItem(this.storeKey()) || "{}"); } catch { this.known = {}; } },
        save() { try { localStorage.setItem(this.storeKey(), JSON.stringify(this.known)); } catch {} },
        // What's on screen right now, read from the DOM (shared by every solo mode).
        screen() {
            const text = document.querySelector("[class*='questionText']")?.textContent || "";
            const img = document.querySelector("[class*='questionImage']")?.getAttribute("src") || "";
            const buttons = [...document.querySelectorAll("button[class*='answerButton']")];
            const answers = buttons.map((b) => b.querySelector("[class*='answerText']")?.textContent ?? b.textContent);
            const typing = document.querySelector("[class*='typingAnswer'] input, input[placeholder='Type answer here']");
            const next = document.querySelector("[class*='goNextButton']");
            const open = buttons.some((b) => !b.disabled && !/answerButtonDisabled/.test(b.className));
            return { text, img, buttons, answers, typing, next, open };
        },
        // Answers shuffle ("random": true), so key on question text + image + the SET of answers, never order.
        keyOf(s) { return [norm(s.text), s.img, s.answers.map(norm).sort().join("|")].join("#"); },
        lookup(s) { return this.known[this.keyOf(s)] || null; },
    };
    if (SOLO) {
        // Resolve the question-set id so learned answers carry over to new solo sessions on the same set.
        fetch(`/api/data/gameanswers?id=${solo.setId}`).then((r) => r.json()).then((j) => {
            if (!j?.questionSetId) return;
            const old = solo.known;
            solo.setId = j.questionSetId;
            solo.load();
            Object.assign(solo.known, old);
            solo.save();
        }).catch(() => {});
        solo.load();

        // The fetch hook is installed once per page (re-wrapping fetch on every run would stack). It reports to
        // whichever panel is open right now through this window slot, and to nobody after ✕.
        window[SOLO_REPLY] = {
            key: () => solo.keyOf(solo.screen()),
            learn(key, correct) {
                if (!solo.known[key]) solo.learned++;
                solo.known[key] = correct;
                solo.save();
            },
        };
        const SOLO_FLAG = Symbol.for("bl.soloFetch");
        if (!window.fetch[SOLO_FLAG]) {
            const orig = window.fetch;
            const hooked = async function (input, init) {
                let key = null;
                try {
                    const h = init?.headers;
                    const isAction = h && (h["Next-Action"] || h["next-action"] || h.get?.("Next-Action"));
                    const body = isAction && typeof init.body == "string" ? JSON.parse(init.body) : null;
                    // Capture the on-screen question at submit time, before React swaps it out.
                    if (Array.isArray(body) && body.length == 4 && typeof body[1] == "number") key = window[SOLO_REPLY]?.key() ?? null;
                } catch {}
                const res = await orig.apply(this, arguments);
                if (key) res.clone().text().then((t) => {
                    for (const line of t.split("\n")) {
                        const json = line.slice(line.indexOf(":") + 1);
                        if (!json.includes("correctAnswers")) continue;
                        try {
                            const correct = JSON.parse(json)?.data?.result?.correctAnswers;
                            if (Array.isArray(correct) && correct.length) window[SOLO_REPLY]?.learn(key, correct);
                        } catch {}
                    }
                }).catch(() => {});
                return res;
            };
            hooked[SOLO_FLAG] = true;
            hooked.toString = () => orig.toString();
            window.fetch = hooked;
        }
    }

    // Randomised human delay before answering: solo sends ms-taken to the server (Colyseus tracks it too).
    const humanDelay = () => 1200 + Math.random() * 2300;
    function setInputValue(input, value) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function pressEnter(el) {
        for (const type of ["keydown", "keypress", "keyup"])
            el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    }

    const soloAuto = {
        pendingKey: null, timer: null,
        step(guessUnknown) {
            const s = solo.screen();
            if (s.next && s.next.offsetParent !== null) {
                if (this.pendingKey == "next") return;
                this.pendingKey = "next";
                clearTimeout(this.timer);
                this.timer = setTimeout(() => {
                    this.pendingKey = null;
                    const n = solo.screen().next;
                    n && n.offsetParent !== null && n.click();
                }, 400 + Math.random() * 600);
                return;
            }
            if (!s.open && !s.typing) return;
            const key = solo.keyOf(s);
            if (this.pendingKey == key) return; // already scheduled for this question
            const correct = solo.lookup(s);
            if (!correct && !guessUnknown) return;
            this.pendingKey = key;
            clearTimeout(this.timer);
            this.timer = setTimeout(() => {
                const now = solo.screen();
                if (solo.keyOf(now) != key) return (this.pendingKey = null);
                if (now.typing) {
                    setInputValue(now.typing, correct ? correct[0] : "?");
                    pressEnter(now.typing);
                    now.typing.form?.requestSubmit?.();
                    return;
                }
                let i = correct ? now.answers.findIndex((a) => correct.map(norm).includes(norm(a))) : -1;
                if (i < 0) i = Math.floor(Math.random() * now.buttons.length); // unknown: guess, then learn from the reply
                now.buttons[i]?.click();
            }, humanDelay());
        },
        reset() { clearTimeout(this.timer); this.timer = null; this.pendingKey = null; },
    };
    function soloHighlight() {
        const s = solo.screen();
        const good = (s.open && solo.lookup(s)?.map(norm)) || [];
        // Set or clear on every tick: React reuses the button elements between questions.
        s.buttons.forEach((b, i) => (b.style.outline = good.includes(norm(s.answers[i])) ? "4px solid rgb(0, 207, 119)" : ""));
    }

    // ---------- Colyseus engine (per-mode hosts like cyber.blooket.com, since ~Sep 2026) ----------
    // These modes run on a Colyseus game server, not Firebase: the server grades answers, rolls prizes and
    // checks hack passwords, so the old write cheats have nothing to write to. What the server DOES send us:
    //   answerResult {isCorrect, correctAnswers}   -> learn each answer, replay it next time
    //   prizeSelected {type, val, text}            -> the prize is rolled before you pick a box
    //   hackPasswordOptions {passwordIndexes, targetPlayerName} + passwordGuessResult {correct}
    //       -> the target's real password is in EVERY option list for them, so intersecting lists finds it
    //   room.state.players / hackEvents            -> everyone's score, stage and who hacked whom

    // Per-mode hosts are the new server. On any other Blooket host, look for a Colyseus room before giving up.
    const BLOOKET = location.hostname == "blooket.com" || location.hostname.endsWith(".blooket.com");
    const COLY = BLOOKET && !SOLO && (!["play", "www", "dashboard", "blooket"].includes(location.hostname.split(".")[0]) || !!findRoom());
    const CYBER = COLY && location.hostname.startsWith("cyber.");
    const GOLD = COLY && location.hostname.startsWith("gold."); // Gold Quest on the new server
    const coly = {
        room: null, hooked: null, unbind: [], origSend: null,
        q: null, qSeq: 0, learned: 0, known: {},
        answeredSeq: -1, targetSentAt: 0, revealSentAt: 0, // last question we (or the game) answered; last swapOrTake / revealPrize sent
        cont: null, // a "click to continue" screen is up: { msg: what the game sends when it's clicked, since }
        prize: null, hack: null, hackSeq: 0, lastGuess: null,
        chests: null, chestSeq: 0, prizeSeq: 0, // Gold: per-chest prizes if the server sends them, bumped on every prize message
        pulled: new Set(), // set ids already fetched by Pull Answers
        sniffing: new Set(), // message types we already listen on
        seen: [], // questions asked this game (text + answers), for Find Set
        pw: {}, // target name -> { sets: [[idx…]…], known: idx|null, wrong: Set }
        tell: { first: 0, n: 0 }, // how often the target's password was first in the server's list
        storeKey: "bl.coly.answers",
        boxUp: false, // Crypto: a prize is rolled and the box pick hasn't gone out yet
        link: null, // the Find Set tab, once its helper says hello
        speed: { answer: 0, next: 250 }, // ms before clicking an answer (0 = instant) / a continue screen. Saved in bl.coly.speed
        load() {
            try { this.known = JSON.parse(localStorage.getItem(this.storeKey) || "{}"); } catch { this.known = {}; }
            try { Object.assign(this.speed, JSON.parse(localStorage.getItem("bl.coly.speed") || "{}")); } catch {}
        },
        save() { try { localStorage.setItem(this.storeKey, JSON.stringify(this.known)); } catch {} },
        // Answers shuffle between asks, so key on question text + the SET of answers.
        keyOf(text, answers) { return norm(text) + "#" + answers.map(norm).sort().join("|"); },
    };
    function walkFibers(visit) {
        const rootEl = document.getElementById("root") || document.querySelector("body>div");
        const k = rootEl && Object.keys(rootEl).find((x) => x.startsWith("__reactContainer"));
        if (!k) return;
        const stack = [rootEl[k].stateNode?.current || rootEl[k]];
        for (let n = 0; stack.length && n < 50000; n++) {
            const f = stack.pop();
            if (visit(f)) return;
            if (f.sibling) stack.push(f.sibling);
            if (f.child) stack.push(f.child);
        }
    }
    function findRoom() {
        let room = null;
        walkFibers((f) => {
            const v = f.type?._context && f.memoizedProps?.value;
            if (v?.room && typeof v.room.send == "function") return (room = v.room);
        });
        return room;
    }
    const pwOf = (name) => (coly.pw[name] ||= { sets: [], known: null, wrong: new Set() });
    // Best guess for a target's password among this hack's options.
    function pwCandidates(name, options) {
        const t = pwOf(name);
        if (t.known != null && options.includes(t.known)) return [t.known];
        const c = options.filter((i) => !t.wrong.has(i) && t.sets.every((s) => s.includes(i)));
        if (c.length) return c;
        // Nothing fits: they must have changed their password. Start over from this list.
        Object.assign(t, { sets: [options], known: null, wrong: new Set() });
        return options.slice();
    }
    function hookRoom() {
        const room = findRoom();
        if (!room) throw new Error("No Blooket game found on this page.");
        coly.room = room;
        // Pull the answer key before the game starts: every 5 s for the first 2 min, until something comes back.
        const now = Date.now();
        if (!coly.pullDone && now - (coly.pullAt || 0) > 5000 && (coly.pullTries = (coly.pullTries || 0) + 1) <= 24) {
            coly.pullAt = now;
            pullAnswers(true).then((n) => n && (coly.pullDone = true), () => {});
        }
        if (coly.hooked === room) return sniffNewTypes(room), detectGame(room), room;
        unhookRoom();
        detectGame(room, Object.keys(room.onMessageHandlers?.events || {}).join(" ")); // the game's own handlers, before ours
        const on = (type, cb) => { const off = room.onMessage(type, cb); typeof off == "function" && coly.unbind.push(off); };
        on("showQuestion", (m) => {
            if (!m?.text) return;
            coly.q = m; coly.qSeq++; coly.prize = null; coly.boxUp = false; coly.cont = null; coly.hack = null; coly.lastGuess = null; noteSeen(m.text, m.answers); // a hack that never got a result is over
            colyAuto.kick(); // answer as soon as the buttons render, not on the next tick
        });
        on("answerResult", (m) => {
            coly.answeredSeq = coly.qSeq;
            coly.cont = { msg: "playerAnswerNext", since: Date.now() }; // feedback screen: click to go on
            const q = coly.q || colyScreen();
            const correct = m?.correctAnswers;
            if (!q?.text || !Array.isArray(correct) || !correct.length) return;
            const key = coly.keyOf(q.text, q.answers);
            if (!coly.known[key]) coly.learned++;
            coly.known[key] = correct;
            coly.save();
        });
        on("prizeSelected", (m) => { if (m?.text) { coly.prize = m; coly.prizeSeq++; coly.boxUp = true; } });
        // Gold's message names aren't captured yet: read any message that looks like a prize or carries answers.
        // colyseus.js only calls "*" for types nobody handles, so also listen on every type the game handles.
        on("*", (type, m) => sniff(type, m));
        sniffNewTypes(room);
        on("hackPasswordOptions", (m) => {
            if (!Array.isArray(m?.passwordIndexes) || !m.targetPlayerName) return;
            coly.hack = { target: m.targetPlayerName, options: m.passwordIndexes, seq: ++coly.hackSeq }; coly.lastGuess = null; // global counter: hack is nulled after each result
            pwOf(m.targetPlayerName).sets.push(m.passwordIndexes);
        });
        on("passwordGuessResult", (m) => {
            const g = coly.lastGuess, h = coly.hack;
            if (g == null || !h || !m || typeof m.correct != "boolean") return; // index 0 is a real password
            const t = pwOf(h.target);
            if (m.correct) {
                t.known = g;
                coly.tell.n++;
                if (h.options[0] === g) coly.tell.first++;
            } else {
                t.wrong.add(g);
                if (t.known === g) Object.assign(t, { known: null, sets: [h.options] }); // they changed it
                if (h.options[0] === g) coly.tell.n++; // the first option was wrong: the "first = right" tell is broken
            }
            coly.lastGuess = null;
            coly.hack = null;
            coly.prize = null; // that was the hack prize; it's spent
            coly.cont = { msg: "playerGetNewQuestion", since: Date.now() }; // hack result screen: click to go on
        });
        // Observe (never alter) our own guesses so results can be credited to the right option.
        const orig = room.send;
        room.send = function (type, msg) {
            if (type == "submitPasswordGuess") coly.lastGuess = msg?.passwordIndex;
            if (type == "playerAnswerQuestion") coly.answeredSeq = coly.qSeq;
            if (type == "swapOrTake") coly.targetSentAt = Date.now();
            // Gold, from the live log: answer -> feedback -(click)-> playerAnswerNext -> chests -(pick)-> revealPrize
            // -> prize shown -(click)-> claimPrize -> next question (or the Take/Swap pick screen).
            if (type == "revealPrize") { coly.revealSentAt = Date.now(); coly.cont = { msg: "claimPrize", since: Date.now() }; }
            // Crypto names its prize step playerRequestPrize. Hacking is a choice screen, not a continue screen.
            if (type == "playerRequestPrize") { coly.boxUp = false; coly.cont = { msg: "claimPrize", since: Date.now() }; }
            if (type == "claimPrize") coly.boxUp = false;
            if (type == "requestHackPasswordOptions") coly.cont = null;
            if (coly.cont && type == coly.cont.msg) coly.cont = null;
            return orig.apply(this, arguments);
        };
        room.send.toString = () => orig.toString();
        coly.origSend = orig;
        coly.hooked = room;
        return room;
    }
    // Prize-shaped: {type|text, val|amount|text}, but not a question / answer result / hack message.
    const isPrize = (o) => !!o && typeof o == "object" && !Array.isArray(o) && !("answers" in o) && !("correctAnswers" in o) && !("passwordIndexes" in o)
        && (typeof o.text == "string" || typeof o.type == "string") && ("val" in o || "amount" in o || "text" in o);
    const sniffed = new WeakSet(); // "*" and the per-type listener can both fire for one message
    function sniff(type, m) {
        if (!m || typeof m != "object" || sniffed.has(m)) return;
        sniffed.add(m);
        harvest(m);
        // Question text can say anything ("gold rush", "password"), so only prize-ish messages lend their words.
        detectGame(coly.room, /question|answer/i.test(type) ? type : `${type} ${typeof m.text == "string" ? m.text : ""} ${typeof m.type == "string" ? m.type : ""}`);
        if (type == "showQuestion" || type == "answerResult") return;
        const lists = [m, ...Object.values(m)].filter((v) => Array.isArray(v) && v.length >= 2 && v.length <= 4 && v.every(isPrize));
        if (lists.length) { coly.chests = lists[0]; coly.chestSeq++; coly.prizeSeq++; }
        else if (type != "prizeSelected" && isPrize(m) && !/result|guess|hack/i.test(type)) { coly.prize = m; coly.prizeSeq++; }
    }
    let loadGame = () => {}; // set once the panel exists
    // Which game is this? Game-registered message types, room name, synced state shape, then message contents.
    function detectGame(room, words = "") {
        if (game || !room) return;
        const st = room.state?.toJSON?.() ?? room.state ?? {};
        const ps = Object.values(st.players || {}).filter((p) => p && typeof p == "object");
        words = `${room.name ?? ""} ${words}`;
        if (/hack|password|crypto|cyber/i.test(words) || "hackEvents" in st || ps.some((p) => "defensiveHackType" in p || "crypto" in p)) loadGame("crypto");
        else if (/gold|chest|swap/i.test(words) || ps.some((p) => "gold" in p)) loadGame("gold");
    }
    // Listens on each type the game has a handler for, including ones it adds later (screens register on mount).
    function sniffNewTypes(room) {
        for (const type of Object.keys(room.onMessageHandlers?.events || {})) {
            if (type == "*" || coly.sniffing.has(type)) continue;
            coly.sniffing.add(type);
            const off = room.onMessage(type, (m) => sniff(type, m));
            typeof off == "function" && coly.unbind.push(off);
        }
    }
    function unhookRoom() {
        coly.unbind.splice(0).forEach((off) => { try { off(); } catch {} });
        coly.sniffing.clear();
        // An empty handler list still counts as "handled" in colyseus.js, which would starve the game's own "*".
        const ev = coly.hooked?.onMessageHandlers?.events;
        if (ev) for (const [k, l] of Object.entries(ev)) if (Array.isArray(l) && !l.length) delete ev[k];
        if (coly.hooked && coly.origSend) coly.hooked.send = coly.origSend;
        coly.hooked = null;
        coly.origSend = null;
    }
    // Same question/answer DOM as solo (shared component library).
    function colyScreen() {
        const text = document.querySelector("[class*='questionText']")?.textContent || "";
        const buttons = [...document.querySelectorAll("[class*='_answerButton_']")];
        const answers = buttons.map((b) => b.querySelector("[class*='answerText']")?.textContent ?? b.textContent);
        return { text, buttons, answers };
    }
    // The question on screen, keyed the way answers are learned: the server's showQuestion text/answers when the
    // buttons show that question, else the page's own text (script pasted mid-question). map[j] = button for answers[j].
    // Fix: keying on the page text missed answers whenever the page rendered text differently from the server.
    function colyQuestion() {
        const s = colyScreen();
        if (!s.buttons.length) return null;
        const q = coly.q, shown = s.answers.map(norm);
        if (q?.text && Array.isArray(q.answers) && q.answers.length == s.buttons.length) {
            const want = q.answers.map((a) => norm(a)), used = new Set();
            const pick = (test) => want.map((a, j) => {
                const i = shown.findIndex((b, i) => !used.has(i) && test(a, b));
                return i >= 0 ? (used.add(i), i) : -1;
            });
            let map = pick((a, b) => a == b);
            if (map.includes(-1)) { used.clear(); map = pick((a, b) => a == b || (a && b && (b.includes(a) || a.includes(b)))); }
            const blank = shown.every((b) => !b); // picture answers: trust the server's order
            const st = norm(s.text), qt = norm(q.text);
            const sameQ = !st || st == qt || st.includes(qt) || qt.includes(st);
            if (blank && sameQ) return { text: q.text, answers: q.answers.map(String), buttons: s.buttons, map: want.map((_, j) => j) };
            if (!map.includes(-1) && sameQ) return { text: q.text, answers: q.answers.map(String), buttons: s.buttons, map };
            if (!sameQ || shown.some(Boolean)) return st ? { text: s.text, answers: s.answers, buttons: s.buttons, map: s.answers.map((_, i) => i), stale: !sameQ } : null;
        }
        if (!s.text) return null;
        return { text: s.text, answers: s.answers, buttons: s.buttons, map: s.answers.map((_, i) => i) };
    }
    // The element that actually takes the click: the button, a child with a React onClick, or a clickable parent.
    function pressTarget(b) {
        const has = (e) => { const k = Object.keys(e).find((x) => x.startsWith("__reactProps")); return k && (e[k]?.onClick || e[k]?.onMouseDown || e[k]?.onPointerDown); };
        if (has(b)) return b;
        return [...b.querySelectorAll("*")].find(has) || clickable(b) || b;
    }
    function press(el) {
        const t = pressTarget(el), o = { bubbles: true, cancelable: true, view: window, button: 0 };
        const P = window.PointerEvent || MouseEvent;
        t.dispatchEvent(new P("pointerdown", o)); t.dispatchEvent(new MouseEvent("mousedown", o));
        t.dispatchEvent(new P("pointerup", o)); t.dispatchEvent(new MouseEvent("mouseup", o));
        t.click();
    }
    // Exact key first; else a saved question with the same text whose right answer is on screen (pulled sets can
    // list the answers slightly differently).
    function knownFor(text, answers) {
        const hit = coly.known[coly.keyOf(text, answers)];
        if (hit) return hit;
        const pre = norm(text) + "#", on = answers.map(norm);
        if (pre == "#") return null;
        for (const [k, v] of Object.entries(coly.known)) if (k.startsWith(pre) && v.some((c) => on.includes(norm(c)))) return v;
        return null;
    }
    function learn(text, answers, correct) {
        if (!text || !Array.isArray(answers) || !Array.isArray(correct) || !correct.length) return false;
        const key = coly.keyOf(text, answers);
        const fresh = !coly.known[key];
        if (fresh) coly.learned++;
        coly.known[key] = correct.map(String);
        return fresh;
    }
    // Walks any object for question records that carry their answer key.
    const NO_WALK = new Set(["_owner", "_store", "_debugOwner", "return", "alternate", "child", "sibling", "stateNode", "ref"]);
    function harvest(o, depth = 0, seen = new WeakSet()) {
        if (!o || typeof o != "object" || depth > 7 || seen.has(o) || o instanceof Node || o === window) return 0;
        seen.add(o);
        let n = 0;
        const text = o.question ?? o.text;
        if (typeof text == "string" && Array.isArray(o.answers) && Array.isArray(o.correctAnswers) && o.correctAnswers.length) {
            if (learn(text, o.answers.map(String), o.correctAnswers)) n++;
            return n;
        }
        const vals = Array.isArray(o) ? o : Object.entries(o).filter(([k]) => !NO_WALK.has(k)).map(([, v]) => v);
        for (const v of vals.slice(0, 500)) n += harvest(v, depth + 1, seen);
        if (n && depth == 0) coly.save();
        return n;
    }
    const hexIds = (o) => [...new Set((JSON.stringify(o ?? null).match(/\b[0-9a-f]{24}\b/g) || []))];
    // Tries to get the whole answer key before the first question: from the synced state, from anything React holds,
    // then from Blooket's question-set API with every set id we can see. One request per id per page load.
    async function pullAnswers(quiet) {
        const room = coly.room || findRoom();
        const state = room?.state?.toJSON?.() ?? room?.state;
        let n = harvest(state);
        const ids = new Set([...hexIds(state), ...hexIds(location.pathname)]);
        let nodes = 0;
        const seen = new WeakSet(); // one for the whole walk: fibers share most of what they hold
        walkFibers((f) => {
            for (const v of [f.memoizedProps, f.memoizedState]) {
                if (!v || typeof v != "object") continue;
                n += harvest(v, 0, seen);
                for (const [k, x] of Object.entries(v)) if (/set|game|id/i.test(k) && typeof x == "string" && /^[0-9a-f]{24}$/.test(x)) ids.add(x);
            }
            return ++nodes > 4000;
        });
        const urls = (id) => [
            `https://play.blooket.com/api/gamequestionsets?gameId=${id}`,
            `https://dashboard.blooket.com/api/games?gameId=${id}`,
            `/api/gamequestionsets?gameId=${id}`,
        ];
        let reached = 0, blocked = 0;
        for (const id of ids) {
            if (coly.pulled.has(id)) continue;
            coly.pulled.add(id);
            for (const url of urls(id)) {
                try {
                    const r = await fetch(url, { credentials: "include" });
                    if (!r || !r.ok) continue;
                    reached++;
                    const got = harvest(await r.json());
                    n += got;
                    if (got) break;
                } catch { blocked++; }
            }
        }
        if (n) coly.save();
        const total = Object.keys(coly.known).length;
        if (n) status(`Pulled ${n} answers before play · ${total} saved`);
        else if (!quiet) status(ids.size ? `No answer key reachable (${ids.size} set id${ids.size > 1 ? "s" : ""} tried${blocked ? ", blocked by the browser" : ""}). Answers still learn as you play.` : "No set id visible yet. Try again once the game loads; answers still learn as you play.", true);
        return n;
    }
    function noteSeen(text, answers) {
        if (!text || coly.seen.some((q) => norm(q.text) == norm(text))) return;
        coly.seen.push({ text: String(text), answers: (answers || []).map(String) });
        coly.seen.length > 8 && coly.seen.shift();
        linkSend();
    }
    // Live link to the Find Set tab: game -> helper = each new question, helper -> game = answer keys, imported straight
    // away. postMessage through the window.open handle is the one channel between these two origins; a tab that
    // wasn't opened from here (or a COOP header) just leaves the helper on copy + Import Answers.
    const DASHBOARD = "https://dashboard.blooket.com";
    function linkSend() {
        if (coly.link?.closed) coly.link = null;
        try { coly.link?.postMessage({ bl: "findset", type: "questions", q: coly.seen }, DASHBOARD); } catch { coly.link = null; }
    }
    function onLinkMessage(e) {
        if (e.origin !== DASHBOARD || e.data?.bl !== "findset") return;
        if (e.data.type == "hello") { coly.link = e.source; linkSend(); status("Find Set linked: new questions now go to it, answers come back on their own."); }
        if (e.data.type != "hello" && (!coly.link || e.source !== coly.link)) return; // only the tab we linked with
        if (e.data.type == "bye") { coly.link = null; status("Find Set link closed."); }
        if (e.data.type == "set") {
            try {
                const r = importAnswers(e.data.text);
                status(`Find Set: ${r.n} new answers from "${r.title}" (${r.total} in set) · ${Object.keys(coly.known).length} saved`);
            } catch (err) { status(`Find Set: ${err.message}`, true); }
        }
    }
    // Find Set helper: copied by the Find Set card, pasted into a dashboard.blooket.com console. Self-contained (it is
    // stringified). Blooket's search API isn't documented, so it doesn't call one: it drives Discover's own search box
    // (you can search too) and checks every set that shows up (result links, the page's own API replies, any set page
    // you open) for the live game's questions. Linked to the game tab it follows each new question and sends matches
    // straight back; unlinked it copies the answer key as "BLSET:{…}" for Import Answers.
    function findSetHelper(targets, gameOrigin) {
        const KEY = Symbol.for("bl.findset");
        if (window[KEY]) return window[KEY].remove();
        const norm = (x) => String(x ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        const want = targets.map((t) => ({ text: norm(t.text), answers: t.answers.map(norm) }));
        const checked = new Set(), queue = [], fetched = new Map(), sent = new Set();
        const game = window.opener;
        let found = null, foundSet = null, foundId = null, busy = false, stopped = false, linked = false, latest = targets[targets.length - 1];
        const box = document.createElement("div");
        Object.assign(box.style, { position: "fixed", top: "20px", right: "20px", width: "300px", zIndex: 2147483647, background: "#1c1f26", color: "#e8eaf0", border: "1px solid #3a404c", borderRadius: "10px", padding: "10px", font: "13px/1.35 system-ui, sans-serif", boxShadow: "0 8px 30px rgba(0,0,0,.45)" });
        const mk = (tag, text, style) => { const e = document.createElement(tag); e.textContent = text; Object.assign(e.style, style || {}); return e; };
        const btn = (text, fn) => { const b = mk("button", text, { margin: "6px 6px 0 0", padding: "4px 8px", background: "#4c7cf0", color: "#fff", border: 0, borderRadius: "5px", cursor: "pointer", font: "inherit" }); b.onclick = fn; return b; };
        const title = mk("div", "Blooket Lite · Find Set", { fontWeight: 600, marginBottom: "6px" });
        const q = mk("div", `Search Discover for: "${latest.text}"`, { marginBottom: "4px" });
        const linkLine = mk("div", game ? "Connecting to the game…" : "Not linked to the game: answers get copied.", { color: "#9aa3b2", fontSize: "12px", marginBottom: "4px" });
        const st = mk("div", "Waiting for search results…", { color: "#9fe8b0", fontSize: "12px", marginTop: "6px" });
        const status = (t, bad) => ((st.textContent = t), (st.style.color = bad ? "#ff8a8a" : "#9fe8b0"));
        const copyText = (t) => navigator.clipboard.writeText(t).then(() => true, () => { try { copy(t); return true; } catch { return false; } });
        const copyQ = btn("Copy question", () => copyText(latest.text).then((ok) => status(ok ? "Question copied. Paste it into the search bar." : "Copy blocked; type it in.", !ok)));
        const copyA = btn("Copy answers", () => found && copyText(found).then((ok) => { status(ok ? "Answers copied. Paste into the panel → Import Answers." : "Copy blocked: answers printed to the console.", !ok); ok || console.log(found); }));
        copyA.style.display = "none";
        const close = btn("Close", () => remove());
        box.append(title, q, linkLine, copyQ, copyA, close, st);
        document.body.append(box);
        // How many of the live game's questions this set contains.
        function score(qs) {
            let n = 0;
            for (const w of want) if (qs.some((x) => norm(x.question ?? x.text) == w.text && (!w.answers.length || w.answers.filter((a) => (x.answers || []).map(norm).includes(a)).length * 2 >= w.answers.length))) n++;
            return n;
        }
        function questionsIn(o, d = 0) {
            if (!o || typeof o != "object" || d > 5) return null;
            if (Array.isArray(o.questions) && o.questions.some((x) => Array.isArray(x?.correctAnswers))) return o;
            for (const v of Object.values(o)) { const r = questionsIn(v, d + 1); if (r) return r; }
            return null;
        }
        function addIds(ids) {
            for (const id of ids) if (!checked.has(id) && !queue.includes(id) && checked.size + queue.length < 200) queue.push(id);
            pump();
        }
        const idsIn = (o) => {
            const out = [];
            (function walk(x, d) {
                if (!x || typeof x != "object" || d > 6) return;
                const id = x._id ?? x.id;
                if (typeof id == "string" && /^[0-9a-f]{24}$/.test(id) && ("title" in x || "questions" in x || "numQuestions" in x)) out.push(id);
                for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v, d + 1);
            })(o, 0);
            return out;
        };
        async function fetchSet(id) {
            for (const url of [`https://dashboard.blooket.com/api/games?gameId=${id}`, `https://play.blooket.com/api/gamequestionsets?gameId=${id}`]) {
                try {
                    const r = await origFetch(url, { credentials: "include" });
                    if (!r.ok) continue;
                    const set = questionsIn(await r.json());
                    if (set) return set;
                } catch {}
            }
            return null;
        }
        function accept(id, set) {
            const hits = score(set.questions);
            if (!hits) return;
            const qs = set.questions.filter((x) => Array.isArray(x.correctAnswers) && x.correctAnswers.length).map((x) => [String(x.question ?? x.text ?? ""), (x.answers || []).map(String), x.correctAnswers.map(String)]);
            found = "BLSET:" + JSON.stringify({ title: set.title || id, id, q: qs });
            foundSet = set; foundId = id;
            copyA.style.display = "";
            if (linked) {
                if (!sent.has(id)) game.postMessage({ bl: "findset", type: "set", text: found }, gameOrigin);
                sent.add(id);
                status(`Found "${set.title || id}" (${hits}/${want.length} live questions match) · ${qs.length} answers sent to the game.`);
                if (!set.questions.some((x) => norm(x.question ?? x.text) == norm(latest.text))) { found = null; foundSet = null; } // not this question's set: keep looking
                return;
            }
            status(`Found "${set.title || id}" (${hits}/${want.length} live questions match, ${qs.length} answers). Click Copy answers.`);
            copyText(found).then((ok) => ok && status(`Found "${set.title || id}" · ${qs.length} answers copied. Paste into the panel → Import Answers.`));
        }
        // Types into Discover's own search box, the way a person would. Nothing to do if the page has no box.
        function search(text) {
            const input = document.querySelector("input[type='search'], input[placeholder*='search' i], input[name*='search' i], input[aria-label*='search' i]");
            if (!input || box.contains(input)) return;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, text); // so React sees the change
            input.dispatchEvent(new Event("input", { bubbles: true }));
            for (const t of ["keydown", "keypress", "keyup"]) input.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
            input.form?.requestSubmit?.();
        }
        // A new question from the game: is it in the set we have? Else look again, through what's fetched, then a new search.
        function onQuestions(list) {
            const fresh = list.filter((t) => !want.some((w) => w.text == norm(t.text)));
            for (const t of fresh) want.push({ text: norm(t.text), answers: t.answers.map(norm) });
            if (list.length) latest = list[list.length - 1];
            q.textContent = `Search Discover for: "${latest.text}"`;
            if (!fresh.length) return;
            const covers = () => fresh.every((t) => foundSet?.questions.some((x) => norm(x.question ?? x.text) == norm(t.text)));
            if (found && covers()) return;
            found = null; foundSet = null;
            for (const [id, set] of fetched) { if (set.questions.some((x) => fresh.some((t) => norm(x.question ?? x.text) == norm(t.text)))) { accept(id, set); if (covers()) return; } }
            found = null; foundSet = null;
            search(latest.text);
            pump();
        }
        function onMessage(e) {
            if (e.origin !== gameOrigin || e.data?.bl !== "findset" || e.data.type != "questions" || !game) return;
            if (!linked) { linked = true; linkLine.textContent = "Linked to the game: following its questions."; linkLine.style.color = "#9fe8b0"; }
            onQuestions(e.data.q || []);
            if (found && foundId && !sent.has(foundId)) accept(foundId, foundSet); // found before the link came up
        }
        async function pump() {
            if (busy || found || stopped) return;
            busy = true;
            while (queue.length && !found && !stopped) {
                const id = queue.shift();
                checked.add(id);
                status(`Checking set ${checked.size}…`);
                const set = await fetchSet(id);
                if (!set) continue;
                fetched.set(id, set);
                accept(id, set);
            }
            busy = false;
            if (!found && !stopped && checked.size) status(`Checked ${checked.size} sets, no match yet. Try another search (a different question or the set's title).`);
        }
        // Read set ids out of the page's own API replies.
        const origFetch = window.fetch;
        window.fetch = async function (...a) {
            const r = await origFetch.apply(this, a);
            try { r.clone().json().then((j) => addIds(idsIn(j)), () => {}); } catch {}
            return r;
        };
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (...a) {
            this.addEventListener("load", () => { try { addIds(idsIn(JSON.parse(this.responseText))); } catch {} });
            return origOpen.apply(this, a);
        };
        // And from result links / the set page itself.
        const scan = () => {
            const ids = [...document.querySelectorAll("a[href*='/set/']")].map((a) => (a.getAttribute("href").match(/\/set\/([0-9a-f]{24})/) || [])[1]).filter(Boolean);
            const here = location.pathname.match(/\/set\/([0-9a-f]{24})/);
            addIds(here ? [here[1], ...ids] : ids);
        };
        const timer = setInterval(scan, 1500);
        window.addEventListener("message", onMessage);
        try { game?.postMessage({ bl: "findset", type: "hello" }, gameOrigin); } catch {}
        search(latest.text);
        scan();
        function remove() {
            stopped = true;
            clearInterval(timer);
            window.removeEventListener("message", onMessage);
            if (linked) try { game.postMessage({ bl: "findset", type: "bye" }, gameOrigin); } catch {}
            window.fetch = origFetch;
            XMLHttpRequest.prototype.open = origOpen;
            box.remove();
            delete window[KEY];
        }
        window[KEY] = { remove };
    }
    function importAnswers(text) {
        const raw = String(text).trim().replace(/^BLSET:/, "");
        let data;
        try { data = JSON.parse(raw); } catch { throw new Error("That's not a Find Set export (paste the whole BLSET:… text)."); }
        if (!Array.isArray(data?.q)) throw new Error("That's not a Find Set export.");
        let n = 0;
        for (const e of data.q) if (Array.isArray(e) && learn(e[0], e[1], e[2])) n++;
        coly.save();
        return { n, title: data.title, total: data.q.length };
    }
    // Fix: clicks are verified. A question counts as done only once playerAnswerQuestion goes out (or a result comes
    // back); until then it re-presses every 250 ms. Known answers press the moment the buttons render.
    const colyAuto = {
        mode: 0, // 0 off, 1 known only, 2 guess unknowns too
        tag: null, tries: 0, last: 0, choice: -1, guessAt: 0,
        step(guessUnknown) {
            this.mode = Math.max(this.mode, guessUnknown ? 2 : 1);
            hookRoom();
            const q = colyQuestion();
            if (!q || q.stale) return;
            if (coly.answeredSeq === coly.qSeq && coly.q) return;
            const tag = coly.qSeq + "|" + coly.keyOf(q.text, q.answers);
            if (tag != this.tag) Object.assign(this, { tag, tries: 0, last: 0, choice: -1, guessAt: 0 });
            if (!coly.q && this.tries && this.answered) return;
            const correct = knownFor(q.text, q.answers);
            if (!correct && !guessUnknown) return;
            const now = Date.now();
            if (this.tries && now - this.last < 250) return;
            if (this.tries >= 8) return;
            const wait = coly.speed.answer;
            if (!correct || wait) {
                if (!this.guessAt) this.guessAt = now + (wait || 120 + Math.random() * 130); // unknown: quick guess, learn from the reply
                if (now < this.guessAt) return; // the 40 ms tick comes back
            }
            let j = correct ? q.answers.findIndex((a) => correct.map(norm).includes(norm(a))) : -1;
            if (j < 0) j = this.choice >= 0 ? this.choice : Math.floor(Math.random() * q.answers.length);
            this.choice = j;
            const b = q.buttons[q.map[j]];
            if (!b) return;
            this.tries++; this.last = now;
            press(b);
            if (!coly.q) this.answered = true; // no server question to confirm against: press once
        },
        // showQuestion just arrived: try a few times while the buttons render.
        kick() {
            if (!this.mode) return;
            const g = this.mode == 2;
            [0, 20, 50, 100, 180].forEach((ms) => setTimeout(() => this.mode && this.step(g), ms));
        },
        reset() { Object.assign(this, { mode: 0, tag: null, tries: 0, last: 0, choice: -1, guessAt: 0, answered: false }); },
    };
    function colyHighlight() {
        hookRoom();
        const q = colyQuestion();
        // Can't tell which question this is: clear, so reused buttons never keep the last question's marks.
        if (!q || q.stale) return colyScreen().buttons.forEach((b) => ((b.style.outline = ""), (b.style.opacity = "")));
        const good = (knownFor(q.text, q.answers) || []).map(norm);
        const rightBtn = new Set(q.answers.map((a, j) => good.includes(norm(a)) ? q.map[j] : -1));
        q.buttons.forEach((b, i) => {
            const right = rightBtn.has(i);
            b.style.outline = right ? "4px solid rgb(0, 207, 119)" : "";
            b.style.opacity = good.length && !right ? "0.45" : ""; // wrong answers fade once the key is known
        });
    }
    // Map password indexes to the option elements on the hack screen (React keys / index props), if we can.
    function passwordEls(options) {
        const found = new Map();
        walkFibers((f) => {
            const p = f.memoizedProps;
            let idx = null;
            if (f.key != null && options.includes(Number(f.key))) idx = Number(f.key);
            else if (p && typeof p == "object") for (const [k, v] of Object.entries(p)) if (/index|password/i.test(k) && options.includes(v)) idx = v;
            if (idx == null || found.has(idx)) return;
            let c = f;
            while (c && !(c.stateNode instanceof Element)) c = c.child;
            if (c) found.set(idx, c.stateNode);
        });
        return found;
    }
    function colyMe() {
        const room = coly.room, players = room?.state?.players;
        if (!players) return null;
        for (const [name, p] of typeof players.entries == "function" ? players.entries() : Object.entries(players)) if (p?.sessionId == room.sessionId) return name;
        return null;
    }
    function colyPlayers() {
        const players = hookRoom().state?.players;
        if (!players) throw new Error("Game state not loaded yet.");
        const plain = typeof players.toJSON == "function" ? players.toJSON() : players;
        return Object.entries(plain).map(([name, p]) => ({ ...p, name })); // the map key is the name the game uses
    }
    // ---------- Gold Quest ----------
    const goldOf = (p) => num(p?.gold ?? p?.score);
    function goldBoard() {
        const me = colyMe(), all = colyPlayers();
        const mine = all.find((p) => p.name == me);
        const others = all.filter((p) => p.name != me).sort((a, b) => goldOf(b) - goldOf(a));
        return { mine: goldOf(mine), others };
    }
    // Gold a prize is worth to me right now. Take/Swap assume the richest other player (what Auto Target picks).
    function prizeValue(p) {
        const { mine, others } = goldBoard(), top = goldOf(others[0]);
        const t = String(p?.type ?? "").toLowerCase(), s = String(p?.text ?? "").toLowerCase();
        const v = Math.abs(Number(p?.val ?? p?.amount ?? (s.match(/\d+(\.\d+)?/) || [0])[0]) || 0);
        const has = (w) => t.includes(w) || s.includes(w);
        const pct = (x) => (x > 1 ? x / 100 : x);
        if (has("swap")) return others.length ? top - mine : 0;
        if (has("take") || has("steal")) return others.length ? top * pct(v || 25) : 0;
        if (has("lose")) return -(s.includes("%") || t.includes("percent") || v < 1 ? mine * pct(v) : v);
        if (has("triple")) return mine * 2;
        if (has("double")) return mine;
        if (has("multipl") || /(^|\s)x\d|\dx(\s|$)/.test(s)) return mine * Math.max(0, (v || 2) - 1);
        if (has("nothing")) return 0;
        return v;
    }
    const hackPrizeUp = () => /hack/i.test(`${coly.prize?.type} ${coly.prize?.text}`);
    const outside = (e) => !root.contains(e) && !e.closest(`.${ESP}`);
    function chestEls() {
        const all = [...document.querySelectorAll("[class*='choice' i], [class*='chest' i]")].filter(outside);
        return all.filter((e) => !all.some((o) => o != e && o.contains(e))); // outermost only
    }
    // Crypto's box class names were never captured: named like a box/choice, else 2-4 clickable siblings.
    function cryptoBoxes() {
        const named = [...document.querySelectorAll("[class*='choice' i], [class*='chest' i], [class*='box' i]")].filter(outside);
        let all = named.filter((e) => !named.some((o) => o != e && o.contains(e)));
        while (all.length == 1 && all[0].children.length >= 2) all = [...all[0].children];
        if (all.length >= 2) return all;
        const byParent = new Map();
        for (const e of document.querySelectorAll("body *")) {
            const k = outside(e) && Object.keys(e).find((x) => x.startsWith("__reactProps"));
            if (k && typeof e[k]?.onClick == "function") byParent.set(e.parentElement, [...(byParent.get(e.parentElement) || []), e]);
        }
        return [...byParent.values()].filter((g) => g.length >= 2 && g.length <= 4).sort((a, b) => b.length - a.length)[0] || [];
    }
    function clickable(e) {
        for (let c = e, i = 0; c && i < 5; c = c.parentElement, i++) {
            const pk = Object.keys(c).find((k) => k.startsWith("__reactProps"));
            if ((pk && typeof c[pk]?.onClick == "function") || typeof c.onclick == "function" || c.tagName == "BUTTON") return c;
        }
        return null;
    }
    // What to click on a "click to continue" screen: a continue/next label, else the feedback/prize container,
    // else whatever is in the middle of the screen (these screens take a click anywhere).
    function continueEl() {
        for (const e of document.querySelectorAll("body *")) {
            if (e.children.length > 3 || !outside(e)) continue;
            if (![...e.childNodes].some((n) => n.nodeType == 3 && n.textContent.trim())) continue; // the label itself, not a wrapper around it
            if (/^(click|tap)( anywhere)? to (continue|go on|claim)|^(continue|next|claim)$/i.test(e.textContent.trim())) return e;
        }
        const box = [...document.querySelectorAll("[class*='feedback' i], [class*='prize' i], [class*='reveal' i], [class*='continue' i]")].filter(outside)
            .find((e) => !e.parentElement?.closest("[class*='feedback' i], [class*='prize' i], [class*='reveal' i], [class*='continue' i]"));
        if (box) return box;
        const mid = document.elementFromPoint?.(innerWidth / 2, innerHeight * 0.7);
        return mid && mid != document.body && mid != document.documentElement && outside(mid) ? mid : null;
    }
    // Elements on the "pick a player" screen: an exact player-name label inside something clickable.
    function targetEls() {
        const { others } = goldBoard();
        const byName = new Map(others.map((p) => [p.name, p]));
        const found = new Map();
        for (const e of document.querySelectorAll("body *")) {
            if (e.children.length > 2 || !outside(e)) continue;
            const name = e.textContent.trim();
            if (!byName.has(name) || found.has(name)) continue;
            const c = clickable(e);
            if (c) found.set(name, { el: c, gold: goldOf(byName.get(name)) });
        }
        return { found, others };
    }
    if (COLY) coly.load();
    if (COLY) window.addEventListener("message", onLinkMessage);

    // ---------- shared helpers ----------

    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const ESP = "bl-esp"; // class on every overlay we draw, so one sweep clears them
    const clearEsp = () => document.querySelectorAll(`.${ESP}`).forEach((e) => e.remove());
    // Destructive buttons ask twice in the panel itself instead of a browser dialog: the first click arms it for 3 s.
    const armed = new Map();
    function askTwice(key, question) {
        if (Date.now() - (armed.get(key) || 0) < 3000) return armed.delete(key), true;
        armed.set(key, Date.now());
        status(`${question} Click again to confirm.`, true);
        return false;
    }

    const soloTabs = {
        Solo: [
            {
                name: "Auto Answer", desc: "Answers known questions, guesses new ones and learns them. Human-speed delays.",
                toggle: true, every: 150, run: () => soloAuto.step(true), off: () => soloAuto.reset(),
            },
            {
                name: "Known Only", desc: "Auto-answers only questions it has already learned. You answer the rest.",
                toggle: true, every: 150, run: () => soloAuto.step(false), off: () => soloAuto.reset(),
            },
            {
                name: "Highlight Known", desc: "Outlines the correct answer on questions it has learned", toggle: true, every: 150,
                run: soloHighlight, off: () => solo.screen().buttons.forEach((b) => (b.style.outline = "")),
            },
            {
                name: "Learned Count", desc: "How many answers are saved for this question set",
                run() { status(`${Object.keys(solo.known).length} answers saved for set ${solo.setId.slice(0, 8)}… (+${solo.learned} this session)`); },
            },
            {
                name: "Forget This Set", desc: "Deletes saved answers for this question set",
                run() {
                    if (!askTwice("forget", "Delete all saved answers for this set?")) return;
                    solo.known = {};
                    solo.save();
                },
            },
        ],
    };
    function prizeEsp(desc) {
        return {
            name: "Prize ESP", desc, toggle: true, every: 150, off: clearEsp,
            run() {
                hookRoom();
                const text = coly.prize ? `Prize: ${coly.prize.text}` : "";
                const cur = document.querySelector(`.${ESP}.bl-prize`);
                if (!text) return cur?.remove();
                if (cur?.textContent == text) return;
                cur?.remove();
                document.body.append(h("div", {
                    position: "fixed", top: "70px", left: "50%", transform: "translateX(-50%)", zIndex: 2147483646, padding: "6px 14px",
                    background: "rgba(0,0,0,.75)", color: "#9fe8b0", borderRadius: "8px", font: "600 20px system-ui, sans-serif", pointerEvents: "none",
                }, { className: `${ESP} bl-prize`, textContent: text }));
            },
        };
    }
    // Passive: logs every message the server sends (and what we send) for 60 s, then copies it. For mapping
    // a mode's messages the first time. Never sends anything itself.
    function recordMessages() {
        return {
            name: "Record Messages", desc: "Logs this mode's server messages for 60 s, then copies them. Play normally (answer, open chests), then share the log in a bug report.",
            data: { busy: false },
            run() {
                if (this.data.busy) return status("Already recording.");
                const room = hookRoom(), ev = room.onMessageHandlers?.events || {};
                const cut = (o, d = 0) => o == null || typeof o != "object" ? (typeof o == "string" ? o.slice(0, 60) : o)
                    : d > 4 ? "…" : Array.isArray(o) ? o.slice(0, 12).map((v) => cut(v, d + 1))
                    : Object.fromEntries(Object.keys(o).slice(0, 40).filter((k) => !/token/i.test(k)).map((k) => [k, cut(o[k], d + 1)]));
                const out = { href: location.href, handlerTypes: Object.keys(ev), state: cut(room.state?.toJSON?.() ?? null), log: [] };
                const t = () => +(performance.now() / 1000).toFixed(1);
                const added = [];
                for (const [type, list] of Object.entries(ev)) {
                    if (!Array.isArray(list)) continue;
                    const cb = (msg) => out.log.push({ t: t(), type, msg: cut(msg) });
                    list.push(cb); added.push([list, cb]);
                }
                const send = room.send;
                const rec = function (type, msg) { out.log.push({ t: t(), SENT: type, msg: cut(msg) }); return send.apply(this, arguments); };
                rec.toString = () => send.toString();
                room.send = rec;
                this.data.busy = true;
                status("Recording 60 s: answer some right + wrong and open chests.");
                setTimeout(() => {
                    if (room.send === rec) room.send = send; // if ✕ already unhooked, leave it alone
                    for (const [list, cb] of added) { const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); }
                    this.data.busy = false;
                    const text = JSON.stringify(out, null, 1);
                    const done = () => status(`Copied ${out.log.length} messages. Paste them into a bug report.`);
                    const dump = () => { console.log(text); status("Clipboard blocked: log printed to the console.", true); };
                    try { copy(text); done(); } // DevTools console helper (the script is pasted there)
                    catch { navigator.clipboard ? navigator.clipboard.writeText(text).then(done, dump) : dump(); }
                }, 60000);
            },
        };
    }
    // Both games: clicks the "click to continue" screens. Only while the game is waiting for exactly that click (it knows
    // from the messages), and never on a question, chest, hack or Take/Swap screen, so it can't press an answer or pick a player by accident.
    function autoContinue() {
        return {
            name: "Auto Continue", desc: "Clicks through the \"click to continue\" screens (after each answer and after each prize)",
            toggle: true, every: 60, data: { at: 0 },
            run() {
                hookRoom();
                const c = coly.cont;
                if (!c) return;
                if (colyScreen().buttons.length || chestEls().length >= 2 || targetEls().found.size >= 2) return;
                if (coly.hack || hackPrizeUp()) return; // your call: hack or skip
                if (Date.now() - Math.max(c.since, this.data.at) < coly.speed.next) return; // let the screen render; then repeat at this speed (wrong answers lock for a few s)
                const el = continueEl();
                if (!el) return;
                this.data.at = Date.now();
                press(el);
            },
            off() { this.data.at = 0; },
        };
    }
    // A saved click delay, set by typing ms + Enter. Applies straight away, including to a running Auto Answer/Continue.
    function speedSetting(name, key, what) {
        return {
            name, get desc() { return `${what} Now ${coly.speed[key]} ms.`; }, inputs: [{ name: "Delay in ms", type: "number" }],
            run(ms) {
                coly.speed[key] = Math.round(Math.min(60000, Math.max(0, ms)));
                try { localStorage.setItem("bl.coly.speed", JSON.stringify(coly.speed)); } catch {}
                status(`${name}: ${coly.speed[key]} ms`);
            },
        };
    }
    function autoChest() {
        return {
            name: "Auto Chest", desc: "Opens a chest or box every time they appear (the best one if the prizes are known; the server rolls the prize, so any one is the same)",
            toggle: true, every: 50, data: { at: 0, tries: 0 },
            // One pick per time the chests appear, re-pressed every 300 ms until revealPrize actually goes out.
            run() {
                hookRoom();
                const crypto = game == "crypto";
                // Crypto: only between prizeSelected and the pick, the one time the box screen can be up.
                if (crypto && (!coly.boxUp || colyScreen().buttons.length)) return (this.data.at = 0, this.data.tries = 0);
                const els = crypto ? cryptoBoxes() : chestEls();
                if (els.length < 2) {
                    if (crypto && this.data.missed != coly.prizeSeq) { this.data.missed = coly.prizeSeq; status("Couldn't find the prize boxes: click one yourself, and send a Record Messages log in a bug report.", true); }
                    return (this.data.at = 0, this.data.tries = 0);
                }
                if (this.data.at && coly.revealSentAt >= this.data.at) return; // opened; wait for the screen to go
                if (this.data.at && (Date.now() - this.data.at < 300 || this.data.tries >= 8)) return;
                const list = coly.chests && els.length == coly.chests.length ? coly.chests : null;
                let i = 0;
                if (list) { const vals = list.map(prizeValue); i = vals.indexOf(Math.max(...vals)); }
                this.data.at = Date.now(); this.data.tries++;
                press(els[i]);
                status(list ? `Opened chest ${i + 1}: ${list[i].text ?? list[i].type}` : `Opened chest ${i + 1}`);
            },
            off() { this.data.at = 0; this.data.tries = 0; },
        };
    }
    function autoTarget() {
        return {
            name: "Auto Target", desc: "On Take/Swap, picks the richest player for you",
            toggle: true, every: 60, data: { at: 0, tries: 0 },
            // Fix: the old once-per-screen tag used the prize counter, which Gold never bumps (no prize messages), so
            // every pick after the first looked like the same screen and got skipped. Now: one pick per time the
            // screen appears, re-pressed every 400 ms until swapOrTake actually goes out.
            run() {
                hookRoom();
                const { found, others } = targetEls();
                // A real pick screen lists everyone (or at least 2); one stray name in a notification isn't one.
                if (!found.size || found.size < Math.min(2, others.length)) return (this.data.at = 0, this.data.tries = 0);
                if (this.data.at && coly.targetSentAt >= this.data.at) return; // picked; wait for the screen to go
                if (this.data.at && (Date.now() - this.data.at < 400 || this.data.tries >= 6)) return;
                const [name, t] = [...found].sort((a, b) => b[1].gold - a[1].gold)[0];
                this.data.at = Date.now(); this.data.tries++;
                press(t.el);
                status(`Targeted ${name} (${t.gold.toLocaleString()} gold)`);
            },
            off() { this.data.at = 0; this.data.tries = 0; },
        };
    }
    function autoGuess() {
        return {
            name: "Auto Guess", desc: "Picks the target's password for you: a known one if learned, else the likeliest", toggle: true, every: 200,
            data: { seq: 0, at: 0, tries: 0 },
            // One guess per hack screen, after a 0.8-2 s human delay. A press that doesn't send a guess is retried, then
            // sent directly. Waits while any guess (yours or ours) is out, so a result is never credited to the wrong option.
            run() {
                hookRoom();
                const hk = coly.hack, d = this.data;
                if (!hk) return;
                if (hk.seq != d.seq) Object.assign(d, { seq: hk.seq, tries: 0, at: Date.now() + 800 + Math.random() * 1200 });
                if (coly.lastGuess != null || d.tries >= 4 || Date.now() < d.at) return;
                const cands = pwCandidates(hk.target, hk.options);
                // Unknown: take the server's first option (it was right in every capture so far; the tell is tracked).
                const pick = cands.length ? cands[0] : hk.options[0];
                const el = passwordEls(hk.options).get(pick);
                d.tries++; d.at = Date.now() + 700;
                if (el && d.tries <= 2) press(el);
                else coly.room.send("submitPasswordGuess", { passwordIndex: pick }); // same message the game sends
            },
            off() { this.data.seq = 0; this.data.tries = 0; }, // switched back on: a fresh human delay, never an instant guess
        };
    }
    // Crypto's prize is a hack: the game goes on to the password screen once it's claimed, so press through it.
    function hackPrize() {
        return {
            data: { at: 0, tries: 0 },
            run() {
                if (coly.cont?.msg != "claimPrize" || coly.hack || !hackPrizeUp()) return (this.data.at = 0, this.data.tries = 0);
                if (Date.now() - Math.max(coly.cont.since, this.data.at) < Math.max(400, coly.speed.next) || this.data.tries >= 6) return;
                const label = [...document.querySelectorAll("body *")].find((e) => e.children.length <= 3 && outside(e)
                    && [...e.childNodes].some((n) => n.nodeType == 3 && /^(start )?hack\b/i.test(n.textContent.trim())));
                const el = label || continueEl();
                if (!el) return;
                this.data.at = Date.now(); this.data.tries++;
                press(el);
            },
            off() { this.data.at = 0; this.data.tries = 0; },
        };
    }
    // One instance of each, so a module's card and Autoplay can run together without acting twice.
    const colyParts = { chest: autoChest(), cont: autoContinue(), target: autoTarget(), guess: autoGuess(), hack: hackPrize() };
    function autoplay() {
        const list = () => (game == "gold" ? ["chest", "cont", "target"] : game == "crypto" ? ["chest", "cont", "hack", "guess"] : ["cont"]).map((k) => colyParts[k]);
        return {
            name: "Autoplay", desc: "Plays for you: answers questions, opens prizes, clicks next screens, and on Crypto hacks and picks passwords. Speeds below apply.",
            toggle: true, every: 60,
            run() {
                hookRoom();
                colyAuto.step(true);
                for (const p of list()) p.run();
            },
            off() { colyAuto.reset(); Object.values(colyParts).forEach((p) => p.on || p.off?.()); }, // a part whose own card is on keeps going
        };
    }
    const colyTabs = {
        Answers: [
            autoplay(),
            {
                name: "Auto Answer", desc: "Known questions: clicks the right answer instantly. New ones: quick guess, learned from the server's reply.",
                toggle: true, every: 40, defaultOn: true, run: () => colyAuto.step(true), off: () => colyAuto.reset(),
            },
            {
                name: "Known Only", desc: "Auto-answers only questions it has already learned. You answer the rest.",
                toggle: true, every: 40, run: () => colyAuto.step(false), off: () => colyAuto.reset(),
            },
            speedSetting("Answer Speed", "answer", "How long Auto Answer waits before clicking. 0 = as fast as it can."),
            speedSetting("Continue Speed", "next", "How long Auto Continue waits on a next screen, and between retries. Default 250."),
            {
                name: "Correct ESP", desc: "Outlines the right answer and fades the wrong ones on questions it knows", toggle: true, every: 100, defaultOn: true,
                run: colyHighlight, off: () => colyScreen().buttons.forEach((b) => ((b.style.outline = ""), (b.style.opacity = ""))),
            },
            {
                name: "Find Set (backup)", desc: "If Pull Answers finds nothing: opens Discover and copies a helper. Paste it in that tab's console: it stays linked to this game, follows each new question, searches, and sends back the answers it finds.",
                run() {
                    const s = colyScreen();
                    if (s.text) noteSeen(s.text, s.answers);
                    if (!coly.seen.length) throw new Error("Wait for the first question, then press again.");
                    if (coly.link && !coly.link.closed) { coly.link.focus?.(); linkSend(); return status("Find Set is already linked. Search in that tab."); }
                    const code = `(${findSetHelper.toString()})(${JSON.stringify(coly.seen.slice(-5))}, ${JSON.stringify(location.origin)});`;
                    // Open first, while the click still counts as a user gesture (else the popup blocker eats it).
                    const tab = window.open("https://dashboard.blooket.com/discover", "_blank");
                    const where = tab ? "Discover opened in a new tab" : "Popup blocked: open dashboard.blooket.com/discover yourself";
                    const done = () => status(`Helper copied. ${where}. Paste it in that tab's console (Cmd+Opt+J).`, !tab);
                    try { copy(code); done(); }
                    catch { return navigator.clipboard.writeText(code).then(done, () => { console.log(code); status("Clipboard blocked: helper printed to the console.", true); }); }
                },
            },
            {
                name: "Import Answers", desc: "Paste the BLSET:… text Find Set copied, then press Enter", inputs: [{ name: "Paste BLSET:… here", type: "text" }],
                run(text) {
                    const r = importAnswers(text);
                    status(`Imported ${r.n} new answers from "${r.title}" (${r.total} in set) · ${Object.keys(coly.known).length} saved`);
                },
            },
            {
                name: "Pull Answers", desc: "Grabs the whole answer key before the game starts, if the game or Blooket's API exposes it. Runs once on load.",
                run: () => pullAnswers(false),
            },
            {
                name: "Learned Count", desc: "How many answers are saved",
                run() { status(`${Object.keys(coly.known).length} answers saved (+${coly.learned} this session)`); },
            },
            {
                name: "Forget Answers", desc: "Deletes every saved answer",
                run() {
                    if (!askTwice("forget", "Delete all saved answers?")) return;
                    coly.known = {};
                    coly.save();
                },
            },
        ],
        Players: [
            {
                name: "Player Radar", desc: "Live scoreboard of every player, who's hacking right now, and who hacked whom",
                toggle: true, every: 1000,
                data: { seen: 0, feed: [] },
                run() {
                    const rows = colyPlayers().map((p) => ({ ...p, score: p.score ?? p.gold })).sort((a, b) => num(b.score) - num(a.score)); // Gold may sync `gold` instead of `score`
                    const me = colyMe();
                    const events = coly.room.state?.hackEvents;
                    const list = events ? (typeof events.toJSON == "function" ? events.toJSON() : [...events]) : [];
                    if (list.length < this.data.seen) this.data.seen = 0; // new round / reset
                    for (const e of list.slice(this.data.seen)) this.data.feed.unshift(e);
                    this.data.seen = list.length;
                    this.data.feed.length = Math.min(this.data.feed.length, 6);
                    const line = (text, style) => h("div", { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...style }, { textContent: text });
                    radarEl.replaceChildren(
                        line(`${rows.length} players · by score`, { color: C.dim }),
                        ...rows.map((p, i) => line(
                            `${i == 0 ? "★" : i + 1 + "."} ${p.name} — ${num(p.score).toLocaleString()}${p.stage == "hack" ? " · hacking" : ""}${p.defensiveHackerName ? ` · hit by ${p.defensiveHackerName}` : ""}`,
                            p.name == me ? { color: "#9fe8b0" } : {},
                        )),
                        ...(this.data.feed.length ? [line("Recent hacks", { color: C.dim, marginTop: "4px" })] : []),
                        ...this.data.feed.map((e) => line(`${e.playerName} → ${e.targetPlayerName} (${num(e.amount).toLocaleString()})`, { color: e.targetPlayerName == me ? "#ff8a8a" : C.text })),
                    );
                    radarEl.style.display = "";
                },
                off() { radarEl.style.display = "none"; radarEl.replaceChildren(); this.data.seen = 0; this.data.feed = []; },
            },
        ],
    };
    // Per-game modules: loaded at start when the host says which game it is (cyber./gold.), else as soon as
    // detectGame() recognises the game from its room, state or messages.
    const colyGameTabs = {
        crypto: {
            Crypto: [
                colyParts.cont,
                colyParts.chest,
                colyParts.guess,
                prizeEsp("The server rolls your prize before you pick a box. Shows it."),
                {
                    name: "Password ESP", desc: "On the hack screen, outlines the target's real password (learned across hacks)", toggle: true, every: 150,
                    off: () => document.querySelectorAll("[data-bl-pw]").forEach((e) => ((e.style.outline = ""), e.removeAttribute("data-bl-pw"))),
                    run() {
                        hookRoom();
                        const hk = coly.hack;
                        if (!hk) return;
                        const cands = pwCandidates(hk.target, hk.options);
                        const els = passwordEls(hk.options);
                        for (const [idx, el] of els) {
                            el.setAttribute("data-bl-pw", "");
                            el.style.outline = cands.length == 1 && cands[0] == idx ? "4px solid rgb(0, 207, 119)" : cands.includes(idx) ? "" : "4px solid rgb(189, 15, 38)";
                        }
                        const msg = cands.length == 1 ? `${hk.target}'s password: option #${cands[0]}` : `${hk.target}: ${cands.length} possible passwords (first-in-list tell ${coly.tell.first}/${coly.tell.n})`;
                        status(els.size ? msg : `${msg} · couldn't find the option buttons`, !els.size);
                    },
                },
                recordMessages(),
            ],
        },
        gold: {
            Gold: [
                {
                    name: "Chest ESP", desc: "Shows what's in each chest before you pick (or the one pre-rolled prize, if that's how Gold rolls it)",
                    toggle: true, every: 150, defaultOn: true, off: clearEsp,
                    run() {
                        hookRoom();
                        const els = chestEls();
                        const list = coly.chests && els.length == coly.chests.length ? coly.chests : null;
                        document.querySelectorAll(`.${ESP}.bl-chest`).forEach((e) => e.remove());
                        if (list) {
                            const vals = list.map(prizeValue), best = vals.indexOf(Math.max(...vals));
                            els.forEach((el, i) => {
                                const r = el.getBoundingClientRect();
                                document.body.append(h("div", {
                                    position: "fixed", left: `${r.left + r.width / 2}px`, top: `${Math.max(0, r.top - 8)}px`, transform: "translate(-50%,-100%)",
                                    zIndex: 2147483646, padding: "3px 8px", borderRadius: "6px", pointerEvents: "none", font: "600 15px system-ui, sans-serif",
                                    background: "rgba(0,0,0,.8)", color: i == best ? "#9fe8b0" : vals[i] < 0 ? "#ff8a8a" : "#e8eaf0",
                                }, { className: `${ESP} bl-chest`, textContent: `${i == best ? "★ " : ""}${list[i].text ?? list[i].type}` }));
                            });
                        }
                        const text = !list && coly.prize ? `Prize: ${coly.prize.text ?? coly.prize.type}` : "";
                        const cur = document.querySelector(`.${ESP}.bl-prize`);
                        if (!text) return cur?.remove();
                        if (cur?.textContent == text) return;
                        cur?.remove();
                        document.body.append(h("div", {
                            position: "fixed", top: "70px", left: "50%", transform: "translateX(-50%)", zIndex: 2147483646, padding: "6px 14px",
                            background: "rgba(0,0,0,.75)", color: "#9fe8b0", borderRadius: "8px", font: "600 20px system-ui, sans-serif", pointerEvents: "none",
                        }, { className: `${ESP} bl-prize`, textContent: text }));
                    },
                },
                colyParts.chest,
                colyParts.cont,
                colyParts.target,
                recordMessages(),
            ],
        },
    };
    let game = CYBER ? "crypto" : GOLD ? "gold" : null;
    const gameLabel = () => (SOLO ? "Blooket Lite · Solo" : COLY ? `Blooket Lite · ${{ crypto: "Crypto", gold: "Gold" }[game] || "Live"}` : "Blooket Lite");
    const tabs = SOLO ? soloTabs : COLY ? { ...colyTabs, ...(game ? colyGameTabs[game] : {}) } : {};

    // ---------- runner ----------
    // Every run is wrapped: errors surface once in the status line instead of spamming the console every tick.

    let statusEl, radarEl;
    const status = (msg, bad) => statusEl && ((statusEl.textContent = msg), (statusEl.style.color = bad ? "#ff8a8a" : "#9fe8b0"));
    async function safe(fn, cheat, args) {
        try {
            await fn.apply(cheat, args);
            return true;
        } catch (e) {
            status(`${cheat.name}: ${e.message}`, true);
            return false;
        }
    }
    async function start(cheat) {
        if (!cheat.every) return (cheat.on = await safe(cheat.run, cheat, []));
        cheat.on = true;
        let failing = false, running = false;
        // Async ticks never pile up on top of each other.
        cheat.timer = setInterval(async () => {
            if (running) return;
            running = true;
            const ok = await safe(cheat.run, cheat, []);
            running = false;
            if (!cheat.on) return;
            if (ok && failing) status("");
            failing = !ok;
        }, cheat.every);
    }
    function stop(cheat) {
        cheat.on = false;
        clearInterval(cheat.timer);
        cheat.timer = null;
        cheat.off && safe(cheat.off, cheat, []);
    }
    const stopAll = () => Object.values(tabs).flat().forEach((c) => c.on && stop(c));

    // ---------- GUI (DOM only, no innerHTML: player names are attacker-controlled) ----------

    const h = (tag, style = {}, props = {}, ...kids) => {
        const el = Object.assign(document.createElement(tag), props);
        Object.assign(el.style, style);
        el.append(...kids);
        return el;
    };
    const C = { bg: "#1c1f26", panel: "#262a33", line: "#3a404c", text: "#e8eaf0", dim: "#9aa3b2", on: "#2f8f5b", accent: "#4c7cf0" };
    const inputStyle = { width: "100%", boxSizing: "border-box", marginTop: "6px", padding: "5px 6px", background: C.bg, color: C.text, border: `1px solid ${C.line}`, borderRadius: "5px", font: "inherit" };

    const root = h("div", {
        position: "fixed", top: "20px", right: "20px", width: "260px", zIndex: 2147483647, background: C.bg, color: C.text,
        border: `1px solid ${C.line}`, borderRadius: "10px", font: "13px/1.35 system-ui, sans-serif", boxShadow: "0 8px 30px rgba(0,0,0,.45)", userSelect: "none",
    });
    const close = h("span", { cursor: "pointer", color: C.dim, padding: "0 4px" }, { textContent: "✕", title: "Close (stops everything)" });
    const headerLabel = h("div", {}, { textContent: gameLabel() });
    const header = h("div", { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", cursor: "move", borderBottom: `1px solid ${C.line}`, fontWeight: 600 }, {}, headerLabel, close);
    const tabBar = h("div", { display: "flex", flexWrap: "wrap", gap: "4px", padding: "8px 10px 0" });
    const list = h("div", { maxHeight: "60vh", overflowY: "auto", padding: "8px 10px" });
    radarEl = h("div", { display: "none", margin: "0 10px 8px", padding: "6px 8px", maxHeight: "28vh", overflowY: "auto", fontSize: "12px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: "7px" });
    statusEl = h("div", { padding: "0 10px 8px", fontSize: "12px", minHeight: "14px" });
    root.append(header, tabBar, list, radarEl, statusEl);

    function card(cheat) {
        const title = h("div", { fontWeight: 600 }, { textContent: cheat.name });
        const desc = h("div", { color: C.dim, fontSize: "12px" }, { textContent: cheat.desc });
        const box = h("div", { background: C.panel, border: `1px solid ${C.line}`, borderRadius: "7px", padding: "8px", marginBottom: "6px", cursor: "pointer" }, {}, title, desc);
        const fields = (cheat.inputs || []).map((inp) => {
            let el;
            if (inp.type == "select") el = h("select", inputStyle, {}, ...inp.options.map((o) => (Array.isArray(o) ? h("option", {}, { value: o[0], textContent: o[1] }) : h("option", {}, { value: o, textContent: o }))));
            else el = h("input", inputStyle, { type: inp.type == "number" ? "number" : "text", placeholder: inp.name });
            // Typing in a field never fires the card; only Enter does.
            el.addEventListener("click", (e) => e.stopPropagation());
            el.addEventListener("mousedown", (e) => e.stopPropagation());
            el.addEventListener("keydown", (e) => (e.stopPropagation(), e.key == "Enter" && fire()));
            box.append(el);
            return { inp, el };
        });
        const paint = () => (box.style.background = cheat.on ? C.on : C.panel);
        async function fire() {
            if (cheat.toggle) {
                cheat.on ? stop(cheat) : await start(cheat);
                return paint();
            }
            // Blank and non-numeric inputs are caught before anything runs.
            const args = [];
            for (const { inp, el } of fields) {
                if (el.value === "") return status(`${cheat.name}: fill in ${inp.name}.`, true);
                if (inp.type == "number" && !Number.isFinite(Number(el.value))) return status(`${cheat.name}: ${inp.name} must be a number.`, true);
                args.push(inp.type == "number" ? Number(el.value) : el.value);
            }
            const before = statusEl.textContent;
            if (await safe(cheat.run, cheat, args)) {
                desc.textContent = cheat.desc; // Answer/Continue Speed show the current value
                if (statusEl.textContent == before) status(`${cheat.name}: done.`);
                box.style.background = C.accent;
                setTimeout(paint, 250);
            }
        }
        box.addEventListener("click", fire);
        paint();
        return box;
    }

    const tabButtons = {};
    function show(name) {
        list.replaceChildren(...tabs[name].map(card));
        for (const [n, b] of Object.entries(tabButtons)) b.style.background = n == name ? C.accent : C.panel;
    }
    function addTab(name) {
        tabButtons[name] = h("div", { padding: "3px 7px", borderRadius: "5px", cursor: "pointer", fontSize: "12px", border: `1px solid ${C.line}`, background: C.panel }, { textContent: name });
        tabButtons[name].addEventListener("click", () => show(name));
        tabBar.append(tabButtons[name]);
    }
    Object.keys(tabs).forEach(addTab);
    // Adds a game's own tab(s) once we know which game this is. Only ever fills in an unknown game: the host wins.
    loadGame = (g) => {
        if (!COLY || game || !colyGameTabs[g]) return;
        game = g;
        Object.assign(tabs, colyGameTabs[g]);
        Object.keys(colyGameTabs[g]).forEach(addTab);
        for (const c of Object.values(colyGameTabs[g]).flat()) if (c.defaultOn) start(c);
        headerLabel.textContent = gameLabel();
        status(`${g == "gold" ? "Gold Quest" : "Crypto Hack"} detected · ${Object.keys(colyGameTabs[g]).join(", ")} tab loaded`);
    };
    for (const c of Object.values(tabs).flat()) if (c.defaultOn) start(c);
    if (Object.keys(tabs).length) show(Object.keys(tabs)[0]);
    status(SOLO ? `Solo mode · ${Object.keys(solo.known).length} answers saved for this set` : COLY ? `New game server · ${Object.keys(coly.known).length} answers saved` : "No supported game here. Open a game on the new server (e.g. cyber./gold.blooket.com) or solo.blooket.com, then run this again.", !SOLO && !COLY);
    // Colyseus: start listening at once so answers are learned even with every cheat off.
    const colyTimer = COLY ? setInterval(() => { try { hookRoom(); } catch {} }, 1000) : null;
    if (COLY) try { hookRoom(); } catch {}

    // Drag by header.
    header.addEventListener("mousedown", (e) => {
        if (e.target == close) return;
        const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        const move = (m) => Object.assign(root.style, { left: `${Math.max(0, m.clientX - dx)}px`, top: `${Math.max(0, m.clientY - dy)}px`, right: "auto" });
        const up = () => (document.removeEventListener("mousemove", move), document.removeEventListener("mouseup", up));
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
    });

    const toggle = () => (root.style.display = root.style.display == "none" ? "" : "none");
    const onKey = (e) => e.key == "\\" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && toggle();
    document.addEventListener("keydown", onKey);
    close.addEventListener("click", () => {
        if (!askTwice("close", "Close Blooket Lite and stop everything?")) return;
        stopAll();
        clearInterval(colyTimer);
        if (COLY) unhookRoom();
        if (SOLO) delete window[SOLO_REPLY];
        window.removeEventListener("message", onLinkMessage);
        document.removeEventListener("keydown", onKey);
        root.remove();
        delete window[KEY];
    });

    document.body.append(root);
    window[KEY] = { toggle };
})();

// Runs every mock test in this folder and fails if any of them fail.
const { execFileSync } = require("child_process");
const fs = require("fs");
let bad = 0;
for (const f of fs.readdirSync(__dirname).filter((f) => /^test-.*\.js$/.test(f)).sort()) {
  try {
    const out = execFileSync(process.execPath, [`${__dirname}/${f}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    console.log(`${f}: ${out.trim().split("\n").pop()}`);
  } catch (e) {
    bad++;
    console.log(`${f}: FAILED\n${(e.stdout || "").split("\n").filter((l) => l.startsWith("FAIL")).join("\n")}`);
  }
}
process.exit(bad ? 1 : 0);

#!/usr/bin/env node
// Test double for verify.mjs. The result is app/fix.txt in the tree it verifies:
// green exits 0, red exits 1, anything else exits 2. A pick's merged tree (its
// worktree is named why-it-broke-pick-*) uses FAKE_PICK_VERIFY when it is set.
// Like verify.mjs: an attempt run (--attempt-out) writes its summary and report
// there and commits nothing; a normal run commits a numbered report.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const root = flag("--root");
const attemptOut = flag("--attempt-out");
const label = flag("--label");
const git = (...rest) => execFileSync("git", ["-C", root, ...rest]).toString().trim();

let marker = "missing";
try {
  marker = readFileSync(join(root, "app", "fix.txt"), "utf8").trim();
} catch {
  marker = "missing";
}
const picking = basename(root).startsWith("why-it-broke-pick-");
const result = picking && process.env.FAKE_PICK_VERIFY ? process.env.FAKE_PICK_VERIFY : marker;
const code = result === "green" ? 0 : result === "red" ? 1 : 2;
const head = git("rev-parse", "HEAD");

if (attemptOut !== null) {
  const outcome = code === 0 ? "pass" : code === 1 ? "fail" : "error";
  const summary = {
    number: null,
    testedCommit: head,
    outcome,
    flows: [{ name: "poll-vote.md", outcome, reason: `fake ${result}`, verdict: code === 1 ? { family: "app_bug", root_cause: "fake root cause" } : null, trace: [] }],
    drift: { ok: code === 0, skipped: false, problems: [] }
  };
  mkdirSync(attemptOut, { recursive: true });
  writeFileSync(join(attemptOut, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  writeFileSync(join(attemptOut, "report.md"), `# fake report ${label ?? ""}\n\nTested commit: ${head}\n`, { flag: "wx" });
} else {
  const reports = join(root, "reports");
  mkdirSync(reports, { recursive: true });
  const numbers = readdirSync(reports).map((name) => /^(\d{4})\.md$/.exec(name)).filter(Boolean).map((match) => Number(match[1]));
  const pad = String(Math.max(0, ...numbers) + 1).padStart(4, "0");
  writeFileSync(join(reports, `${pad}.md`), `# fake report ${pad}\n\nTested commit: ${head}\n`);
  git("add", "--", `reports/${pad}.md`);
  git("commit", "-q", "-m", `report: ${pad} verify of ${head.slice(0, 7)}`, "-m", `Tested commit: ${head}`);
}
console.log(`fake verify: ${result} (exit ${code})`);
process.exitCode = code;

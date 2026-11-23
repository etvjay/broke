#!/usr/bin/env node
// Test double for verify.mjs. The result is the first line of app/fix.txt in the tree
// it verifies: green exits 0, red exits 1, anything else exits 2. A pick's merged tree
// (its worktree is named why-it-broke-pick-*) uses FAKE_PICK_VERIFY when it is set.
// FAKE_VERIFY_FAMILY sets the family Kane gives a failing flow (default application_issue).
// Like verify.mjs: an attempt run (--attempt-out) writes its summary and report there
// and commits nothing; a normal run writes NNNN.md and NNNN.json and commits both.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const root = flag("--root");
const attemptOut = flag("--attempt-out");
const label = flag("--label");
// With FAKE_ORDER_LOG set, an attempt run appends its worktree's letter, so a test can read the order.
if (attemptOut !== null && process.env.FAKE_ORDER_LOG) appendFileSync(process.env.FAKE_ORDER_LOG, `verify ${basename(root).slice(-1)}\n`);
const git = (...rest) => execFileSync("git", ["-C", root, ...rest]).toString().trim();

let marker = "missing";
try {
  marker = readFileSync(join(root, "app", "fix.txt"), "utf8").split("\n")[0].trim();
} catch {
  marker = "missing";
}
const picking = basename(root).startsWith("why-it-broke-pick-");
const result = picking && process.env.FAKE_PICK_VERIFY ? process.env.FAKE_PICK_VERIFY : marker;
const code = result === "green" ? 0 : result === "red" ? 1 : 2;
const outcome = code === 0 ? "pass" : code === 1 ? "fail" : "error";
const head = git("rev-parse", "HEAD");
const summaryFor = (number) => ({
  number,
  testedCommit: head,
  outcome,
  flows: [{ name: "poll-vote.md", outcome, reason: `fake ${result}`, verdict: code === 1 ? { family: process.env.FAKE_VERIFY_FAMILY ?? "application_issue", root_cause: "fake root cause" } : null, trace: [] }],
  drift: { ok: code === 0, skipped: false, problems: [] }
});

if (attemptOut !== null) {
  mkdirSync(attemptOut, { recursive: true });
  writeFileSync(join(attemptOut, "summary.json"), `${JSON.stringify(summaryFor(null), null, 2)}\n`, { flag: "wx" });
  writeFileSync(join(attemptOut, "report.md"), `# fake report ${label ?? ""}\n\nTested commit: ${head}\n`, { flag: "wx" });
} else {
  const reports = join(root, "reports");
  mkdirSync(reports, { recursive: true });
  const numbers = readdirSync(reports).map((name) => /^(\d{4})\.md$/.exec(name)).filter(Boolean).map((match) => Number(match[1]));
  const number = Math.max(0, ...numbers) + 1;
  const pad = String(number).padStart(4, "0");
  writeFileSync(join(reports, `${pad}.md`), `# fake report ${pad}\n\nTested commit: ${head}\n`);
  writeFileSync(join(reports, `${pad}.json`), `${JSON.stringify(summaryFor(number), null, 2)}\n`);
  git("add", "--", `reports/${pad}.md`, `reports/${pad}.json`);
  git("commit", "-q", "-m", `report: ${pad} verify of ${head.slice(0, 7)}`, "-m", `Tested commit: ${head}`);
}
console.log(`fake verify: ${result} (exit ${code})`);
process.exitCode = code;

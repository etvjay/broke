import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runClose } from "../scripts/race-close.mjs";
import { runPick } from "../scripts/race-pick.mjs";
import { runRace } from "../scripts/race.mjs";
import { buildBrief } from "../scripts/lib/brief.mjs";
import { explanationChanges, renderComparison } from "../scripts/lib/compare.mjs";
import { acquireLock, raceDir, readLock, releaseLock } from "../scripts/lib/lock.mjs";
import { addWorktree, worktreePath } from "../scripts/lib/race-support.mjs";
import { classifyRed } from "../scripts/lib/summary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const FAKE_VERIFY = join(HERE, "fixtures", "fake-verify.mjs");
const FAKE_DROID = join(HERE, "fixtures", "fake-droid.mjs");
const realHome = process.env.HOME;
const temps = [];

after(async () => {
  process.env.HOME = realHome;
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function isAncestor(cwd, ancestor, descendant) {
  try {
    execFileSync("git", ["-C", cwd, "merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function redSummary(testedCommit, family = "app_bug") {
  return {
    number: 1,
    testedCommit,
    outcome: "fail",
    flows: [
      { name: "poll-create.md", outcome: "pass", reason: "passed", verdict: null, trace: [] },
      {
        name: "poll-vote.md",
        outcome: "fail",
        reason: "Vote did not count",
        verdict: { family, category: "functional", root_cause: "castVote drops the vote", suggestion: "count the vote", agent_fault_assessment: "The app dropped the vote.", confidence: 0.9, culprit_step: 3 },
        trace: [{ file: "app/store.mjs", line: 1, name: "make", explanation: "Builds the store.", status: "current" }]
      },
      { name: "poll-vote-once.md", outcome: "pass", reason: "passed", verdict: null, trace: [] }
    ],
    drift: { ok: true, skipped: false, problems: [] }
  };
}

// A repo whose HEAD is a red report commit, the way verify leaves it.
// The fake racer script is copied into the temp folder, so the repo sees no mode change.
async function setup({ family = "app_bug", extraCommit = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "wib-race-"));
  temps.push(dir);
  process.env.HOME = join(dir, "home");
  const repo = join(dir, "kane");
  await mkdir(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.name", git(ROOT, ["config", "--get", "user.name"]).trim()]);
  git(repo, ["config", "user.email", git(ROOT, ["config", "--get", "user.email"]).trim()]);
  await mkdir(join(repo, "app"));
  await writeFile(join(repo, "app", "store.mjs"), "export function make() {\n  return 1;\n}\n");
  await mkdir(join(repo, "flows"));
  await writeFile(join(repo, "flows", "poll-vote.md"), "Vote once.\n");
  await mkdir(join(repo, "explain"));
  await writeFile(join(repo, "explain", "functions.json"), "[]\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "code"]);
  const tested = git(repo, ["rev-parse", "HEAD"]).trim();
  await mkdir(join(repo, "reports"));
  await writeFile(join(repo, "reports", "0001.md"), `# Why It Broke report 0001\n\nTested commit: ${tested}\n`);
  await writeFile(join(repo, "reports", "0001.json"), `${JSON.stringify(redSummary(tested, family), null, 2)}\n`);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", `report: 0001 verify of ${tested.slice(0, 7)}`, "-m", `Tested commit: ${tested}`]);
  if (extraCommit) {
    await writeFile(join(repo, "app", "store.mjs"), "export function make() {\n  return 2;\n}\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "code after the report"]);
  }
  const droidBin = join(dir, "droid");
  await copyFile(FAKE_DROID, droidBin);
  await chmod(droidBin, 0o755);
  return { dir, repo, droidBin };
}

function racers(modes) {
  for (const letter of ["a", "b", "c"]) process.env[`FAKE_RACER_${letter.toUpperCase()}`] = modes[letter] ?? "none";
}

async function startRace(ctx, modes = {}) {
  racers(modes);
  const lines = [];
  const code = await runRace({
    root: ctx.repo,
    droidBin: ctx.droidBin,
    verifyScript: FAKE_VERIFY,
    racerTimeoutMs: 60000,
    log: (line) => lines.push(line)
  });
  return { code, lines };
}

const pick = (ctx, letter, reason, lines = []) =>
  runPick({ root: ctx.repo, number: "0001", letter, reason, verifyScript: FAKE_VERIFY, log: (line) => lines.push(line) });

test("a second race is refused while the lock is held", async () => {
  const ctx = await setup();
  assert.equal(await acquireLock(7, "0".repeat(40)), true);
  const { code, lines } = await startRace(ctx, { a: "green" });
  assert.equal(code, 2);
  assert.match(lines.join("\n"), /holds the lock/);
  assert.equal((await readLock()).raceId, 7);
  assert.equal(existsSync(raceDir(1)), false);
  await releaseLock();
});

test("a racer that makes no commit is failed and is not verified", async () => {
  const ctx = await setup();
  const { code } = await startRace(ctx, { a: "green", b: "none", c: "red" });
  assert.equal(code, 0);
  const comparison = await readFile(join(raceDir(1), "comparison.md"), "utf8");
  assert.match(comparison, /\| b \| race\/0001-b \| none \| no commit \|/);
  assert.equal(existsSync(join(raceDir(1), "b", "summary.json")), false);
  assert.equal(existsSync(join(raceDir(1), "a", "summary.json")), true);
  assert.equal((await readLock()).state, "awaiting-pick");
  await releaseLock();
});

test("a racer that changes files outside app/ and explain/ is refused without a verify", async () => {
  const ctx = await setup();
  const { code } = await startRace(ctx, { a: "outside", b: "none", c: "none" });
  assert.equal(code, 1);
  const comparison = await readFile(join(raceDir(1), "comparison.md"), "utf8");
  assert.match(comparison, /\| a \| race\/0001-a \| \w+ \| refused \|/);
  assert.match(comparison, /flows\/poll-vote\.md/);
  assert.equal(existsSync(join(raceDir(1), "a", "summary.json")), false);
  assert.equal(await readLock(), null);
});

test("a racer that leaves changes uncommitted is failed and not verified", async () => {
  const ctx = await setup();
  const { code } = await startRace(ctx, { a: "dirty", b: "none", c: "none" });
  assert.equal(code, 1);
  assert.match(await readFile(join(raceDir(1), "comparison.md"), "utf8"), /\| a \| race\/0001-a \| none \| uncommitted changes \|/);
  assert.equal(existsSync(join(raceDir(1), "a", "summary.json")), false);
});

test("a linked node_modules does not make a racer's worktree look dirty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wib-link-"));
  temps.push(dir);
  const repo = join(dir, "kane");
  await mkdir(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.name", git(ROOT, ["config", "--get", "user.name"]).trim()]);
  git(repo, ["config", "user.email", git(ROOT, ["config", "--get", "user.email"]).trim()]);
  await writeFile(join(repo, ".gitignore"), await readFile(join(ROOT, ".gitignore"), "utf8"));
  await writeFile(join(repo, "README.md"), "base\n");
  await mkdir(join(repo, "node_modules"));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "base"]);
  const path = worktreePath(repo, 9, "a");
  await addWorktree({ root: repo, path, branch: "race/0009-a", start: git(repo, ["rev-parse", "HEAD"]).trim() });
  assert.equal(git(path, ["status", "--porcelain"]).trim(), "");
});
test("with no green attempt the lock is released, main stays put, and the reports go to a branch", async () => {
  const ctx = await setup();
  const before = git(ctx.repo, ["rev-parse", "HEAD"]).trim();
  const { code, lines } = await startRace(ctx, { a: "red", b: "red", c: "none" });
  assert.equal(code, 1);
  assert.equal(await readLock(), null);
  assert.equal(git(ctx.repo, ["rev-parse", "HEAD"]).trim(), before);
  assert.match(lines.join("\n"), /No attempt is green/);
  const shown = git(ctx.repo, ["show", "race/0001-report:reports/races/0001/comparison.md"]);
  assert.match(shown, /# Race 0001 comparison/);
  assert.match(shown, /poll-vote\.md: app_bug/);
});

test("green attempts wait for a pick: main does not move and the comparison names no winner", async () => {
  const ctx = await setup();
  const before = git(ctx.repo, ["rev-parse", "HEAD"]).trim();
  const { code } = await startRace(ctx, { a: "red", b: "green", c: "red" });
  assert.equal(code, 0);
  assert.equal((await readLock()).state, "awaiting-pick");
  assert.equal(git(ctx.repo, ["rev-parse", "HEAD"]).trim(), before);
  const comparison = await readFile(join(raceDir(1), "comparison.md"), "utf8");
  assert.match(comparison, /\| b \| race\/0001-b \| \w+ \| green \|/);
  assert.doesNotMatch(comparison, /winner\s*[:=-]/i);
  await releaseLock();
});

test("a red that is not an app fault does not start a race", async () => {
  const ctx = await setup({ family: "automation_bug" });
  const { code, lines } = await startRace(ctx, { a: "green" });
  assert.equal(code, 2);
  assert.match(lines.join("\n"), /does not put the fault in the app/);
  assert.equal(await readLock(), null);
  assert.equal(existsSync(raceDir(1)), false);
});

test("a race starts only when HEAD is the red report commit", async () => {
  const ctx = await setup({ extraCommit: true });
  const { code, lines } = await startRace(ctx, { a: "green" });
  assert.equal(code, 2);
  assert.match(lines.join("\n"), /not the commit of the latest report/);
  assert.equal(await readLock(), null);
});

test("pick refuses a red attempt and leaves main and the lock alone", async () => {
  const ctx = await setup();
  await startRace(ctx, { a: "red", b: "green", c: "none" });
  const before = git(ctx.repo, ["rev-parse", "HEAD"]).trim();
  const lines = [];
  assert.equal(await pick(ctx, "a", "try the red one", lines), 2);
  assert.match(lines.join("\n"), /Only a green attempt can be picked/);
  assert.equal(git(ctx.repo, ["rev-parse", "HEAD"]).trim(), before);
  assert.equal((await readLock()).state, "awaiting-pick");
  await releaseLock();
});

test("pick of a green attempt moves main to the merge, clears the lock, and keeps the branches", async () => {
  const ctx = await setup();
  await startRace(ctx, { a: "none", b: "green", c: "red" });
  const before = git(ctx.repo, ["rev-parse", "HEAD"]).trim();
  const attemptCommit = git(ctx.repo, ["rev-parse", "race/0001-b"]).trim();
  assert.equal(await pick(ctx, "b", "only green attempt"), 0);
  const head = git(ctx.repo, ["rev-parse", "HEAD"]).trim();
  assert.notEqual(head, before);
  assert.equal(git(ctx.repo, ["log", "-1", "--format=%P", head]).trim().split(" ").length, 2);
  assert.equal(isAncestor(ctx.repo, attemptCommit, head), true);
  assert.equal(await readLock(), null);
  assert.equal(existsSync(join(ctx.dir, "why-it-broke-race-0001-b")), false);
  assert.notEqual(git(ctx.repo, ["branch", "--list", "race/0001-b"]).trim(), "");
  assert.match(git(ctx.repo, ["show", "HEAD:reports/races/0001/comparison.md"]), /Race 0001 comparison/);
  assert.match(git(ctx.repo, ["show", "HEAD:reports/races/0001/pick.md"]), /only green attempt/);
  assert.match(git(ctx.repo, ["show", "HEAD:reports/races/0001/brief.md"]), /# Fix the app/);
  assert.match(git(ctx.repo, ["show", "HEAD:reports/races/0001/attempts.json"]), /"letter": "b"/);
  assert.match(git(ctx.repo, ["show", "HEAD:reports/races/0001/pick.md"]), /verified green/);
});

test("a pick whose merged result verifies red leaves main alone and keeps the lock", async () => {
  const ctx = await setup();
  await startRace(ctx, { a: "green", b: "none", c: "none" });
  const before = git(ctx.repo, ["rev-parse", "HEAD"]).trim();
  process.env.FAKE_PICK_VERIFY = "red";
  try {
    assert.equal(await pick(ctx, "a", "merge check"), 1);
  } finally {
    delete process.env.FAKE_PICK_VERIFY;
  }
  assert.equal(git(ctx.repo, ["rev-parse", "HEAD"]).trim(), before);
  assert.equal((await readLock()).state, "awaiting-pick");
  assert.notEqual(git(ctx.repo, ["branch", "--list", "pick/0001-a"]).trim(), "");
  assert.match(await readFile(join(raceDir(1), "pick.md"), "utf8"), /Main did not move/);
  await releaseLock();
});

test("race:close clears a race waiting for a pick and refuses a race that is still open", async () => {
  const ctx = await setup();
  await startRace(ctx, { a: "green" });
  assert.equal(await runClose({ number: "0001", log: () => {} }), 0);
  assert.equal(await readLock(), null);
  await acquireLock(2, "x".repeat(40));
  assert.equal(await runClose({ number: "0002", log: () => {} }), 2);
  await releaseLock();
});

test("classifyRed starts a race only for an app fault or fixable drift", () => {
  const base = redSummary("a".repeat(40));
  assert.equal(classifyRed(base).race, true);
  assert.equal(classifyRed(redSummary("a".repeat(40), "automation_bug")).race, false);
  const errored = structuredClone(base);
  errored.flows[1].outcome = "error";
  assert.equal(classifyRed(errored).race, false);
  const unrun = structuredClone(base);
  unrun.flows[1] = { ...unrun.flows[1], outcome: "pass", verdict: null };
  unrun.drift = { ok: false, skipped: false, problems: [{ kind: "unrun", file: "app/store.mjs", name: "make", line: 1, message: "ran in no flow" }] };
  assert.equal(classifyRed(unrun).race, false);
  const missing = structuredClone(base);
  missing.flows = base.flows.map((flow) => ({ ...flow, outcome: "pass", verdict: null }));
  missing.drift = { ok: false, skipped: false, problems: [{ kind: "missing", file: "app/store.mjs", name: "make", line: 1, message: "no explanation" }] };
  assert.equal(classifyRed(missing).race, true);
  assert.equal(classifyRed({ ...base, outcome: "pass" }).race, false);
});

test("the brief names Kane's verdict, the explained trace, the rules, and earlier failures", () => {
  const brief = buildBrief({
    head: "c".repeat(40),
    summary: redSummary("b".repeat(40)),
    report: "# Why It Broke report 0001\n",
    priorAttempts: ["race 0001, attempt c: red. poll-vote.md: app_bug, castVote drops the vote"]
  });
  assert.match(brief, /Root cause: castVote drops the vote/);
  assert.match(brief, /app\/store\.mjs:1 make \[current\]: Builds the store\./);
  assert.match(brief, /Change only files under `app\/` and `explain\/`/);
  assert.match(brief, /Earlier attempts on this commit/);
  assert.match(brief, /# Why It Broke report 0001/);
});

test("the comparison shows each attempt's status and names no winner", () => {
  const text = renderComparison(
    [
      { letter: "a", branch: "race/0001-a", commit: "abc1234", status: "green", reason: "every flow passed and drift passed.", files: 1, insertions: 3, deletions: 1, explanationsChanged: 1, flows: [{ name: "poll-create.md", outcome: "pass" }], drift: { ok: true, problems: 0 } },
      { letter: "b", branch: "race/0001-b", commit: null, status: "no commit", reason: "the racer exited 0 without a commit", files: 0, insertions: 0, deletions: 0, explanationsChanged: 0, flows: null, drift: null }
    ],
    { raceNumber: 1, base: "1234567" }
  );
  assert.match(text, /# Race 0001 comparison/);
  assert.match(text, /\| a \| race\/0001-a \| abc1234 \| green \|/);
  assert.match(text, /\| b \| race\/0001-b \| none \| no commit \|/);
  assert.doesNotMatch(text, /winner\s*[:=-]/i);
  assert.match(text, /names no winner/);
});

test("explanationChanges counts changed, added, and removed entries", () => {
  const before = [
    { file: "app/a.mjs", name: "one", explanation: "old", hash: "1" },
    { file: "app/a.mjs", name: "two", explanation: "same", hash: "2" }
  ];
  const after = [
    { file: "app/a.mjs", name: "one", explanation: "new", hash: "1" },
    { file: "app/a.mjs", name: "two", explanation: "same", hash: "2" },
    { file: "app/a.mjs", name: "three", explanation: "added", hash: "3" }
  ];
  assert.equal(explanationChanges(before, after), 2);
  assert.equal(explanationChanges(after, before), 2);
});

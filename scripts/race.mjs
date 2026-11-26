import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { DROID_BIN, RACER_TIMEOUT_MS, ROOT, VERIFY_SCRIPT } from "./config.mjs";
import { buildBrief } from "./lib/brief.mjs";
import { explanationChanges, failuresOf, renderComparison } from "./lib/compare.mjs";
import { COAUTHOR, git } from "./lib/git.mjs";
import { acquireLock, isStaleLock, raceDir, racesDir, readLock, releaseLock, setLockState } from "./lib/lock.mjs";
import { padNumber } from "./lib/report.mjs";
import {
  addWorktree,
  branchName,
  copyRecords,
  exists,
  LETTERS,
  listDir,
  nextRaceNumber,
  readJsonOrNull,
  removeWorktree,
  reportBranchName,
  runProcess,
  worktreePath
} from "./lib/race-support.mjs";
import { classifyRed } from "./lib/summary.mjs";
import { runPick } from "./race-pick.mjs";

// Starts a fix race from a red report. Three Droid racers fix the app, one after
// another, each in its own worktree. Each attempt is verified before the next racer
// starts, and the comparison goes to the owner.
// Exit codes: 0 a green attempt waits for the owner's pick; 1 no attempt is green,
// so nothing merged; 2 refused before any racer ran, or an error.
export async function runRace({
  root = ROOT,
  droidBin = DROID_BIN,
  verifyScript = VERIFY_SCRIPT,
  racerTimeoutMs = RACER_TIMEOUT_MS,
  log = () => {}
} = {}) {
  let held = await readLock();
  if (isStaleLock(held)) {
    log(`race ${padNumber(held.raceId)} stopped before it finished (process ${held.pid} has exited). Its lock is cleared.`);
    await releaseLock();
    held = null;
  }
  if (held !== null) {
    log(`refused: race ${padNumber(held.raceId)} holds the lock (state ${held.state}). Finish it with npm run race:pick or npm run race:close.`);
    return 2;
  }
  if ((await git(root, ["status", "--porcelain"])).trim() !== "") {
    log("refused: the tree has uncommitted changes. A race starts from a commit.");
    return 2;
  }
  const start = await startingRed(root, log);
  if (start === null) return 2;
  const decision = classifyRed(start.summary);
  if (!decision.race) {
    log(`refused: ${decision.reason}`);
    return 2;
  }
  const number = await nextRaceNumber(root);
  if (!(await acquireLock(number, start.head))) {
    log("refused: another race took the lock first.");
    return 2;
  }
  const n = padNumber(number);
  const dir = raceDir(number);
  log(`race ${n} starts from report ${padNumber(start.number)} at ${start.head.slice(0, 7)}. ${decision.reason}`);
  try {
    await mkdir(dir, { recursive: true });
    const attempts = await runAttempts({ root, number, start, droidBin, verifyScript, racerTimeoutMs, log });
    await writeFile(
      join(dir, "attempts.json"),
      `${JSON.stringify({ number, base: start.head, tested: start.tested, attempts }, null, 2)}\n`
    );
    await writeFile(
      join(dir, "comparison.md"),
      renderComparison(attempts, {
        raceNumber: number,
        base: start.head.slice(0, 7),
        startReport: `The red report is ${padNumber(start.number)}. ${decision.reason}`
      })
    );
    for (const attempt of attempts) log(`attempt ${attempt.letter}: ${attempt.status}. ${attempt.reason}`);
    const green = attempts.filter((attempt) => attempt.status === "green");
    if (green.length === 1) {
      await keepRecords({ root, number, dir });
      await setLockState("awaiting-pick");
      log(`race ${n}: attempt ${green[0].letter} is the only green attempt. Merging it through the pick path.`);
      return await runPick({
        root,
        number,
        letter: green[0].letter,
        reason: "the only attempt that passed Kane's verify",
        pickedBy: "runner",
        verifyScript,
        log
      });
    }
    if (green.length > 1) {
      await keepRecords({ root, number, dir });
      await setLockState("awaiting-pick");
      log(`race ${n}: ${green.length} attempts are green. Compare them in ${join(dir, "comparison.md")}.`);
      log(`The owner picks one: npm run race:pick -- ${n} <a|b|c> --reason "<text>"`);
      return 0;
    }
    const sha = await commitRecordsToMain({ root, number, dir });
    await releaseLock();
    log(`race ${n}: No attempt is green. Nothing merged. The records are committed to main at ${sha}. The lock is released.`);
    return 1;
  } catch (error) {
    log(`race ${n} stopped: ${error.message}`);
    await releaseLock();
    return 2;
  }
}

// A race starts from the latest red report when the code at HEAD matches the code at that report
// outside reports/races/, and the report's tested commit is the commit before the report.
async function startingRed(root, log) {
  const names = await listDir(join(root, "reports"));
  const numbers = names
    .map((name) => /^(\d{4})\.md$/.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  if (numbers.length === 0) {
    log("refused: there is no report yet. Run npm run verify first.");
    return null;
  }
  const number = Math.max(...numbers);
  const pad = padNumber(number);
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  const reported = (await git(root, ["log", "-1", "--format=%H", "--", `reports/${pad}.md`])).trim();
  if (reported === "" || !(await isAncestor(root, reported, head))) {
    log(`refused: the commit of the latest report (${pad}) is not an ancestor of HEAD.`);
    return null;
  }
  const changedOutside = (await git(root, ["diff", "--name-only", reported, head, "--", ":(exclude)reports/races"])).trim();
  if (changedOutside !== "") {
    log(`refused: changes outside reports/races/ were committed after report ${pad}. A race starts only from the red code that verify reported.`);
    return null;
  }
  const summary = await readJsonOrNull(join(root, "reports", `${pad}.json`));
  if (summary === null) {
    log(`refused: report ${pad} has no summary file, so its verdicts cannot be read.`);
    return null;
  }
  if (summary.testedCommit !== (await parentOf(root, reported))) {
    log(`refused: report ${pad} tested ${summary.testedCommit}, which is not the commit before report ${pad}.`);
    return null;
  }
  return { number, head, tested: summary.testedCommit, summary };
}

async function runAttempts({ root, number, start, droidBin, verifyScript, racerTimeoutMs, log }) {
  const dir = raceDir(number);
  const report = await readFile(join(root, "reports", `${padNumber(start.number)}.md`), "utf8");
  await writeFile(
    join(dir, "brief.md"),
    buildBrief({ head: start.head, summary: start.summary, report, priorAttempts: await earlierAttempts(start.tested) })
  );
  for (const letter of LETTERS) {
    await addWorktree({ root, path: worktreePath(root, number, letter), branch: branchName(number, letter), start: start.head });
  }
  // Racers run one at a time, so each attempt is verified before the next racer starts.
  const attempts = [];
  for (const letter of LETTERS) {
    const path = worktreePath(root, number, letter);
    log(`racer ${letter}: starting`);
    const racer = await runProcess({
      command: droidBin,
      args: ["exec", "--auto", "medium", "--cwd", path, "-f", join(dir, "brief.md"), "-o", "stream-json"],
      cwd: path,
      logFile: join(dir, `racer-${letter}.jsonl`),
      timeoutMs: racerTimeoutMs
    });
    attempts.push(await evaluateAttempt({ root, number, letter, base: start.head, racer, verifyScript, log }));
  }
  return attempts;
}

// Earlier attempts on this same red tested commit, so a new brief lists what already failed.
async function earlierAttempts(tested) {
  const lines = [];
  for (const name of await listDir(racesDir())) {
    const record = await readJsonOrNull(join(racesDir(), name, "attempts.json"));
    if (record === null || record.tested !== tested) continue;
    for (const attempt of record.attempts) {
      const failures = failuresOf(attempt);
      lines.push(`race ${name}, attempt ${attempt.letter}: ${attempt.status}. ${failures.length > 0 ? failures.join("; ") : attempt.reason}`);
    }
  }
  return lines;
}

async function evaluateAttempt({ root, number, letter, base, racer, verifyScript, log }) {
  const path = worktreePath(root, number, letter);
  const dir = join(raceDir(number), letter);
  const head = (await git(path, ["rev-parse", "HEAD"])).trim();
  const attempt = {
    letter,
    branch: branchName(number, letter),
    commit: head === base ? null : head.slice(0, 7),
    status: "",
    reason: "",
    files: 0,
    insertions: 0,
    deletions: 0,
    explanationsChanged: 0,
    flows: null,
    drift: null
  };
  if (racer.timedOut || racer.code !== 0) return judged(attempt, "racer failed", racerReason(racer));
  if ((await git(path, ["status", "--porcelain"])).trim() !== "") {
    return judged(attempt, "uncommitted changes", "the racer left changes that are not committed");
  }
  if (head === base) return judged(attempt, "no commit", "the racer exited 0 without a commit");
  const names = (await git(root, ["diff", "--name-only", base, head])).split("\n").filter(Boolean);
  Object.assign(attempt, {
    files: names.length,
    ...(await diffTotals(root, base, head)),
    explanationsChanged: explanationChanges(await explanationsAt(root, base), await explanationsAt(root, head))
  });
  const outside = names.filter((name) => !name.startsWith("app/") && !name.startsWith("explain/"));
  if (outside.length > 0) {
    return judged(attempt, "refused", `changed files outside app/ and explain/: ${outside.join(", ")}`);
  }
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  log(`attempt ${letter}: verifying ${head.slice(0, 7)}`);
  const verify = await runProcess({
    command: process.execPath,
    args: [verifyScript, "--root", path, "--attempt-out", dir, "--label", `race ${padNumber(number)} attempt ${letter}`],
    cwd: path,
    logFile: join(dir, "verify.log")
  });
  const summary = await readJsonOrNull(join(dir, "summary.json"));
  if (summary === null) {
    return judged(attempt, "error", `verify exited ${verify.code ?? verify.signal} and wrote no summary. Log: ${join(dir, "verify.log")}`);
  }
  attempt.flows = summary.flows.map((flow) => ({ name: flow.name, outcome: flow.outcome, reason: flow.reason, verdict: flow.verdict ?? null }));
  attempt.drift = { ok: summary.drift.ok, problems: summary.drift.problems.length };
  if (summary.outcome === "pass") return judged(attempt, "green", "every flow passed and drift passed.");
  const failing = summary.flows.filter((flow) => flow.outcome === "fail").map((flow) => flow.name);
  const errored = summary.flows.filter((flow) => flow.outcome === "error").map((flow) => flow.name);
  if (summary.outcome === "fail") {
    return judged(attempt, "red", `${failing.length > 0 ? `${failing.join(", ")} failed` : "drift failed"}.`);
  }
  return judged(attempt, "error", `${errored.length > 0 ? `${errored.join(", ")} errored` : "verify errored"}.`);
}

// Commits a failed race's records folder to main, without changing any code or merging any racer branch.
export async function commitRecordsToMain({ root, number, dir }) {
  const branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  if (branch !== "main") throw new Error(`refused: HEAD is on ${branch}, not main`);
  const recordsRel = `reports/races/${padNumber(number)}`;
  if (await exists(join(root, recordsRel))) {
    throw new Error(`refused: ${recordsRel} already exists`);
  }
  await copyRecords(dir, join(root, recordsRel));
  await git(root, ["add", "--", recordsRel]);
  await git(root, ["commit", "-q", "-m", `race ${padNumber(number)}: no attempt is green`, "-m", COAUTHOR]);
  return (await git(root, ["rev-parse", "--short", "HEAD"])).trim();
}

// The records go on a branch of their own while a green race waits for a pick, so main does not move.
async function keepRecords({ root, number, dir }) {
  const branch = reportBranchName(number);
  const scratch = await mkdtemp(join(tmpdir(), "why-it-broke-records-"));
  await git(root, ["worktree", "add", "-b", branch, scratch, "HEAD"]);
  try {
    const recordsRel = `reports/races/${padNumber(number)}`;
    await copyRecords(dir, join(scratch, recordsRel));
    await git(scratch, ["add", "--", recordsRel]);
    await git(scratch, ["commit", "-q", "-m", `race ${padNumber(number)}: records awaiting pick`, "-m", COAUTHOR]);
  } finally {
    await removeWorktree(root, scratch);
  }
}

function judged(attempt, status, reason) {
  return { ...attempt, status, reason };
}

function racerReason(racer) {
  if (racer.timedOut) return "the racer timed out";
  if (racer.error) return `the racer did not start: ${racer.error}`;
  return `the racer exited ${racer.code ?? racer.signal}`;
}

async function diffTotals(root, base, head) {
  const lines = (await git(root, ["diff", "--numstat", base, head])).split("\n").filter(Boolean);
  let insertions = 0;
  let deletions = 0;
  for (const line of lines) {
    const [added, removed] = line.split("\t");
    insertions += Number(added) || 0;
    deletions += Number(removed) || 0;
  }
  return { insertions, deletions };
}

async function explanationsAt(root, rev) {
  try {
    return JSON.parse(await git(root, ["show", `${rev}:explain/functions.json`]));
  } catch {
    return [];
  }
}

async function isAncestor(root, ancestor, descendant) {
  try {
    await git(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

async function parentOf(root, rev) {
  try {
    return (await git(root, ["rev-parse", `${rev}^`])).trim();
  } catch {
    return null;
  }
}

const isMain = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  runRace({ root: values.root === undefined ? ROOT : resolve(values.root), log: (line) => console.log(line) }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`race: ${error.message}`);
      process.exitCode = 2;
    }
  );
}

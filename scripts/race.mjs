import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { DROID_BIN, RACER_TIMEOUT_MS, ROOT, VERIFY_SCRIPT } from "./config.mjs";
import { buildBrief } from "./lib/brief.mjs";
import { explanationChanges, failuresOf, renderComparison } from "./lib/compare.mjs";
import { COAUTHOR, git } from "./lib/git.mjs";
import { acquireLock, raceDir, racesDir, readLock, releaseLock, setLockState } from "./lib/lock.mjs";
import { padNumber } from "./lib/report.mjs";
import {
  addWorktree,
  branchName,
  copyRecords,
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

// Starts a fix race from a red report. Three Droid racers each fix the app in
// their own worktree, each attempt is verified, and the comparison goes to the owner.
// Exit codes: 0 a green attempt waits for the owner's pick; 1 no attempt is green,
// so nothing merged; 2 refused before any racer ran, or an error.
export async function runRace({
  root = ROOT,
  droidBin = DROID_BIN,
  verifyScript = VERIFY_SCRIPT,
  racerTimeoutMs = RACER_TIMEOUT_MS,
  log = () => {}
} = {}) {
  const held = await readLock();
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
    await writeFile(join(dir, "attempts.json"), `${JSON.stringify({ number, base: start.head, attempts }, null, 2)}\n`);
    await writeFile(
      join(dir, "comparison.md"),
      renderComparison(attempts, {
        raceNumber: number,
        base: start.head.slice(0, 7),
        startReport: `The red report is ${padNumber(start.number)}. ${decision.reason}`
      })
    );
    for (const attempt of attempts) log(`attempt ${attempt.letter}: ${attempt.status}. ${attempt.reason}`);
    if (attempts.some((attempt) => attempt.status === "green")) {
      await keepRecords({ root, number, dir });
      await setLockState("awaiting-pick");
      log(`race ${n}: at least one attempt is green. Compare them in ${join(dir, "comparison.md")}.`);
      log(`The owner picks one: npm run race:pick -- ${n} <a|b|c> --reason "<text>"`);
      return 0;
    }
    await keepRecords({ root, number, dir });
    await releaseLock();
    log(`race ${n}: No attempt is green. Nothing merged, and main stays at ${start.head.slice(0, 7)}. The records are on ${reportBranchName(number)}. The lock is released.`);
    return 1;
  } catch (error) {
    log(`race ${n} stopped: ${error.message}`);
    await releaseLock();
    return 2;
  }
}

// The red HEAD must be the commit verify made for the latest report, on top of the commit it tested.
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
  if (reported !== head) {
    log(`refused: HEAD is not the commit of the latest report (${pad}). A race starts only from the red HEAD that verify just reported.`);
    return null;
  }
  const summary = await readJsonOrNull(join(root, "reports", `${pad}.json`));
  if (summary === null) {
    log(`refused: report ${pad} has no summary file, so its verdicts cannot be read.`);
    return null;
  }
  if (summary.testedCommit !== (await parentOf(root, head))) {
    log(`refused: report ${pad} tested ${summary.testedCommit}, which is not the commit before HEAD.`);
    return null;
  }
  return { number, head, summary };
}

async function runAttempts({ root, number, start, droidBin, verifyScript, racerTimeoutMs, log }) {
  const dir = raceDir(number);
  const report = await readFile(join(root, "reports", `${padNumber(start.number)}.md`), "utf8");
  await writeFile(
    join(dir, "brief.md"),
    buildBrief({ head: start.head, summary: start.summary, report, priorAttempts: await earlierAttempts(start.head) })
  );
  for (const letter of LETTERS) {
    await addWorktree({ root, path: worktreePath(root, number, letter), branch: branchName(number, letter), start: start.head });
  }
  log(`race ${padNumber(number)}: three racers start, one per worktree`);
  const racers = await Promise.all(
    LETTERS.map((letter) => {
      const path = worktreePath(root, number, letter);
      return runProcess({
        command: droidBin,
        args: ["exec", "--auto", "medium", "--cwd", path, "-f", join(dir, "brief.md"), "-o", "stream-json"],
        cwd: path,
        logFile: join(dir, `racer-${letter}.jsonl`),
        timeoutMs: racerTimeoutMs
      });
    })
  );
  const attempts = [];
  for (const [index, letter] of LETTERS.entries()) {
    attempts.push(await evaluateAttempt({ root, number, letter, base: start.head, racer: racers[index], verifyScript, log }));
  }
  return attempts;
}

// Earlier attempts on this same commit, so a new brief lists what already failed.
async function earlierAttempts(head) {
  const lines = [];
  for (const name of await listDir(racesDir())) {
    const record = await readJsonOrNull(join(racesDir(), name, "attempts.json"));
    if (record === null || record.base !== head) continue;
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
  if (racer.code !== 0) return judged(attempt, "racer failed", racerReason(racer));
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

// The records go on a branch of their own, so main does not move. A race keeps them when it ends with a green attempt waiting for a pick, and when no attempt is green.
async function keepRecords({ root, number, dir }) {
  const branch = reportBranchName(number);
  const scratch = await mkdtemp(join(tmpdir(), "why-it-broke-records-"));
  await git(root, ["worktree", "add", "-b", branch, scratch, "HEAD"]);
  try {
    const recordsRel = `reports/races/${padNumber(number)}`;
    await copyRecords(dir, join(scratch, recordsRel));
    await git(scratch, ["add", "--", recordsRel]);
    await git(scratch, ["commit", "-q", "-m", `race ${padNumber(number)}: no attempt is green`, "-m", COAUTHOR]);
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

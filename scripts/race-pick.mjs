import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ROOT, VERIFY_SCRIPT } from "./config.mjs";
import { COAUTHOR, git } from "./lib/git.mjs";
import { raceDir, readLock, releaseLock } from "./lib/lock.mjs";
import { padNumber } from "./lib/report.mjs";
import {
  branchName,
  copyRecords,
  LETTERS,
  linkModules,
  readJsonOrNull,
  removeWorktree,
  runProcess,
  worktreePath
} from "./lib/race-support.mjs";

// Merges the chosen attempt into main, but only if the merge verifies green.
// Exit codes: 0 merged, main moved, lock released; 1 the merge verified red, so
// main did not move and the lock stays; 2 refused, or an error.
export async function runPick({ root = ROOT, number, letter, reason, verifyScript = VERIFY_SCRIPT, log = () => {} }) {
  const raceNumber = Number(number);
  const n = padNumber(raceNumber);
  if (!LETTERS.includes(letter)) {
    log("refused: name the attempt as a, b, or c.");
    return 2;
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    log("refused: --reason is required. Say why this attempt is the one to keep.");
    return 2;
  }
  const lock = await readLock();
  if (lock === null || lock.raceId !== raceNumber) {
    log(`refused: race ${n} is not the open race.`);
    return 2;
  }
  if (lock.state !== "awaiting-pick") {
    log(`refused: race ${n} is ${lock.state}, so it has no green attempt to pick.`);
    return 2;
  }
  const dir = raceDir(raceNumber);
  const summary = await readJsonOrNull(join(dir, letter, "summary.json"));
  if (summary === null || summary.outcome !== "pass") {
    log(`refused: Only a green attempt can be picked. Attempt ${letter} is ${summary === null ? "not verified" : summary.outcome}.`);
    return 2;
  }
  if ((await git(root, ["status", "--porcelain"])).trim() !== "") {
    log("refused: the main tree has uncommitted changes.");
    return 2;
  }
  const mainBefore = (await git(root, ["rev-parse", "HEAD"])).trim();
  const attemptBranch = branchName(raceNumber, letter);
  const attemptCommit = (await git(root, ["rev-parse", attemptBranch])).trim();
  const pickBranch = await freePickBranch(root, n, letter);
  const scratch = await mkdtemp(join(tmpdir(), "why-it-broke-pick-"));
  await git(root, ["worktree", "add", "-b", pickBranch, scratch, mainBefore]);
  await linkModules(root, scratch);
  try {
    try {
      await git(scratch, ["merge", "--no-ff", "--no-commit", attemptBranch]);
    } catch {
      await git(scratch, ["merge", "--abort"]).catch(() => {});
      log(`refused: ${attemptBranch} conflicts with main. Main did not move.`);
      return 2;
    }
    const records = `reports/races/${n}`;
    const note = pickNote({ n, letter, attemptBranch, attemptCommit, reason, mainBefore });
    await copyRecords(dir, join(scratch, records));
    await writeFile(join(scratch, records, "pick.md"), note);
    await git(scratch, ["add", "--", records]);
    await git(scratch, [
      "commit",
      "-q",
      "-m", `race ${n}: pick attempt ${letter}`,
      "-m", `Owner reason: ${reason.trim()}`,
      "-m", COAUTHOR
    ]);
    // The merge is the commit verify tests. Verify then commits its report on top of it, as
    // the Stop hook's verify does, so main's newest report names the merge it tested.
    const verify = await runProcess({
      command: process.execPath,
      args: [verifyScript, "--root", scratch],
      cwd: scratch,
      logFile: join(dir, "pick-verify.log")
    });
    const verified = verify.code === 0 ? "verified green" : verify.code === 1 ? "verified red" : "did not verify";
    const result =
      verify.code === 0
        ? `The merged result ${verified} (exit 0). Main moves to the merge.`
        : `The merged result ${verified} (exit ${verify.code}). Main did not move, and the race keeps the lock.`;
    // The record commit follows the report, so the report keeps the commit verify made.
    const record = `${note}\n${result}\n`;
    await writeFile(join(scratch, records, "pick.md"), record);
    await git(scratch, ["add", "--", records]);
    await git(scratch, ["commit", "-q", "-m", `race ${n}: record the pick result`, "-m", result, "-m", COAUTHOR]);
    await writeFile(join(dir, "pick.md"), record);
    if (verify.code === 0) {
      await git(root, ["merge", "--ff-only", pickBranch]);
      const merged = (await git(root, ["rev-parse", "HEAD"])).trim();
      for (const other of LETTERS) await removeWorktree(root, worktreePath(root, raceNumber, other));
      await releaseLock();
      log(`race ${n}: attempt ${letter} is in main at ${merged.slice(0, 7)}, and its merge verified green. The lock is released.`);
      return 0;
    }
    log(`race ${n}: the merge of attempt ${letter} ${verified} (exit ${verify.code}). Main did not move. The race keeps the lock. Log: ${join(dir, "pick-verify.log")}`);
    return verify.code === 1 ? 1 : 2;
  } finally {
    await removeWorktree(root, scratch);
  }
}

function pickNote({ n, letter, attemptBranch, attemptCommit, reason, mainBefore }) {
  return [
    `# Race ${n} pick`,
    "",
    `The owner picked attempt ${letter} (${attemptBranch}, commit ${attemptCommit.slice(0, 7)}).`,
    `Reason: ${reason.trim()}`,
    `Main was at ${mainBefore.slice(0, 7)} before the merge.`,
    ""
  ].join("\n");
}

// The pick branch keeps its name if one already exists, so a second pick of the same attempt gets a new branch.
async function freePickBranch(root, n, letter) {
  const taken = new Set(
    (await git(root, ["branch", "--list", `pick/${n}-${letter}*`, "--format=%(refname:short)"])).split("\n").map((line) => line.trim())
  );
  let name = `pick/${n}-${letter}`;
  for (let copy = 2; taken.has(name); copy += 1) name = `pick/${n}-${letter}-${copy}`;
  return name;
}

const isMain = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { reason: { type: "string" } } });
  runPick({ number: positionals[0], letter: positionals[1], reason: values.reason, log: (line) => console.log(line) }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`race:pick: ${error.message}`);
      process.exitCode = 2;
    }
  );
}

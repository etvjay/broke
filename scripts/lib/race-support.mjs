import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, symlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { git } from "./git.mjs";
import { racesDir } from "./lock.mjs";
import { padNumber } from "./report.mjs";

export const LETTERS = ["a", "b", "c"];

// Race-wide records, copied into reports/races/NNNN/ when a race is kept or picked.
const RECORD_FILES = ["comparison.md", "brief.md", "attempts.json"];

// Logs stay out of the records. Summaries, reports, and evidence are kept.
const NOT_RECORDED = new Set(["verify.log"]);

export const branchName = (number, letter) => `race/${padNumber(number)}-${letter}`;
export const reportBranchName = (number) => `race/${padNumber(number)}-report`;
export const worktreePath = (root, number, letter) =>
  join(dirname(root), `why-it-broke-race-${padNumber(number)}-${letter}`);

export async function addWorktree({ root, path, branch, start }) {
  await git(root, ["worktree", "add", "-b", branch, path, start]);
  await linkModules(root, path);
}

// Removes a worktree's folder and its registration. The branch stays.
export async function removeWorktree(root, path) {
  await git(root, ["worktree", "remove", "--force", path]).catch(() => {});
  await rm(path, { recursive: true, force: true });
  await git(root, ["worktree", "prune"]);
}

// Shares the repo's installed packages with a worktree. git ignores the link.
export async function linkModules(root, path) {
  if (await exists(join(root, "node_modules"))) {
    await symlink(join(root, "node_modules"), join(path, "node_modules"), "dir");
  }
}

// Copies the comparison, the brief, the attempt list, and each attempt's summary, report, and evidence.
export async function copyRecords(fromDir, toDir) {
  await mkdir(toDir, { recursive: true });
  for (const file of RECORD_FILES) {
    if (await exists(join(fromDir, file))) await cp(join(fromDir, file), join(toDir, file));
  }
  for (const letter of LETTERS) {
    if (!(await exists(join(fromDir, letter)))) continue;
    await cp(join(fromDir, letter), join(toDir, letter), {
      recursive: true,
      filter: (source) => !NOT_RECORDED.has(basename(source))
    });
  }
}

// One more than the highest race number, from race folders and race branches.
export async function nextRaceNumber(root) {
  const numbers = (await listDir(racesDir())).filter((name) => /^\d{4}$/.test(name)).map(Number);
  const branches = (await git(root, ["branch", "--list", "race/*", "--format=%(refname:short)"])).split("\n");
  for (const branch of branches) {
    const match = /^race\/(\d{4})-/.exec(branch.trim());
    if (match) numbers.push(Number(match[1]));
  }
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

// A child leads its own process group, so a stop reaches everything the child started.
const KILL_GRACE_MS = 10 * 1000;
// After a child exits, its output may still be open in a process that left the group.
const SETTLE_MS = 2 * 1000;

// Runs a command with its output in logFile. A timeout stops it and sets timedOut. A SIGINT or
// SIGTERM to this process stops it too, and the promise rejects. A stop sends SIGTERM to the
// group, then SIGKILL after killGraceMs.
export function runProcess({ command, args, cwd, logFile, timeoutMs = null, killGraceMs = KILL_GRACE_MS }) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(logFile);
    const child = spawn(command, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    let interruptedBy = null;
    let done = false;
    let killTimer = null;
    let settleTimer = null;
    const stopGroup = () => {
      signalGroup(child.pid, "SIGTERM");
      if (killTimer === null) killTimer = setTimeout(() => signalGroup(child.pid, "SIGKILL"), killGraceMs);
    };
    const onInterrupt = (signal) => {
      interruptedBy = signal;
      stopGroup();
    };
    const timer =
      timeoutMs === null
        ? null
        : setTimeout(() => {
            timedOut = true;
            stopGroup();
          }, timeoutMs);
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onInterrupt);
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(settleTimer);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      output.end(() => {
        if (interruptedBy === null) resolve({ ...result, timedOut });
        else reject(new Error(`interrupted by ${interruptedBy}`));
      });
    };
    child.on("error", (error) => finish({ code: null, signal: null, error: error.message }));
    child.on("exit", (code, signal) => {
      if (done) return;
      clearTimeout(timer);
      // Anything the child left running in its group is stopped, so nothing holds the output open.
      signalGroup(child.pid, "SIGKILL");
      settleTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish({ code, signal, error: null });
      }, SETTLE_MS);
    });
    child.on("close", (code, signal) => finish({ code, signal, error: null }));
  });
}

// Signals a child's process group. The group may already be gone.
function signalGroup(pid, signal) {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // Nothing is left in the group.
  }
}

export async function readJsonOrNull(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function listDir(dir) {
  try {
    return await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

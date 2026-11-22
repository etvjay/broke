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

// Runs a command with its output in logFile. A timeout sends SIGTERM and sets timedOut.
export function runProcess({ command, args, cwd, logFile, timeoutMs = null }) {
  return new Promise((resolve) => {
    const output = createWriteStream(logFile);
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    let done = false;
    const timer =
      timeoutMs === null
        ? null
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, timeoutMs);
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      output.end(() => resolve({ ...result, timedOut }));
    };
    child.on("error", (error) => finish({ code: null, signal: null, error: error.message }));
    child.on("close", (code, signal) => finish({ code, signal, error: null }));
  });
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

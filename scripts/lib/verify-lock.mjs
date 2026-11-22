import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { git } from "./git.mjs";
import { processAlive } from "./lock.mjs";

// Commit-mode verify runs take one lock per repo. The lock sits in the git folder, which every
// worktree of the repo shares. A lock whose process has exited is stale and is cleared. A lock
// that cannot be read counts as held, since another verify may be writing it.
export async function acquireVerifyLock(root) {
  const gitDir = resolve(root, (await git(root, ["rev-parse", "--git-common-dir"])).trim());
  const file = join(gitDir, "why-it-broke-verify.lock");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeFile(file, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`, { flag: "wx" });
      return { file, held: false };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const holder = await readHolder(file);
    if (holder === null) continue;
    if (!Number.isInteger(holder.pid) || processAlive(holder.pid)) return { file, held: true };
    await rm(file, { force: true });
  }
  return { file, held: true };
}

export async function releaseVerifyLock(file) {
  await rm(file, { force: true });
}

// The lock's contents, null when the lock is gone, or an empty object when it cannot be parsed.
async function readHolder(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return {};
  }
}

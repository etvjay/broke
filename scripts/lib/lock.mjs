import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { padNumber } from "./report.mjs";

// Race state lives outside the repo: the lock and each race's folder. homedir()
// is read on every call, so a test can point HOME at a temp folder.
export function stateDir() {
  return join(homedir(), ".why-it-broke");
}

export function lockPath() {
  return join(stateDir(), "race.lock");
}

export function racesDir() {
  return join(stateDir(), "races");
}

export function raceDir(number) {
  return join(racesDir(), padNumber(number));
}

// Creates the lock only when none exists. Returns false when a race holds it. The lock names
// the process that holds it, so a race that stopped can be told from one still running.
export async function acquireLock(raceId, head) {
  await mkdir(stateDir(), { recursive: true });
  try {
    await writeFile(lockPath(), `${JSON.stringify({ raceId, head, state: "racing", pid: process.pid }, null, 2)}\n`, { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}

export async function readLock() {
  try {
    return JSON.parse(await readFile(lockPath(), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function setLockState(state) {
  const lock = await readLock();
  if (lock === null) throw new Error("there is no race lock to update");
  await writeFile(lockPath(), `${JSON.stringify({ ...lock, state }, null, 2)}\n`);
}

export async function releaseLock() {
  await rm(lockPath(), { force: true });
}

// A racing lock whose process has exited: the race stopped, for example when the machine restarted.
// An awaiting-pick lock is never stale, because the owner decides what happens to it.
export function isStaleLock(lock) {
  return lock !== null && lock.state === "racing" && !processAlive(lock.pid);
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

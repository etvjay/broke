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

// Creates the lock only when none exists. Returns false when a race holds it.
export async function acquireLock(raceId, head) {
  await mkdir(stateDir(), { recursive: true });
  try {
    await writeFile(lockPath(), `${JSON.stringify({ raceId, head, state: "racing" }, null, 2)}\n`, { flag: "wx" });
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

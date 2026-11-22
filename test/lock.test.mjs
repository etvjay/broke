import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, isStaleLock, lockPath, readLock, releaseLock, stateDir } from "../scripts/lib/lock.mjs";

const realHome = process.env.HOME;
const temps = [];

after(async () => {
  process.env.HOME = realHome;
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

async function useHome() {
  const home = await mkdtemp(join(tmpdir(), "wib-lock-"));
  temps.push(home);
  process.env.HOME = home;
}

test("acquireLock records the holding process, and a second race is refused", async () => {
  await useHome();
  assert.equal(await acquireLock(3, "d".repeat(40)), true);
  const held = await readLock();
  assert.equal(held.pid, process.pid);
  assert.equal(held.state, "racing");
  assert.equal(await acquireLock(4, "e".repeat(40)), false);
  await releaseLock();
});

test("a racing lock is stale only when its race process has exited", async () => {
  await useHome();
  await acquireLock(3, "d".repeat(40));
  assert.equal(isStaleLock(await readLock()), false);
  await releaseLock();
  const exited = spawnSync(process.execPath, ["-e", ""]).pid;
  await mkdir(stateDir(), { recursive: true });
  await writeFile(lockPath(), `${JSON.stringify({ raceId: 3, head: "d".repeat(40), state: "racing", pid: exited })}\n`);
  const stale = await readLock();
  assert.equal(isStaleLock(stale), true);
  assert.equal(isStaleLock({ ...stale, state: "awaiting-pick" }), false);
  assert.equal(isStaleLock(null), false);
  await releaseLock();
});

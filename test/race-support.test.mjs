import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runProcess } from "../scripts/lib/race-support.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_RACER = join(HERE, "fixtures", "run-racer.mjs");
const temps = [];

after(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

// Racers write their own pid to the file named by argv[1] first, so a test can find and stop them.
const RECORD_PID = `require("node:fs").writeFileSync(process.argv[1], String(process.pid));`;
const IGNORES_SIGTERM = `${RECORD_PID} process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`;
const RUNS_UNTIL_STOPPED = `${RECORD_PID} setInterval(() => {}, 1000);`;
// A racer that starts a child sharing its output, records the child's pid, and exits 0.
const LEAVES_CHILD_IN_GROUP = `
  const { spawn } = require("node:child_process");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
  child.unref();
  require("node:fs").writeFileSync(process.argv[1], String(child.pid));
`;
// The same, but the child leaves the racer's process group.
const LEAVES_CHILD_OUT_OF_GROUP = `
  const { spawn } = require("node:child_process");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "inherit" });
  child.unref();
  require("node:fs").writeFileSync(process.argv[1], String(child.pid));
`;

test("a racer that ignores SIGTERM is stopped with SIGKILL after the grace period", { timeout: 30000 }, async () => {
  const dir = await scratch();
  const pidFile = join(dir, "racer.pid");
  try {
    const result = await settledWithin(
      runProcess({
        command: process.execPath,
        args: ["-e", IGNORES_SIGTERM, pidFile],
        cwd: dir,
        logFile: join(dir, "racer.log"),
        timeoutMs: 200,
        killGraceMs: 300
      }),
      10000
    );
    assert.notEqual(result, "hung", "runProcess did not settle after the racer ignored SIGTERM");
    assert.equal(result.timedOut, true);
    assert.equal(result.signal, "SIGKILL");
  } finally {
    await killRecorded(pidFile);
  }
});

test("a process the racer leaves in its group does not keep the race waiting", { timeout: 30000 }, async () => {
  const dir = await scratch();
  const pidFile = join(dir, "leftover.pid");
  try {
    const result = await settledWithin(
      runProcess({
        command: process.execPath,
        args: ["-e", LEAVES_CHILD_IN_GROUP, pidFile],
        cwd: dir,
        logFile: join(dir, "racer.log")
      }),
      10000
    );
    assert.notEqual(result, "hung", "a process left in the racer's group kept runProcess waiting");
    assert.equal(result.code, 0);
    assert.equal(result.timedOut, false);
  } finally {
    await killRecorded(pidFile);
  }
});

test("a process that leaves the racer's group does not hold the race open", { timeout: 30000 }, async () => {
  const dir = await scratch();
  const pidFile = join(dir, "escaped.pid");
  try {
    const result = await settledWithin(
      runProcess({
        command: process.execPath,
        args: ["-e", LEAVES_CHILD_OUT_OF_GROUP, pidFile],
        cwd: dir,
        logFile: join(dir, "racer.log")
      }),
      10000
    );
    assert.notEqual(result, "hung", "a process outside the racer's group kept runProcess waiting");
    assert.equal(result.code, 0);
  } finally {
    await killRecorded(pidFile);
  }
});

test("SIGINT to the race stops the racer and rejects, so the race can release its lock", { timeout: 30000 }, async () => {
  const dir = await scratch();
  const pidFile = join(dir, "racer.pid");
  const parent = spawn(process.execPath, [RUN_RACER, join(dir, "racer.log"), RUNS_UNTIL_STOPPED, pidFile], {
    cwd: dir,
    stdio: ["ignore", "pipe", "ignore"]
  });
  let out = "";
  parent.stdout.on("data", (chunk) => {
    out += chunk;
  });
  try {
    const racerPid = await waitForPid(pidFile);
    const closed = once(parent, "close");
    parent.kill("SIGINT");
    const outcome = await settledWithin(closed, 10000);
    assert.notEqual(outcome, "hung", "the race process did not exit after SIGINT");
    assert.equal(outcome[0], 3, `expected exit 3 from the stopped run, got ${outcome[0]} (${outcome[1]}). Output: ${out}`);
    assert.match(out, /stopped: interrupted by SIGINT/);
    assert.equal(await waitUntilGone(racerPid, 5000), true, "the racer survived SIGINT");
  } finally {
    parent.kill("SIGKILL");
    await killRecorded(pidFile);
  }
});

test("a racer that exits on its own gives its code and its output", async () => {
  const dir = await scratch();
  const logFile = join(dir, "racer.log");
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", 'console.log("hello"); process.exitCode = 3;'],
    cwd: dir,
    logFile
  });
  assert.deepEqual(result, { code: 3, signal: null, error: null, timedOut: false });
  assert.equal(await readFile(logFile, "utf8"), "hello\n");
});

test("a timeout stops a racer that honors SIGTERM and reports timedOut", async () => {
  const dir = await scratch();
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000);"],
    cwd: dir,
    logFile: join(dir, "racer.log"),
    timeoutMs: 200
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGTERM");
});

async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "wib-race-support-"));
  temps.push(dir);
  return dir;
}

// The promise's value, or "hung" when it has not settled within ms.
async function settledWithin(promise, ms) {
  let timer;
  const hung = new Promise((resolve) => {
    timer = setTimeout(resolve, ms, "hung");
  });
  try {
    return await Promise.race([promise, hung]);
  } finally {
    clearTimeout(timer);
  }
}

async function readPid(file) {
  try {
    return Number((await readFile(file, "utf8")).trim()) || null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function waitForPid(file) {
  for (let tries = 0; tries < 200; tries += 1) {
    const pid = await readPid(file);
    if (pid !== null) return pid;
    await sleep(50);
  }
  throw new Error(`no pid was written to ${file}`);
}

async function killRecorded(file) {
  const pid = await readPid(file);
  if (pid === null) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process already exited.
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function waitUntilGone(pid, ms) {
  const deadline = Date.now() + ms;
  while (isAlive(pid)) {
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
  return true;
}

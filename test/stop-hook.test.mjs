import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireLock } from "../scripts/lib/lock.mjs";
import { TEST_EMAIL, TEST_NAME } from "./support/identity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const HOOK = join(ROOT, "scripts", "stop-hook.mjs");
const FAKE_VERIFY = join(HERE, "fixtures", "fake-verify.mjs");
const FAKE_RACE = join(HERE, "fixtures", "fake-race.mjs");
const realHome = process.env.HOME;
const temps = [];

after(async () => {
  process.env.HOME = realHome;
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

// A repo whose HEAD is the report for 0001, the way verify leaves it.
async function setup({ withReport = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "wib-hook-"));
  temps.push(dir);
  const home = join(dir, "home");
  await mkdir(home);
  const repo = join(dir, "kane");
  await mkdir(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.name", TEST_NAME]);
  git(repo, ["config", "user.email", TEST_EMAIL]);
  await mkdir(join(repo, "app"));
  await writeFile(join(repo, "app", "fix.txt"), "start\n");
  await mkdir(join(repo, "explain"));
  await writeFile(join(repo, "explain", "functions.json"), "[]\n");
  await writeFile(join(repo, "README.md"), "docs\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "code"]);
  const tested = git(repo, ["rev-parse", "HEAD"]).trim();
  if (withReport) {
    await mkdir(join(repo, "reports"));
    await writeFile(join(repo, "reports", "0001.md"), `# report 0001\n\nTested commit: ${tested}\n`);
    const summary = { number: 1, testedCommit: tested, outcome: "pass", flows: [], drift: { ok: true, skipped: false, problems: [] } };
    await writeFile(join(repo, "reports", "0001.json"), `${JSON.stringify(summary, null, 2)}\n`);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "report: 0001", "-m", `Tested commit: ${tested}`]);
  }
  return { repo, home, dir };
}

async function changeApp(repo, content) {
  await writeFile(join(repo, "app", "fix.txt"), content);
}

function commit(repo, message) {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message]);
}

// Runs the hook the way Droid does: the Stop event JSON on stdin.
function runHook({ repo, home, input = {}, env = {} }) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      session_id: "test",
      transcript_path: join(home, "t.jsonl"),
      cwd: repo,
      permission_mode: "auto-medium",
      hook_event_name: "Stop",
      ...input
    }),
    env: { ...process.env, HOME: home, WHY_IT_BROKE_VERIFY_CMD: FAKE_VERIFY, WHY_IT_BROKE_RACE_CMD: FAKE_RACE, ...env },
    encoding: "utf8",
    timeout: 120000
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function waitForFile(path, ms = 10000) {
  const started = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - started > ms) return false;
    await new Promise((done) => setTimeout(done, 100));
  }
  return true;
}

async function settle(ms = 1000) {
  await new Promise((done) => setTimeout(done, ms));
}

test("uncommitted app change: the hook exits 2, asks for a commit, and verifies nothing", async () => {
  const ctx = await setup();
  await changeApp(ctx.repo, "red\n");
  const before = git(ctx.repo, ["rev-parse", "HEAD"]).trim();
  const r = runHook({ repo: ctx.repo, home: ctx.home, input: { stop_hook_active: false } });
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /Commit your change under app\/ or explain\/ before you stop/);
  assert.equal(git(ctx.repo, ["rev-parse", "HEAD"]).trim(), before);
});

test("uncommitted app change after one block: the hook exits 0 and does not block again", async () => {
  const ctx = await setup();
  await changeApp(ctx.repo, "red\n");
  const r = runHook({ repo: ctx.repo, home: ctx.home, input: { stop_hook_active: true } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /does not block again/);
});

test("a commit under app/ is verified after the block, even when stop_hook_active is true, and green ends the turn", async () => {
  const ctx = await setup();
  await changeApp(ctx.repo, "green\n");
  commit(ctx.repo, "fix: vote");
  const fix = git(ctx.repo, ["rev-parse", "HEAD"]).trim();
  const r = runHook({ repo: ctx.repo, home: ctx.home, input: { stop_hook_active: true } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Verified green: report 0002/);
  assert.equal(git(ctx.repo, ["rev-parse", "HEAD^"]).trim(), fix);
  assert.match(git(ctx.repo, ["log", "-1", "--format=%s"]), /^report: 0002 verify of /);
  assert.ok(existsSync(join(ctx.repo, "reports", "0002.json")));
});

test("a red app fault starts a race in the background and exits 0 with the owner's pick command", async () => {
  const ctx = await setup();
  await changeApp(ctx.repo, "red\n");
  commit(ctx.repo, "fix: attempt");
  const marker = join(ctx.dir, "race-started.json");
  const r = runHook({ repo: ctx.repo, home: ctx.home, env: { FAKE_RACE_MARKER: marker } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Verified red: report 0002/);
  assert.match(r.stdout, /A fix race started in the background/);
  assert.match(r.stdout, /one attempt.*runner merges it/i);
  assert.match(r.stdout, /two or three.*npm run race:pick -- NNNN <a\|b\|c>/i);
  assert.equal(await waitForFile(marker), true);
  const started = JSON.parse(await readFile(marker, "utf8"));
  assert.equal(started.args[0], "--root");
});

test("a red that is not an app fault does not start a race", async () => {
  const ctx = await setup();
  await changeApp(ctx.repo, "red\n");
  commit(ctx.repo, "fix: attempt");
  const marker = join(ctx.dir, "race-started.json");
  const r = runHook({ repo: ctx.repo, home: ctx.home, env: { FAKE_RACE_MARKER: marker, FAKE_VERIFY_FAMILY: "automation_bug" } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Verified red: report 0002/);
  assert.match(r.stdout, /does not put the fault in the app/);
  await settle();
  assert.equal(existsSync(marker), false);
});

test("a red while a race holds the lock does not start another race", async () => {
  const ctx = await setup();
  process.env.HOME = ctx.home;
  try {
    assert.equal(await acquireLock(1, "0".repeat(40)), true);
  } finally {
    process.env.HOME = realHome;
  }
  await changeApp(ctx.repo, "red\n");
  commit(ctx.repo, "fix: attempt");
  const marker = join(ctx.dir, "race-started.json");
  const r = runHook({ repo: ctx.repo, home: ctx.home, env: { FAKE_RACE_MARKER: marker } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /holds the lock/);
  await settle();
  assert.equal(existsSync(marker), false);
});

test("a red over a lock left by an exited race starts a new race", async () => {
  const ctx = await setup();
  const exited = spawnSync(process.execPath, ["-e", ""]).pid;
  await mkdir(join(ctx.home, ".why-it-broke"), { recursive: true });
  await writeFile(join(ctx.home, ".why-it-broke", "race.lock"), `${JSON.stringify({ raceId: 2, head: "0".repeat(40), state: "racing", pid: exited })}\n`);
  await changeApp(ctx.repo, "red\n");
  commit(ctx.repo, "fix: attempt");
  const marker = join(ctx.dir, "race-started.json");
  const r = runHook({ repo: ctx.repo, home: ctx.home, env: { FAKE_RACE_MARKER: marker } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /A fix race started in the background/);
  assert.doesNotMatch(r.stdout, /holds the lock/);
  assert.equal(await waitForFile(marker), true);
});

test("a red verify that does not finish is reported, not raced", async () => {
  const ctx = await setup();
  await changeApp(ctx.repo, "broken\n");
  commit(ctx.repo, "fix: attempt");
  const marker = join(ctx.dir, "race-started.json");
  const r = runHook({ repo: ctx.repo, home: ctx.home, env: { FAKE_RACE_MARKER: marker } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Verify did not finish \(exit 2\)/);
  await settle();
  assert.equal(existsSync(marker), false);
});

test("a commit that changes only docs does not run verify", async () => {
  const ctx = await setup();
  await writeFile(join(ctx.repo, "README.md"), "more docs\n");
  commit(ctx.repo, "docs: more");
  const before = git(ctx.repo, ["rev-parse", "HEAD"]).trim();
  const r = runHook({ repo: ctx.repo, home: ctx.home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /No change under app\/ or explain\/ since report 0001/);
  assert.equal(git(ctx.repo, ["rev-parse", "HEAD"]).trim(), before);
});

test("after a green pick, the newest report tests HEAD's app code, so the hook does not verify again", async () => {
  const ctx = await setup();
  await changeApp(ctx.repo, "green\n");
  commit(ctx.repo, "fix: vote");
  const tested = git(ctx.repo, ["rev-parse", "HEAD"]).trim();
  await writeFile(join(ctx.repo, "reports", "0002.md"), `# report 0002\n\nTested commit: ${tested}\n`);
  await writeFile(join(ctx.repo, "reports", "0002.json"), `${JSON.stringify({ number: 2, testedCommit: tested, outcome: "pass", flows: [], drift: { ok: true, skipped: false, problems: [] } }, null, 2)}\n`);
  commit(ctx.repo, "report: 0002 pick report");
  const r = runHook({ repo: ctx.repo, home: ctx.home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /No change under app\/ or explain\/ since report 0002/);
});

test("a verified HEAD with nothing new does nothing", async () => {
  const ctx = await setup();
  const r = runHook({ repo: ctx.repo, home: ctx.home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /No change under app\/ or explain\/ since report 0001/);
});

test("with no report yet the hook does not verify", async () => {
  const ctx = await setup({ withReport: false });
  await changeApp(ctx.repo, "green\n");
  commit(ctx.repo, "fix: vote");
  const before = git(ctx.repo, ["rev-parse", "HEAD"]).trim();
  const r = runHook({ repo: ctx.repo, home: ctx.home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /No Why It Broke report exists yet/);
  assert.equal(git(ctx.repo, ["rev-parse", "HEAD"]).trim(), before);
});

test("a racer worktree on a race branch does not verify, even with a commit under app/", async () => {
  const ctx = await setup();
  git(ctx.repo, ["checkout", "-q", "-b", "race/0001-a"]);
  await changeApp(ctx.repo, "green\n");
  commit(ctx.repo, "fix: racer");
  const before = git(ctx.repo, ["rev-parse", "HEAD"]).trim();
  const r = runHook({ repo: ctx.repo, home: ctx.home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /race worktree/);
  assert.equal(git(ctx.repo, ["rev-parse", "HEAD"]).trim(), before);
});

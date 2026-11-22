import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FLOWS } from "../scripts/config.mjs";
import { readRun } from "../scripts/lib/coverage.mjs";
import { sha256File } from "../scripts/lib/hash.mjs";
import { classifyRun } from "../scripts/lib/kane.mjs";
import { runVerify } from "../scripts/verify.mjs";
import { PACK_ENTRIES, zipEntries } from "./fixtures/evidence-pack.mjs";
import { TEST_EMAIL, TEST_NAME } from "./support/identity.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_KANE = join(ROOT, "test", "fixtures", "fake-kane.mjs");
const temps = [];

after(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

async function makeRepo({ approved = true, brokenApp = false, ignoreSigterm = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "wib-verify-"));
  temps.push(root);
  for (const dir of ["app", "flows", "explain", "scripts"]) {
    await cp(join(ROOT, dir), join(root, dir), { recursive: true });
  }
  await cp(join(ROOT, "package.json"), join(root, "package.json"));
  await writeFile(join(root, ".gitignore"), "node_modules/\n");
  await symlink(join(ROOT, "node_modules"), join(root, "node_modules"), "dir");
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.name", TEST_NAME]);
  await git(root, ["config", "user.email", TEST_EMAIL]);
  const approvals = {};
  for (const flow of FLOWS) approvals[`${flow}.md`] = await sha256File(join(root, "flows", `${flow}.md`));
  if (!approved) approvals["poll-vote.md"] = "0".repeat(64);
  await writeFile(join(root, "flows", "approvals.json"), `${JSON.stringify(approvals, null, 2)}\n`);
  if (brokenApp) await prependToServer(root, 'throw new Error("boom");');
  if (ignoreSigterm) {
    await appendToServer(root, `process.removeAllListeners("SIGTERM");
process.on("SIGTERM", holdOpen);
function holdOpen() {}`);
  }
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-q", "-m", "fixture"]);
  return root;
}

async function prependToServer(root, statement) {
  const file = join(root, "app", "server.mjs");
  await writeFile(file, `${statement}\n${await readFile(file, "utf8")}`);
}

async function appendToServer(root, statement) {
  const file = join(root, "app", "server.mjs");
  await writeFile(file, `${await readFile(file, "utf8")}\n${statement}\n`);
}

const scenario = (name) => ({ FAKE_KANE_SCENARIO: name });
const reportPath = (root) => join(root, "reports", "0001.md");

test("a green run also commits its summary as reports/0001.json", { timeout: 120000 }, async () => {
  const root = await makeRepo();
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: scenario("pass") }), 0);
  const summary = JSON.parse(await readFile(join(root, "reports", "0001.json"), "utf8"));
  assert.equal(summary.testedCommit, head);
  assert.equal(summary.outcome, "pass");
  assert.deepEqual(summary.flows.map((flow) => flow.name), ["poll-create.md", "poll-vote.md", "poll-vote-once.md"]);
  assert.ok(summary.flows[0].trace.length > 0);
});

test("attempt mode writes the report and summary outside the repo and commits nothing", { timeout: 120000 }, async () => {
  const root = await makeRepo();
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  const out = await mkdtemp(join(tmpdir(), "wib-attempt-"));
  temps.push(out);
  const attemptOut = join(out, "a");
  assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: scenario("pass"), attemptOut, label: "race 0001 attempt a" }), 0);
  assert.equal((await git(root, ["rev-parse", "HEAD"])).trim(), head);
  assert.equal((await git(root, ["status", "--porcelain"])).trim(), "");
  const report = await readFile(join(attemptOut, "report.md"), "utf8");
  assert.match(report, /^# Why It Broke report: race 0001 attempt a$/m);
  assert.match(report, new RegExp(`Tested commit: ${head}`));
  const summary = JSON.parse(await readFile(join(attemptOut, "summary.json"), "utf8"));
  assert.equal(summary.number, null);
  assert.equal(summary.outcome, "pass");
});

async function assertNoReports(root) {
  await assert.rejects(readdir(join(root, "reports")), { code: "ENOENT" });
}

test("a green run exits 0, commits reports/0001.md, and leaves the tree clean", { timeout: 120000 }, async () => {
  const root = await makeRepo();
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: scenario("pass") }), 0);
  const report = await readFile(reportPath(root), "utf8");
  assert.match(report, new RegExp(`Tested commit: ${head}`));
  assert.match(report, /\| poll-create\.md \| pass/);
  assert.equal((await git(root, ["status", "--porcelain"])).trim(), "");
  assert.match(await git(root, ["log", "-1", "--format=%s"]), /^report: 0001 verify of /);
});

test("a failed flow exits 1 and still commits the report", { timeout: 120000 }, async () => {
  const root = await makeRepo();
  assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: scenario("fail") }), 1);
  assert.match(await readFile(reportPath(root), "utf8"), /\| poll-vote\.md \| fail \| Vote did not count/);
  assert.match(await git(root, ["log", "-1", "--format=%s"]), /^report: 0001/);
});

test("a run that never reaches run_end is an error and exits 2", { timeout: 120000 }, async () => {
  const root = await makeRepo();
  assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: scenario("no-run-end") }), 2);
  assert.match(await readFile(reportPath(root), "utf8"), /\| poll-create\.md \| error \| no run_end/);
});

test("a dirty tree is refused before any flow runs", { timeout: 120000 }, async () => {
  const root = await makeRepo();
  await writeFile(join(root, "scratch.txt"), "not committed\n");
  assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: scenario("pass") }), 2);
  await assertNoReports(root);
});

test("a flow that is not approved at its current hash is refused", { timeout: 120000 }, async () => {
  const root = await makeRepo({ approved: false });
  assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: scenario("pass") }), 2);
  await assertNoReports(root);
});

test("low Kane credits stop the run before any flow starts", { timeout: 120000 }, async () => {
  const root = await makeRepo();
  assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: scenario("low-credits") }), 2);
  await assertNoReports(root);
});

test("an app that fails to start is an error, never a green run", { timeout: 120000 }, async () => {
  const root = await makeRepo({ brokenApp: true });
  assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: scenario("pass") }), 2);
  assert.match(await readFile(reportPath(root), "utf8"), /app failed to start/);
});

test("a port that is already taken stops the app from starting, so verify exits 2", { timeout: 120000 }, async () => {
  const root = await makeRepo();
  const blocker = createHttpServer();
  await new Promise((resolve) => blocker.listen(0, resolve));
  try {
    const port = blocker.address().port;
    assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: scenario("pass"), pickPort: async () => port }), 2);
    assert.match(await readFile(reportPath(root), "utf8"), /app failed to start/);
  } finally {
    blocker.closeAllConnections();
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("an app that ignores SIGTERM writes no coverage, so the flow is an error", { timeout: 120000 }, async () => {
  const root = await makeRepo({ ignoreSigterm: true });
  assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: scenario("pass"), stopTimeoutMs: 500 }), 2);
  assert.match(await readFile(reportPath(root), "utf8"), /did not stop cleanly/);
});

test("verify refuses without a git identity and names the git config commands", { timeout: 120000 }, async () => {
  const root = await makeRepo();
  await git(root, ["config", "--unset", "user.name"]);
  await git(root, ["config", "--unset", "user.email"]);
  const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = join(tmpdir(), "wib-no-global-git-config");
  const lines = [];
  try {
    assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: scenario("pass"), log: (line) => lines.push(line) }), 2);
  } finally {
    if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
  }
  assert.match(lines.join("\n"), /git config user\.name "Your Name"/);
  assert.match(lines.join("\n"), /git config user\.email "you@example\.com"/);
  await assertNoReports(root);
});

test("classifyRun: passed with exit 0 is a pass", () => {
  assert.equal(classifyRun({ exitCode: 0, runEnd: { status: "passed" } }).outcome, "pass");
});

test("classifyRun: failed with a verdict and exit 1 is a fail", () => {
  const result = classifyRun({ exitCode: 1, runEnd: { status: "failed", verdict: { one_liner: "Vote did not count" } } });
  assert.equal(result.outcome, "fail");
  assert.match(result.reason, /Vote did not count/);
});

test("classifyRun: no run_end is an error, never a pass", () => {
  assert.equal(classifyRun({ exitCode: 0, runEnd: null, lastEventType: "step" }).outcome, "error");
});

test("classifyRun: passed with a non-zero exit is an error", () => {
  assert.equal(classifyRun({ exitCode: 1, runEnd: { status: "passed" } }).outcome, "error");
});

test("classifyRun: failed without a verdict is an error", () => {
  assert.equal(classifyRun({ exitCode: 1, runEnd: { status: "failed" } }).outcome, "error");
});

test("readRun maps app functions to run counts and fails on an empty folder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wib-cov-"));
  temps.push(dir);
  const appDir = join(dir, "app");
  const coverage = join(dir, "coverage");
  const empty = join(dir, "empty");
  await mkdir(coverage);
  await mkdir(empty);
  await writeFile(join(coverage, "coverage-1.json"), JSON.stringify({
    result: [
      { url: pathToFileURL(join(appDir, "store.mjs")).href, functions: [
        { functionName: "a", ranges: [{ startOffset: 10, endOffset: 40, count: 3 }] },
        { functionName: "b", ranges: [{ startOffset: 50, endOffset: 80, count: 0 }] }
      ] },
      { url: "node:internal/x", functions: [] }
    ]
  }));
  const counts = await readRun(coverage, appDir);
  assert.equal(counts.get("app/store.mjs:10"), 3);
  assert.equal(counts.get("app/store.mjs:50"), 0);
  await assert.rejects(readRun(empty, appDir), /no coverage files/);
});

async function writePack() {
  const dir = await mkdtemp(join(tmpdir(), "wib-pack-"));
  temps.push(dir);
  const path = join(dir, "pack.evidence");
  await writeFile(path, zipEntries(PACK_ENTRIES));
  return path;
}

test("a pass with an evidence pack copies the redacted text and links it from the report", { timeout: 120000 }, async () => {
  const root = await makeRepo();
  const packPath = await writePack();
  assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: { FAKE_KANE_SCENARIO: "pass", FAKE_KANE_PACK: packPath } }), 0);
  const copy = join(root, "reports", "evidence", "0001", "poll-create");
  assert.match(await readFile(join(copy, "tests", "open-page", "logs", "tui.log"), "utf8"), /Profile <profile> opened/);
  await assert.rejects(readFile(join(copy, "tests", "open-page", "logs", "token.log")), { code: "ENOENT" });
  const report = await readFile(reportPath(root), "utf8");
  assert.match(report, /\[redacted copy\]\(evidence\/0001\/poll-create\/\), 4 text files/);
  assert.match(report, /tests\/open-page\/logs\/token\.log \(token\)/);
  assert.match(await git(root, ["show", "--stat", "--format=", "HEAD"]), /reports\/evidence\/0001\/poll-create\/run\.yaml/);
  assert.equal((await git(root, ["status", "--porcelain"])).trim(), "");
});

test("a Kane verdict that names an email or a home path is redacted before the report is written", { timeout: 120000 }, async () => {
  const root = await makeRepo();
  const rootCause = "Vote failed for owner@example.com under /home/ubuntu/kane";
  assert.equal(await runVerify({ root, kaneBin: FAKE_KANE, kaneEnv: { FAKE_KANE_SCENARIO: "fail", FAKE_KANE_ROOT_CAUSE: rootCause } }), 1);
  const report = await readFile(reportPath(root), "utf8");
  assert.match(report, /- Root cause: Vote failed for <email> under ~\/kane/);
  assert.equal(report.includes("owner@example.com"), false);
  assert.equal(report.includes("/home/ubuntu"), false);
});

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanSecrets } from "../scripts/lib/redact.mjs";
import { extractFeatured } from "../scripts/site-featured.mjs";
import { buildSite, loadSite, renderSite } from "../scripts/site.mjs";
import { TEST_EMAIL, TEST_NAME } from "./support/identity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const temps = [];

after(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), "wib-site-"));
  temps.push(dir);
  const repo = join(dir, "repo");
  await mkdir(repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.name", TEST_NAME]);
  git(repo, ["config", "user.email", TEST_EMAIL]);
  await writeFile(join(repo, "app.txt"), "v1\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "initial code"]);
  return { dir, repo };
}

function reportMarkdown({ number, testedCommit, flowName, source }) {
  const pad = String(number).padStart(4, "0");
  return [
    `# Why It Broke report ${pad}`,
    "",
    `Tested commit: ${testedCommit}`,
    "",
    "## Flows",
    "",
    "| Flow | Verdict | Detail |",
    "| --- | --- | --- |",
    `| ${flowName} | fail | failed |`,
    "",
    `## ${flowName}: fail`,
    "",
    "- Verdict: fail",
    "- Reason: Duplicate poll created",
    "",
    "Functions that ran in this flow, in file order:",
    "",
    "### app/server.mjs:98 addPollRoute",
    "",
    "Reads the new poll from the request body and saves it.",
    "",
    "Signature: `async function addPollRoute(context, req, res)`",
    "",
    "<details>",
    "<summary>Source</summary>",
    "",
    "```js",
    source,
    "```",
    "",
    "</details>",
    ""
  ].join("\n");
}

async function addRedReport(repo, { number = 1, includeStepYaml = true, stepSummaryScript = false } = {}) {
  const pad = String(number).padStart(4, "0");
  const tested = git(repo, ["rev-parse", "HEAD"]).trim();
  const summary = {
    number,
    testedCommit: tested,
    outcome: "fail",
    flows: [
      {
        name: "poll-create-once.md",
        outcome: "fail",
        reason: stepSummaryScript ? "Bad <script>alert(1)</script> result" : "Duplicate poll created",
        verdict: {
          family: "application_issue",
          category: "functional_defect",
          root_cause: "Double click sends two POST requests.",
          suggestion: "Disable the button while creating.",
          agent_fault_assessment: "The app failed to guard repeat clicks.",
          confidence: 0.98,
          culprit_step: "0-7"
        },
        steps: 10,
        credits: 24.5,
        seconds: 55,
        trace: [
          {
            file: "app/server.mjs",
            line: 98,
            name: "addPollRoute",
            status: "current",
            explanation: "Reads the new poll from the request body and saves it."
          }
        ]
      }
    ],
    drift: { ok: true, skipped: false, problems: [] }
  };
  await mkdir(join(repo, "reports", "evidence", pad, "poll-create-once", "tests", "t1", "steps", "7-0-7"), { recursive: true });
  await mkdir(join(repo, "reports", "evidence", pad, "poll-create-once", "tests", "t1", "steps", "8-0-8"), { recursive: true });
  await writeFile(join(repo, "reports", `${pad}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(
    join(repo, "reports", `${pad}.md`),
    reportMarkdown({
      number,
      testedCommit: tested,
      flowName: "poll-create-once.md",
      source: "async function addPollRoute() {\n  return 201;\n}"
    })
  );
  const rootFailure = [
    "generated: 2026-11-26T09:00:00Z",
    "totals:",
    "  failures: 2",
    "failures:",
    "  - test: t1",
    "    ordinal: 7",
    "    step: 0-7",
    "    status: failed",
    "    path: tests/t1/steps/7-0-7/failure.yaml",
    stepSummaryScript
      ? '    title: "Create poll <script>alert(1)</script> twice"'
      : "    title: Create poll submits twice on a double-click",
    "  - test: t1",
    "    ordinal: 8",
    "    step: 0-8",
    "    status: failed",
    "    path: tests/t1/steps/8-0-8/failure.yaml",
    ""
  ].join("\n");
  await writeFile(join(repo, "reports", "evidence", pad, "poll-create-once", "failure.yaml"), rootFailure);
  if (includeStepYaml) {
    const stepYaml = [
      "step: 0-8",
      "status: failed",
      "error:",
      "  message: 'Expected one poll but found two'",
      ""
    ].join("\n");
    await writeFile(join(repo, "reports", "evidence", pad, "poll-create-once", "tests", "t1", "steps", "8-0-8", "failure.yaml"), stepYaml);
  }
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", `report: ${pad}`]);
  return { pad, tested, reportCommit: git(repo, ["rev-parse", "HEAD"]).trim() };
}

test("red run shows failing step with title, step failure.yaml fallback, source block, and escapes HTML", async () => {
  const { repo } = await makeRepo();
  await addRedReport(repo, { number: 1, includeStepYaml: true, stepSummaryScript: true });
  const data = await loadSite({ root: repo });
  const html = renderSite(data);
  assert.match(html, /Create poll &lt;script&gt;alert\(1\)&lt;\/script&gt; twice/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Expected one poll but found two/);
  assert.match(html, /application_issue/);
  assert.match(html, /async function addPollRoute\(\)/);
  assert.match(html, /<details>/);
  assert.match(html, /No race has reached main yet\./);
});

test("failing step with no title and missing step failure.yaml shows step name and no message recorded", async () => {
  const { repo } = await makeRepo();
  await addRedReport(repo, { number: 1, includeStepYaml: false });
  const html = renderSite(await loadSite({ root: repo }));
  assert.match(html, /0-8/);
  assert.match(html, /no message was recorded/i);
});

test("picked race by owner and matching green report on main fill red, race, pick, and green sections", async () => {
  const { repo } = await makeRepo();
  const red = await addRedReport(repo, { number: 1 });
  const mainBefore = red.reportCommit;
  git(repo, ["checkout", "-q", "-b", "race/0001-b"]);
  await writeFile(join(repo, "app.txt"), "fixed by b\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "fix: disable button"]);
  const attemptCommit = git(repo, ["rev-parse", "HEAD"]).trim();
  git(repo, ["checkout", "-q", "main"]);
  git(repo, ["merge", "--no-ff", "--no-commit", "race/0001-b"]);
  await mkdir(join(repo, "reports", "races", "0001"), { recursive: true });
  await writeFile(
    join(repo, "reports", "races", "0001", "comparison.md"),
    "# Race 0001 comparison\n\nThe red report is 0001. Starts a race.\n"
  );
  await writeFile(
    join(repo, "reports", "races", "0001", "attempts.json"),
    `${JSON.stringify({
      number: 1,
      base: mainBefore,
      tested: red.tested,
      attempts: [
        { letter: "a", branch: "race/0001-a", commit: "1111111", status: "red", reason: "poll-create-once.md failed.", files: 1, insertions: 2, deletions: 1, explanationsChanged: 0, flows: [{ name: "poll-create-once.md", outcome: "fail", verdict: { family: "application_issue" } }], drift: { ok: true, problems: 0 } },
        { letter: "b", branch: "race/0001-b", commit: attemptCommit.slice(0, 7), status: "green", reason: "every flow passed and drift passed.", files: 1, insertions: 4, deletions: 1, explanationsChanged: 1, flows: [{ name: "poll-create-once.md", outcome: "pass", verdict: null }], drift: { ok: true, problems: 0 } }
      ]
    }, null, 2)}\n`
  );
  await writeFile(
    join(repo, "reports", "races", "0001", "pick.md"),
    [
      "# Race 0001 pick",
      "",
      `The owner picked attempt b (race/0001-b, commit ${attemptCommit.slice(0, 7)}).`,
      "Picked by: owner",
      "Reason: minimal fix",
      `Main was at ${mainBefore.slice(0, 7)} before the merge.`,
      "",
      "The merged result verified green (exit 0). Main moves to the merge.",
      ""
    ].join("\n")
  );
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "race 0001: pick attempt b"]);
  const mergeCommit = git(repo, ["rev-parse", "HEAD"]).trim();

  const greenSummary = {
    number: 2,
    testedCommit: mergeCommit,
    outcome: "pass",
    flows: [{ name: "poll-create-once.md", outcome: "pass", reason: "passed", verdict: null, steps: 9, credits: 22.1, seconds: 48, trace: [] }],
    drift: { ok: true, skipped: false, problems: [] }
  };
  await writeFile(join(repo, "reports", "0002.json"), `${JSON.stringify(greenSummary, null, 2)}\n`);
  await writeFile(join(repo, "reports", "0002.md"), `# Why It Broke report 0002\n\nTested commit: ${mergeCommit}\n`);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "report: 0002"]);

  const data = await loadSite({ root: repo });
  assert.equal(data.red.number, 1);
  assert.equal(data.race.number, 1);
  assert.equal(data.green.number, 2);
  const html = renderSite(data);
  assert.match(html, /Picked by: owner/);
  assert.match(html, /minimal fix/);
  assert.match(html, new RegExp(`commit/${attemptCommit.slice(0, 7)}`));
  assert.doesNotMatch(html, /commit\/1111111/);
  assert.match(html, /0002/);
  assert.doesNotMatch(html, /No green run after a pick yet\./);
});

test("picked race by runner shows runner pick, missing Picked by shows not recorded, and missing green report never guesses", async () => {
  const { repo } = await makeRepo();
  const red = await addRedReport(repo, { number: 1 });
  await mkdir(join(repo, "reports", "races", "0001"), { recursive: true });
  await writeFile(join(repo, "reports", "races", "0001", "comparison.md"), "# Race 0001 comparison\n\nThe red report is 0001.\n");
  await writeFile(
    join(repo, "reports", "races", "0001", "attempts.json"),
    `${JSON.stringify({ number: 1, base: red.reportCommit, tested: red.tested, attempts: [] })}\n`
  );
  await writeFile(
    join(repo, "reports", "races", "0001", "pick.md"),
    [
      "# Race 0001 pick",
      "",
      "The runner picked attempt a (race/0001-a, commit abcdef1).",
      "Picked by: runner (the only attempt that passed Kane's verify)",
      "Reason: the only attempt that passed Kane's verify",
      `Main was at ${red.reportCommit.slice(0, 7)} before the merge.`,
      ""
    ].join("\n")
  );
  // Add an unrelated green report on main (not testing the merge commit) to prove loadSite never guesses.
  await writeFile(
    join(repo, "reports", "0002.json"),
    `${JSON.stringify({ number: 2, testedCommit: red.tested, outcome: "pass", flows: [{ name: "poll-create-once.md", outcome: "pass", reason: "passed", verdict: null, steps: 5, credits: 10, seconds: 20, trace: [] }], drift: { ok: true, skipped: false, problems: [] } })}\n`
  );
  await writeFile(join(repo, "reports", "0002.md"), `# report 0002\n\nTested commit: ${red.tested}\n`);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "runner pick without matching merge report"]);

  const data1 = await loadSite({ root: repo });
  assert.equal(data1.green, null);
  const html1 = renderSite(data1);
  assert.match(html1, /Picked by: runner \(the only attempt that passed Kane's verify\)/);
  assert.match(html1, /No green run after a pick yet\./);

  // Overwrite pick.md without a Picked by: line.
  await writeFile(
    join(repo, "reports", "races", "0001", "pick.md"),
    [
      "# Race 0001 pick",
      "",
      "The owner picked attempt a (race/0001-a, commit abcdef1).",
      "Reason: legacy pick",
      `Main was at ${red.reportCommit.slice(0, 7)} before the merge.`,
      ""
    ].join("\n")
  );
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "legacy pick without Picked by line"]);
  const html2 = renderSite(await loadSite({ root: repo }));
  assert.match(html2, /Picked by: not recorded/);
});

test("failed race with null commit and null flows renders not verified and No attempt passed", async () => {
  const { repo } = await makeRepo();
  const red = await addRedReport(repo, { number: 1 });
  await mkdir(join(repo, "reports", "races", "0001"), { recursive: true });
  await writeFile(join(repo, "reports", "races", "0001", "comparison.md"), "# Race 0001 comparison\n\nThe red report is 0001.\n");
  await writeFile(
    join(repo, "reports", "races", "0001", "attempts.json"),
    `${JSON.stringify({
      number: 1,
      base: red.reportCommit,
      tested: red.tested,
      attempts: [
        { letter: "a", branch: "race/0001-a", commit: null, status: "no commit", reason: "the racer exited 0 without a commit", files: 0, insertions: 0, deletions: 0, explanationsChanged: 0, flows: null, drift: null }
      ]
    })}\n`
  );
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "race 0001: no attempt is green"]);

  const html = renderSite(await loadSite({ root: repo }));
  assert.match(html, /No attempt passed\. No code was merged\./);
  assert.match(html, /Not picked: no attempt passed\./);
  assert.match(html, /Not reached\./);
  assert.match(html, /not verified/);
});

test("building site on this repo is byte-identical across runs and contains no secrets, emails, or home paths", async () => {
  const out1 = await mkdtemp(join(tmpdir(), "wib-site-out1-"));
  const out2 = await mkdtemp(join(tmpdir(), "wib-site-out2-"));
  temps.push(out1, out2);
  await buildSite({ root: ROOT, outDir: out1 });
  await buildSite({ root: ROOT, outDir: out2 });
  const html1 = await readFile(join(out1, "index.html"), "utf8");
  const html2 = await readFile(join(out2, "index.html"), "utf8");
  assert.equal(html1, html2);
  assert.doesNotMatch(html1, /<script\b/i);
  assert.doesNotMatch(html1, /\/home\//);
  assert.doesNotMatch(html1, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  assert.deepEqual(scanSecrets(html1), []);
  for (let i = 1; i <= 8; i += 1) {
    const pad = String(i).padStart(4, "0");
    assert.match(html1, new RegExp(`reports/${pad}\\.md`));
  }
  assert.match(html1, /No red run yet\./);
  assert.match(html1, /No race has reached main yet\./);
});

function writeZip(zipPath, entries) {
  const script = `
import json, sys, zipfile
out = sys.argv[1]
items = json.loads(sys.argv[2])
with zipfile.ZipFile(out, "w") as zf:
    for name, body in items.items():
        zf.writestr(name, body)
`;
  execFileSync("python3", ["-c", script, zipPath, JSON.stringify(entries)]);
}

async function setupFeaturedFixture(greenSteps) {
  const dir = await mkdtemp(join(tmpdir(), "wib-featured-"));
  temps.push(dir);
  const home = join(dir, "home");
  const repo = join(dir, "repo");
  const sessionEv = join(home, ".testmuai", "kaneai", "sessions", "sess-1", "evidence");
  await mkdir(sessionEv, { recursive: true });
  await mkdir(join(repo, "reports", "evidence", "0001", "poll-create-once"), { recursive: true });
  await mkdir(join(repo, "reports", "evidence", "0002", "poll-create-once"), { recursive: true });
  await writeFile(
    join(repo, "reports", "0001.json"),
    `${JSON.stringify({ number: 1, testedCommit: "a".repeat(40), outcome: "fail", flows: [{ name: "poll-create-once.md", outcome: "fail" }], drift: { ok: true, problems: [] } })}\n`
  );
  await writeFile(
    join(repo, "reports", "evidence", "0001", "poll-create-once", "run.yaml"),
    "evidence: '0.1'\nrun_id: red-run-1\n"
  );
  await writeFile(
    join(repo, "reports", "evidence", "0001", "poll-create-once", "failure.yaml"),
    [
      "failures:",
      "  - test: t1",
      "    ordinal: 7",
      "    step: 0-7",
      "    status: failed",
      "    path: tests/t1/steps/7-0-7/failure.yaml",
      "    title: Create poll submits twice",
      ""
    ].join("\n")
  );
  await writeFile(
    join(repo, "reports", "evidence", "0002", "poll-create-once", "run.yaml"),
    "evidence: '0.1'\nrun_id: green-run-2\n"
  );
  writeZip(join(sessionEv, "red-run-1.evidence"), {
    "tests/t1/steps/7-0-7/step.json": JSON.stringify({ summary: "click: Clicking Create poll button", ordinal: 7 }),
    "tests/t1/steps/7-0-7/screenshot.jpg": "RED-JPG",
    "tests/t1/steps/7-0-7/annotated.png": "RED-PNG"
  });
  writeZip(join(sessionEv, "green-run-2.evidence"), greenSteps);
  return { dir, home, repo };
}

test("site:featured copies red and matching green step by summary (never step number) and writes matches.txt", async () => {
  const { home, repo } = await setupFeaturedFixture({
    "tests/t2/steps/3-0-3/step.json": JSON.stringify({ summary: "click: Clicking Create poll button", ordinal: 3 }),
    "tests/t2/steps/3-0-3/screenshot.jpg": "GREEN-JPG",
    "tests/t2/steps/7-0-7/step.json": JSON.stringify({ summary: "assert: Other step at same number", ordinal: 7 }),
    "tests/t2/steps/7-0-7/screenshot.jpg": "WRONG-STEP"
  });
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const logs = [];
    const res = await extractFeatured({ root: repo, redNumber: "0001", greenNumber: "0002", log: (l) => logs.push(l) });
    assert.equal(res.red.copied.length, 2);
    assert.equal(res.green.copied.length, 1);
    assert.equal(await readFile(join(home, ".why-it-broke", "featured", "0001", "screenshot.jpg"), "utf8"), "RED-JPG");
    assert.equal(await readFile(join(home, ".why-it-broke", "featured", "0001", "annotated.png"), "utf8"), "RED-PNG");
    assert.equal(await readFile(join(home, ".why-it-broke", "featured", "0002", "screenshot.jpg"), "utf8"), "GREEN-JPG");
    const greenMatches = await readFile(join(home, ".why-it-broke", "featured", "0002", "matches.txt"), "utf8");
    assert.match(greenMatches, /click: Clicking Create poll button/);
    assert.match(greenMatches, /3-0-3/);
    assert.doesNotMatch(greenMatches, /\/home\//);
    assert.equal(existsSync(join(repo, "reports", "featured")), false);
  } finally {
    process.env.HOME = prevHome;
  }
});

test("site:featured copies nothing for green when summary matches zero steps or two steps", async () => {
  const zero = await setupFeaturedFixture({
    "tests/t2/steps/3-0-3/step.json": JSON.stringify({ summary: "click: Different button", ordinal: 3 }),
    "tests/t2/steps/3-0-3/screenshot.jpg": "OTHER"
  });
  const two = await setupFeaturedFixture({
    "tests/t2/steps/3-0-3/step.json": JSON.stringify({ summary: "click: Clicking Create poll button", ordinal: 3 }),
    "tests/t2/steps/3-0-3/screenshot.jpg": "FIRST",
    "tests/t2/steps/5-0-5/step.json": JSON.stringify({ summary: "click: Clicking Create poll button", ordinal: 5 }),
    "tests/t2/steps/5-0-5/screenshot.jpg": "SECOND"
  });
  const prevHome = process.env.HOME;
  try {
    process.env.HOME = zero.home;
    const logsZero = [];
    const resZero = await extractFeatured({ root: zero.repo, redNumber: "0001", greenNumber: "0002", log: (l) => logsZero.push(l) });
    assert.equal(resZero.green.copied.length, 0);
    assert.equal(existsSync(join(zero.home, ".why-it-broke", "featured", "0002", "screenshot.jpg")), false);
    assert.match(await readFile(join(zero.home, ".why-it-broke", "featured", "0002", "matches.txt"), "utf8"), /0 matches/i);

    process.env.HOME = two.home;
    const logsTwo = [];
    const resTwo = await extractFeatured({ root: two.repo, redNumber: "0001", greenNumber: "0002", log: (l) => logsTwo.push(l) });
    assert.equal(resTwo.green.copied.length, 0);
    assert.equal(existsSync(join(two.home, ".why-it-broke", "featured", "0002", "screenshot.jpg")), false);
    assert.match(await readFile(join(two.home, ".why-it-broke", "featured", "0002", "matches.txt"), "utf8"), /2 matches/i);
  } finally {
    process.env.HOME = prevHome;
  }
});

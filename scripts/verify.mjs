import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { APP_BOOT_TIMEOUT_MS, CREDIT_FLOOR, FLOWS, KANE_BIN, ROOT, STOP_TIMEOUT_MS, TUNNEL_MODE } from "./config.mjs";
import { checkDrift } from "./drift.mjs";
import { describeExit, freePort, startApp, stopApp, waitForApp } from "./lib/app-process.mjs";
import { getBalance } from "./lib/balance.mjs";
import { countKey, readRun } from "./lib/coverage.mjs";
import { readExplanations } from "./lib/explanations.mjs";
import { functionKey, scanApp } from "./lib/functions.mjs";
import { git, gitConfig } from "./lib/git.mjs";
import { sha256File } from "./lib/hash.mjs";
import { classifyRun, runKane } from "./lib/kane.mjs";
import { padNumber, renderReport } from "./lib/report.mjs";

const COAUTHOR = "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>";

// Exit codes: 0 all flows pass and drift passes; 1 a flow fails or drift fails;
// 2 an error (refused run, app did not start, no run_end, missing coverage).
export async function runVerify({
  root = ROOT,
  kaneBin = KANE_BIN,
  kaneEnv = {},
  pickPort = freePort,
  stopTimeoutMs = STOP_TIMEOUT_MS,
  log = () => {}
} = {}) {
  if ((await git(root, ["status", "--porcelain"])).trim() !== "") {
    log("refused: the tree has uncommitted changes. Verify runs on a commit.");
    return 2;
  }
  if (!(await gitConfig(root, "user.name")) || !(await gitConfig(root, "user.email"))) {
    log("refused: git user.name or user.email is not set. The owner sets them.");
    return 2;
  }
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  const appDir = await realpath(join(root, "app"));
  const functions = await scanApp(appDir);
  const explanations = await readExplanations(join(root, "explain", "functions.json"));
  if (!(await flowsApproved(root, log))) return 2;
  const env = { ...process.env, ...kaneEnv };
  const balance = await getBalance({ kaneBin, env });
  if (balance < CREDIT_FLOOR) {
    log(`refused: ${balance} Kane credits left, below the ${CREDIT_FLOOR} floor.`);
    return 2;
  }
  const number = await nextReportNumber(join(root, "reports"));
  const flows = [];
  for (const name of FLOWS) {
    const flow = await runFlow({ root, appDir, name, kaneBin, env, functions, pickPort, stopTimeoutMs });
    log(`${flow.name}: ${flow.outcome}, ${flow.reason}`);
    flows.push(flow);
  }
  const complete = flows.every((flow) => flow.outcome !== "error");
  const drift = checkDrift({
    functions,
    explanations,
    ranByFlow: complete ? buildRanByFlow(functions, flows) : undefined
  });
  const markdown = renderReport({
    number,
    head,
    flows,
    drift,
    driftNote: complete ? null : "The ran-in-no-flow check was skipped because a flow errored.",
    functions,
    explanations
  });
  await commitReport({ root, number, head, markdown });
  log(`drift: ${drift.ok ? "passed" : `failed, ${drift.problems.length} problem(s)`}`);
  log(`report: reports/${padNumber(number)}.md committed`);
  return exitCodeFor(flows, drift);
}

async function flowsApproved(root, log) {
  const approvals = await readApprovals(join(root, "flows", "approvals.json"));
  for (const name of FLOWS) {
    const hash = await sha256File(join(root, "flows", `${name}.md`));
    if (approvals[`${name}.md`] !== hash) {
      log(`refused: flows/${name}.md is not approved at its current hash. The owner runs npm run flows:approve.`);
      return false;
    }
  }
  return true;
}

async function runFlow(options) {
  const started = Date.now();
  const dataDir = await mkdtemp(join(tmpdir(), "wib-data-"));
  const coverageDir = await mkdtemp(join(tmpdir(), "wib-coverage-"));
  try {
    const outcome = await exerciseFlow({ ...options, dataDir, coverageDir });
    return { name: `${options.name}.md`, seconds: elapsedSeconds(started), ...outcome };
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(coverageDir, { recursive: true, force: true });
  }
}

async function exerciseFlow({ root, appDir, name, kaneBin, env, functions, pickPort, stopTimeoutMs, dataDir, coverageDir }) {
  const port = await pickPort();
  const app = startApp({
    serverFile: join(appDir, "server.mjs"),
    cwd: root,
    port,
    dataFile: join(dataDir, "polls.json"),
    coverageDir
  });
  const boot = await waitForApp(app, APP_BOOT_TIMEOUT_MS);
  if (!boot.ok) {
    await stopApp(app, stopTimeoutMs);
    return flowResult({ outcome: "error", reason: `app failed to start: ${boot.detail}` });
  }
  let kane = null;
  let first;
  try {
    kane = await runKane({ kaneBin, env, flowFile: join(root, "flows", `${name}.md`), url: kaneUrl(port) });
    first = classifyRun(kane);
  } catch (error) {
    first = { outcome: "error", reason: `kane-cli did not finish: ${error.message}` };
  }
  let { outcome, reason } = first;
  const stop = await stopApp(app, stopTimeoutMs);
  let counts = null;
  if (stop.code !== 0 || stop.signal !== null) {
    outcome = "error";
    reason = joinReasons(reason, `app did not stop cleanly (${describeExit(stop)}), so coverage was not written`);
  } else {
    try {
      counts = await readRun(coverageDir, appDir);
      const unmapped = functions.find((fn) => !counts.has(countKey(fn.file, fn.startOffset)));
      if (unmapped) throw new Error(`coverage has no entry for ${unmapped.file}:${unmapped.line}`);
    } catch (error) {
      counts = null;
      outcome = "error";
      reason = joinReasons(reason, error.message);
    }
  }
  return flowResult({ outcome, reason, kane, counts });
}

function flowResult({ outcome, reason, kane = null, counts = null }) {
  return {
    outcome,
    reason,
    verdict: kane?.verdict ?? null,
    steps: kane?.steps.length ?? 0,
    credits: kane?.creditsConsumed ?? null,
    packPath: kane?.packPath ?? null,
    counts
  };
}

function kaneUrl(port) {
  if (TUNNEL_MODE !== "local") throw new Error(`TUNNEL_MODE ${TUNNEL_MODE} is not built`);
  return `http://localhost:${port}`;
}

function buildRanByFlow(functions, flows) {
  const ranByFlow = {};
  for (const fn of functions) {
    if (fn.name === null) continue;
    ranByFlow[functionKey(fn.file, fn.name)] = flows
      .filter((flow) => flow.counts.get(countKey(fn.file, fn.startOffset)) > 0)
      .map((flow) => flow.name);
  }
  return ranByFlow;
}

async function commitReport({ root, number, head, markdown }) {
  const relPath = `reports/${padNumber(number)}.md`;
  await mkdir(join(root, "reports"), { recursive: true });
  await writeFile(join(root, relPath), markdown, { flag: "wx" });
  await git(root, ["add", "--", relPath]);
  await git(root, [
    "commit",
    "-q",
    "-m", `report: ${padNumber(number)} verify of ${head.slice(0, 7)}`,
    "-m", `Tested commit: ${head}`,
    "-m", COAUTHOR
  ]);
}

function exitCodeFor(flows, drift) {
  if (flows.some((flow) => flow.outcome === "error")) return 2;
  if (flows.some((flow) => flow.outcome === "fail") || !drift.ok) return 1;
  return 0;
}

async function nextReportNumber(reportsDir) {
  let names;
  try {
    names = await readdir(reportsDir);
  } catch (error) {
    if (error.code === "ENOENT") return 1;
    throw error;
  }
  const numbers = names
    .map((name) => /^(\d{4})\.md$/.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

async function readApprovals(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function elapsedSeconds(started) {
  return Math.round((Date.now() - started) / 100) / 10;
}

function joinReasons(reason, extra) {
  return reason ? `${reason}; ${extra}` : extra;
}

const isMain = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  runVerify({ log: (line) => console.log(line) }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`verify: ${error.message}`);
      process.exitCode = 2;
    }
  );
}

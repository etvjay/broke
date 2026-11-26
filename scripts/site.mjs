import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ROOT } from "./config.mjs";
import { git } from "./lib/git.mjs";
import { padNumber } from "./lib/report.mjs";

export const DEFAULT_REPO_URL = "https://github.com/etvjay/broke";
const KANE_CLI_URL = "https://github.com/LambdaTest/kane-cli";

// Loads all report, evidence, race, and featured-image metadata strictly from committed HEAD.
export async function loadSite({ root = ROOT, repoUrl = DEFAULT_REPO_URL } = {}) {
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  const committed = await listCommittedReports(root);
  const reportNumbers = [];
  for (const path of committed) {
    const match = /^reports\/(\d{4})\.json$/.exec(path);
    if (match) reportNumbers.push(Number(match[1]));
  }
  reportNumbers.sort((a, b) => a - b);

  const races = await loadRaces(root, committed);
  const racesByRedPad = new Map();
  for (const race of races) {
    if (race.redReportPad) {
      const list = racesByRedPad.get(race.redReportPad) ?? [];
      list.push(race);
      racesByRedPad.set(race.redReportPad, list);
    }
  }

  const runs = [];
  for (const number of reportNumbers) {
    const pad = padNumber(number);
    const summary = JSON.parse(await gitShowText(root, `reports/${pad}.json`));
    const hasEvidence = [...committed].some((path) => path.startsWith(`reports/evidence/${pad}/`));
    const matchingRaces = racesByRedPad.get(pad) ?? [];
    const latestRace = matchingRaces.length > 0 ? matchingRaces.at(-1) : null;
    runs.push({
      number,
      pad,
      testedCommit: summary.testedCommit,
      outcome: summary.outcome,
      flows: summary.flows ?? [],
      drift: summary.drift ?? { ok: true, skipped: false, problems: [] },
      credits: totalCredits(summary.flows ?? []),
      hasEvidence,
      race: latestRace
        ? {
            number: latestRace.number,
            pad: latestRace.pad,
            status: latestRace.status,
            pickedBy: latestRace.pick?.pickedByLine ?? null,
            pickedLetter: latestRace.pick?.letter ?? null
          }
        : null
    });
  }

  const latest = runs.length > 0 ? runs.at(-1) : null;
  const redRun = [...runs].reverse().find((run) => run.flows.some((flow) => flow.outcome === "fail")) ?? null;
  const red = redRun ? await loadRedDetail(root, committed, redRun) : null;
  const redRaces = red ? (racesByRedPad.get(red.pad) ?? []) : [];
  const race = redRaces.length > 0 ? redRaces.at(-1) : null;
  const green = race?.pick ? await findGreenAfterPick(root, committed, runs, race.pick) : null;
  const loop = buildLoopSteps({ red, race, green, repoUrl });

  return { repoUrl, head, runs, latest, red, race, green, loop };
}

// Renders the complete static HTML document with inline CSS and no JavaScript.
export function renderSite(data) {
  const { repoUrl, runs, latest, red, race, green, loop } = data;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    "  <title>Why It Broke</title>",
    '  <meta name="description" content="Kane CLI runs this poll app in a real browser. When a run fails, this page shows why, and how the fix loop closed.">',
    '  <meta property="og:title" content="Why It Broke">',
    '  <meta property="og:description" content="Kane CLI runs this poll app in a real browser. When a run fails, this page shows why, and how the fix loop closed.">',
    '  <meta property="og:type" content="website">',
    '  <meta property="og:image" content="https://opengraph.githubassets.com/1/etvjay/broke">',
    '  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%274%27 fill=%27%23111827%27/%3E%3Ctext x=%2716%27 y=%2722%27 text-anchor=%27middle%27 font-family=%27monospace%27 font-size=%2718%27 font-weight=%27700%27 fill=%27%23ffffff%27%3EW%3C/text%3E%3C/svg%3E">',
    "  <style>",
    STYLES,
    "  </style>",
    "</head>",
    "<body>",
    '  <div class="page">',
    renderHeader(repoUrl),
    "    <main>",
    renderProblemAndSolution(),
    renderWhereKaneHelped({ red, race, green, repoUrl }),
    renderLatestStatus(latest, repoUrl),
    renderLoopSection(loop),
    renderRedSection(red, repoUrl),
    renderRaceSection(race, repoUrl),
    renderGreenSection(green, red, race, repoUrl),
    renderTestsAndProofs({ runs, red, race, green, repoUrl }),
    renderAllRunsSection(runs, repoUrl),
    "    </main>",
    renderFooter(repoUrl),
    "  </div>",
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

// Builds site/index.html (and copies any committed featured screenshots from HEAD).
export async function buildSite({ root = ROOT, outDir = join(root, "site"), repoUrl = DEFAULT_REPO_URL } = {}) {
  const data = await loadSite({ root, repoUrl });
  const html = renderSite(data);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "index.html"), html, "utf8");
  for (const featured of [data.red?.featuredImage, data.green?.featuredImage]) {
    if (!featured) continue;
    const dest = join(outDir, featured.sitePath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, await gitShowBuffer(root, featured.repoPath));
  }
  return { data, outDir };
}

async function listCommittedReports(root) {
  try {
    const out = await git(root, ["ls-tree", "-r", "--name-only", "HEAD", "--", "reports"]);
    return new Set(out.split("\n").map((line) => line.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function gitShowText(root, relPath) {
  return await git(root, ["show", `HEAD:${relPath}`]);
}

function gitShowBuffer(root, relPath) {
  return new Promise((resolvePromise, reject) => {
    execFile("git", ["-C", root, "show", `HEAD:${relPath}`], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git show failed for ${relPath}: ${stderr.toString("utf8").trim() || error.message}`));
      else resolvePromise(stdout);
    });
  });
}

async function gitParents(root, commit) {
  if (!commit) return [];
  try {
    const line = (await git(root, ["log", "-1", "--format=%P", commit])).trim();
    return line === "" ? [] : line.split(/\s+/);
  } catch {
    return [];
  }
}

async function loadRaces(root, committed) {
  const numbers = new Set();
  for (const path of committed) {
    const match = /^reports\/races\/(\d{4})\//.exec(path);
    if (match) numbers.add(Number(match[1]));
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const races = [];
  for (const number of sorted) {
    const pad = padNumber(number);
    const prefix = `reports/races/${pad}`;
    const comparisonPath = `${prefix}/comparison.md`;
    const attemptsPath = `${prefix}/attempts.json`;
    const pickPath = `${prefix}/pick.md`;
    const comparison = committed.has(comparisonPath) ? await gitShowText(root, comparisonPath) : "";
    const attemptsJson = committed.has(attemptsPath) ? JSON.parse(await gitShowText(root, attemptsPath)) : null;
    const pickText = committed.has(pickPath) ? await gitShowText(root, pickPath) : null;
    const redMatch = /The red report is (\d{4})\./.exec(comparison);
    const pick = pickText === null ? null : parsePick(pickText);
    races.push({
      number,
      pad,
      redReportPad: redMatch ? redMatch[1] : null,
      base: attemptsJson?.base ?? null,
      tested: attemptsJson?.tested ?? null,
      attempts: (attemptsJson?.attempts ?? []).map(normalizeAttempt),
      pick,
      status: pick ? "picked" : "no_green"
    });
  }
  return races;
}

function normalizeAttempt(attempt) {
  return {
    letter: attempt.letter,
    branch: attempt.branch ?? "",
    commit: attempt.commit ?? null,
    status: attempt.status ?? "unknown",
    reason: attempt.reason ?? "",
    files: attempt.files ?? 0,
    insertions: attempt.insertions ?? 0,
    deletions: attempt.deletions ?? 0,
    explanationsChanged: attempt.explanationsChanged ?? 0,
    flows: attempt.flows ?? null,
    drift: attempt.drift ?? null
  };
}

function parsePick(text) {
  const pickedMatch = /picked attempt ([a-c]) \(([^,]+), commit ([0-9a-f]+)\)\./i.exec(text);
  const pickedByMatch = /^Picked by:\s*(.+)$/m.exec(text);
  const reasonMatch = /^Reason:\s*(.+)$/m.exec(text);
  const mainBeforeMatch = /^Main was at ([0-9a-f]+) before the merge\.$/m.exec(text);
  const resultMatch = /^(The merged result .+)$/m.exec(text);
  return {
    letter: pickedMatch ? pickedMatch[1] : null,
    branch: pickedMatch ? pickedMatch[2] : null,
    commitShort: pickedMatch ? pickedMatch[3] : null,
    pickedByLine: pickedByMatch ? `Picked by: ${pickedByMatch[1].trim()}` : "Picked by: not recorded",
    reason: reasonMatch ? reasonMatch[1].trim() : "",
    mainBeforeShort: mainBeforeMatch ? mainBeforeMatch[1] : null,
    resultLine: resultMatch ? resultMatch[1].trim() : ""
  };
}

async function loadRedDetail(root, committed, run) {
  const mdPath = `reports/${run.pad}.md`;
  const markdown = committed.has(mdPath) ? await gitShowText(root, mdPath) : "";
  const sources = parseReportSources(markdown);
  const failingFlows = [];
  for (const flow of run.flows.filter((item) => item.outcome === "fail")) {
    const flowBase = flow.name.replace(/\.md$/, "");
    const evidencePrefix = `reports/evidence/${run.pad}/${flowBase}`;
    const failures = await loadFlowFailures(root, committed, evidencePrefix);
    const networkProof = await loadNetworkProof(root, committed, evidencePrefix);
    const evidenceLinks = collectEvidenceLinks(committed, evidencePrefix);
    const trace = (flow.trace ?? []).map((entry) => {
      const fnName = entry.name ?? "(anonymous)";
      const key = `${flow.name}::${entry.file}:${entry.line}::${fnName}`;
      const fallbackKey = `${entry.file}:${entry.line}::${fnName}`;
      return {
        ...entry,
        source: sources.byFlow.get(key) ?? sources.byLocation.get(fallbackKey) ?? null
      };
    });
    failingFlows.push({ ...flow, failures, networkProof, evidenceLinks, trace });
  }
  const featuredImage = findFeaturedImage(committed, run.pad, "red");
  return { ...run, failingFlows, featuredImage };
}

async function loadNetworkProof(root, committed, evidencePrefix) {
  const harPath = [...committed]
    .filter((path) => path.startsWith(`${evidencePrefix}/`) && path.endsWith("/0-network.har"))
    .sort()[0];
  if (!harPath) return null;
  try {
    const har = JSON.parse(await gitShowText(root, harPath));
    const entries = (har?.log?.entries ?? [])
      .map((entry) => {
        const url = String(entry?.request?.url ?? "");
        const method = String(entry?.request?.method ?? "");
        const status = entry?.response?.status ?? null;
        const started = entry?.startedDateTime ?? null;
        let pathname = url;
        try {
          pathname = new URL(url).pathname;
        } catch {
          pathname = url;
        }
        return { started, method, pathname, status };
      })
      .filter((item) => item.pathname.startsWith("/api/"));
    const posts = entries.filter((item) => item.method === "POST" && item.pathname === "/api/polls");
    let postDeltaMs = null;
    if (posts.length >= 2 && posts[0].started && posts[1].started) {
      const t0 = Date.parse(posts[0].started);
      const t1 = Date.parse(posts[1].started);
      if (Number.isFinite(t0) && Number.isFinite(t1)) {
        // Compute microsecond delta if ISO strings carry fractional seconds beyond ms.
        const us0 = parseIsoMicros(posts[0].started);
        const us1 = parseIsoMicros(posts[1].started);
        postDeltaMs = us0 !== null && us1 !== null ? (us1 - us0) / 1000 : t1 - t0;
      }
    }
    return { harPath, entries, postCount: posts.length, postDeltaMs };
  } catch {
    return null;
  }
}

function parseIsoMicros(iso) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(String(iso));
  if (!match) return null;
  const baseMs = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(baseMs)) return null;
  const frac = (match[2] ?? "").padEnd(6, "0").slice(0, 6);
  return baseMs * 1000 + Number(frac);
}

function collectEvidenceLinks(committed, evidencePrefix) {
  const paths = [...committed].filter((path) => path.startsWith(`${evidencePrefix}/`)).sort();
  const findEnding = (suffix) => paths.find((path) => path.endsWith(suffix)) ?? null;
  return {
    dir: paths.length > 0 ? evidencePrefix : null,
    failureYaml: committed.has(`${evidencePrefix}/failure.yaml`) ? `${evidencePrefix}/failure.yaml` : null,
    runYaml: committed.has(`${evidencePrefix}/run.yaml`) ? `${evidencePrefix}/run.yaml` : null,
    networkHar: findEnding("/0-network.har"),
    actionsNdjson: findEnding("/0-actions.ndjson"),
    dagDiagram: findEnding("/0-dag_diagram.md")
  };
}

async function loadFlowFailures(root, committed, evidencePrefix) {
  const rootFailurePath = `${evidencePrefix}/failure.yaml`;
  if (!committed.has(rootFailurePath)) return [];
  const rows = parseRootFailureYaml(await gitShowText(root, rootFailurePath));
  const results = [];
  for (const row of rows) {
    if (row.title) {
      results.push({ ...row, message: null, displayTitle: row.title });
      continue;
    }
    const stepRel = row.path ? `${evidencePrefix}/${row.path}` : null;
    if (stepRel && committed.has(stepRel)) {
      const stepMessage = parseStepFailureMessage(await gitShowText(root, stepRel));
      const label = row.step ? `Step ${row.step}` : "Failing step";
      results.push({
        ...row,
        message: stepMessage,
        displayTitle: stepMessage ? `${label}: ${stepMessage}` : `${label}: no message was recorded`
      });
    } else {
      const label = row.step ? `Step ${row.step}` : "Failing step";
      results.push({ ...row, message: null, displayTitle: `${label}: no message was recorded` });
    }
  }
  return results;
}

async function findGreenAfterPick(root, committed, runs, pick) {
  if (!pick.mainBeforeShort || !pick.commitShort) return null;
  for (const run of runs) {
    const parents = await gitParents(root, run.testedCommit);
    if (parents.length === 2 && parents[0].startsWith(pick.mainBeforeShort) && parents[1].startsWith(pick.commitShort)) {
      const networkProofs = {};
      for (const flow of run.flows) {
        const flowBase = flow.name.replace(/\.md$/, "");
        const proof = await loadNetworkProof(root, committed, `reports/evidence/${run.pad}/${flowBase}`);
        if (proof) networkProofs[flow.name] = proof;
      }
      return { ...run, networkProofs, featuredImage: findFeaturedImage(committed, run.pad, "green") };
    }
  }
  return null;
}

function findFeaturedImage(committed, pad, kind) {
  const pattern = new RegExp(`^reports/featured/${pad}/${kind}\\.(png|jpe?g|webp|gif)$`, "i");
  for (const path of committed) {
    if (pattern.test(path)) {
      return { repoPath: path, sitePath: `featured/${pad}-${kind}${extname(path).toLowerCase()}` };
    }
  }
  return null;
}

function buildLoopSteps({ red, race, green, repoUrl }) {
  const changeStep = red
    ? {
        name: "Change",
        role: "An app commit triggers Kane CLI across all approved browser flows.",
        chip: "PASS",
        html: `Commit ${commitLink(repoUrl, red.testedCommit)} tested in ${reportLink(repoUrl, red.pad)}.`
      }
    : {
        name: "Change",
        role: "An app commit triggers Kane CLI across all approved browser flows.",
        chip: "PENDING",
        html: "not yet."
      };

  const families = red
    ? [...new Set(red.failingFlows.map((flow) => flow.verdict?.family ?? "not reported"))]
    : [];
  const verdictStep = red
    ? {
        name: "Kane verdict",
        role: "Kane decides whether the app or the test is at fault, with root cause and culprit step.",
        chip: "FAIL",
        html: `${escapeHtml(families.join(", "))} in ${escapeHtml(red.failingFlows.map((flow) => flow.name).join(", "))}.`
      }
    : {
        name: "Kane verdict",
        role: "Kane decides whether the app or the test is at fault, with root cause and culprit step.",
        chip: "PENDING",
        html: "not yet."
      };

  let raceStep;
  if (race) {
    raceStep = {
      name: "Race",
      role: "Three coding agents try fixes in separate git worktrees; Kane verifies each attempt.",
      chip: race.status === "picked" ? "PASS" : "FAIL",
      html: `${raceLink(repoUrl, race.pad)} (${race.attempts.length} attempts recorded on main).`
    };
  } else {
    raceStep = {
      name: "Race",
      role: "Three coding agents try fixes in separate git worktrees; Kane verifies each attempt.",
      chip: "PENDING",
      html: "not yet."
    };
  }

  let pickStep;
  if (race?.pick) {
    pickStep = {
      name: "Pick",
      role: "One green fix merges automatically; two or three wait for the owner's recorded pick.",
      chip: "PASS",
      html: `Attempt ${escapeHtml(race.pick.letter ?? "?")} merged. ${escapeHtml(race.pick.pickedByLine)}.`
    };
  } else if (race) {
    pickStep = {
      name: "Pick",
      role: "One green fix merges automatically; two or three wait for the owner's recorded pick.",
      chip: "FAIL",
      html: "Not picked: no attempt passed."
    };
  } else {
    pickStep = {
      name: "Pick",
      role: "One green fix merges automatically; two or three wait for the owner's recorded pick.",
      chip: "PENDING",
      html: "not yet."
    };
  }

  let greenStep;
  if (green) {
    greenStep = {
      name: "Green main",
      role: "The merged commit must pass a full Kane verify rerun before main advances.",
      chip: green.outcome === "pass" ? "PASS" : "FAIL",
      html: `${reportLink(repoUrl, green.pad)} verified ${escapeHtml(green.outcome)} at merge ${commitLink(repoUrl, green.testedCommit)}.`
    };
  } else if (race && !race.pick) {
    greenStep = {
      name: "Green main",
      role: "The merged commit must pass a full Kane verify rerun before main advances.",
      chip: "FAIL",
      html: "Not reached."
    };
  } else {
    greenStep = {
      name: "Green main",
      role: "The merged commit must pass a full Kane verify rerun before main advances.",
      chip: "PENDING",
      html: "not yet."
    };
  }

  return [changeStep, verdictStep, raceStep, pickStep, greenStep];
}

// Extracts source code blocks from reports/NNNN.md without reading the working tree.
export function parseReportSources(markdown) {
  const byFlow = new Map();
  const byLocation = new Map();
  const lines = markdown.split(/\r?\n/);
  let currentFlow = null;
  let currentFn = null;
  let inDetails = false;
  let fence = null;
  let codeLines = [];

  for (const line of lines) {
    if (fence !== null) {
      if (line.trim() === fence) {
        const source = codeLines.join("\n");
        if (currentFn !== null) {
          byLocation.set(currentFn, source);
          if (currentFlow !== null) byFlow.set(`${currentFlow}::${currentFn}`, source);
        }
        fence = null;
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      continue;
    }

    const flowHeading = /^## ([^:]+): (?:pass|fail|error)$/.exec(line);
    if (flowHeading) {
      currentFlow = flowHeading[1].trim();
      currentFn = null;
      inDetails = false;
      continue;
    }
    if (line.startsWith("## ")) {
      currentFlow = null;
      currentFn = null;
      inDetails = false;
      continue;
    }
    const fnHeading = /^### ([^:\s]+:\d+) (.+)$/.exec(line);
    if (fnHeading) {
      currentFn = `${fnHeading[1]}::${fnHeading[2].trim()}`;
      inDetails = false;
      continue;
    }
    if (line.trim() === "<details>") {
      inDetails = true;
      continue;
    }
    if (line.trim() === "</details>") {
      inDetails = false;
      continue;
    }
    if (inDetails && currentFn !== null) {
      const fenceMatch = /^(`{3,})\w*$/.exec(line.trim());
      if (fenceMatch) {
        fence = fenceMatch[1];
        codeLines = [];
      }
    }
  }
  return { byFlow, byLocation };
}

// Parses the top-level failures list from Kane's root failure.yaml.
export function parseRootFailureYaml(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const rows = [];
  let inFailures = false;
  let current = null;
  let lastKey = null;

  for (const rawLine of lines) {
    if (!inFailures) {
      if (/^failures:\s*\[\s*\]/.test(rawLine.trim())) return [];
      if (/^failures:\s*$/.test(rawLine.trim())) inFailures = true;
      continue;
    }
    if (rawLine.trim() === "") continue;
    if (!/^\s/.test(rawLine)) break;

    const itemMatch = /^\s+-\s+([A-Za-z0-9_]+):(.*)$/.exec(rawLine);
    if (itemMatch) {
      if (current) rows.push(finalizeRow(current));
      current = {};
      lastKey = itemMatch[1];
      current[lastKey] = itemMatch[2].trim();
      continue;
    }
    const fieldMatch = /^\s+([A-Za-z0-9_]+):(.*)$/.exec(rawLine);
    if (fieldMatch && current) {
      lastKey = fieldMatch[1];
      current[lastKey] = fieldMatch[2].trim();
      continue;
    }
    if (current && lastKey) {
      current[lastKey] = `${current[lastKey]} ${rawLine.trim()}`.trim();
    }
  }
  if (current) rows.push(finalizeRow(current));
  return rows;
}

function finalizeRow(raw) {
  return {
    test: unquoteYaml(raw.test),
    ordinal: raw.ordinal ? Number(unquoteYaml(raw.ordinal)) : null,
    step: unquoteYaml(raw.step),
    status: unquoteYaml(raw.status),
    path: unquoteYaml(raw.path),
    title: unquoteYaml(raw.title)
  };
}

// Extracts error.message, or expected/actual values, from a step's failure.yaml.
export function parseStepFailureMessage(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  let inError = false;
  let errorIndent = 0;
  let currentKey = null;
  let keyIndent = 0;
  const fields = {};

  for (const rawLine of lines) {
    if (rawLine.trim() === "") continue;
    const indent = rawLine.match(/^ */)[0].length;
    if (!inError) {
      if (/^error:\s*$/.test(rawLine.trim())) {
        inError = true;
        errorIndent = indent;
      }
      continue;
    }
    if (indent <= errorIndent) break;
    const fieldMatch = /^ +([A-Za-z0-9_]+):(.*)$/.exec(rawLine);
    if (fieldMatch && (currentKey === null || indent <= keyIndent)) {
      currentKey = fieldMatch[1];
      keyIndent = indent;
      const val = fieldMatch[2].trim();
      fields[currentKey] = val === "|" || val === ">" || val === "|-" || val === ">-" ? "" : val;
      continue;
    }
    if (currentKey !== null) {
      fields[currentKey] = fields[currentKey] ? `${fields[currentKey]} ${rawLine.trim()}` : rawLine.trim();
    }
  }
  const message = unquoteYaml(fields.message);
  if (message) return message;
  const expected = unquoteYaml(fields.expected);
  const actual = unquoteYaml(fields.actual);
  if (expected !== null || actual !== null) {
    return `expected ${expected ?? "not recorded"}, actual ${actual ?? "not recorded"}`;
  }
  return null;
}

function unquoteYaml(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "~") return null;
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\n", " ");
  }
  return trimmed;
}

function totalCredits(flows) {
  const nums = flows.map((flow) => flow.credits).filter((value) => typeof value === "number");
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0);
}

function renderHeader(repoUrl) {
  return [
    '    <header class="site-header">',
    '      <div class="masthead-bar">',
    "        <h1>Why It Broke</h1>",
    '        <nav class="header-links" aria-label="Project links">',
    `          <a href="${escapeAttr(repoUrl)}">Repository</a>`,
    `          <a href="${escapeAttr(`${repoUrl}/blob/main/README.md`)}">README</a>`,
    `          <a href="${escapeAttr(KANE_CLI_URL)}">Kane CLI</a>`,
    "        </nav>",
    "      </div>",
    '      <p class="lead">Kane CLI runs this poll app in a real browser. When a run fails, this page shows why it broke, where Kane diagnosed and gated the fix, and the committed network and code proofs that closed the loop.</p>',
    '      <nav class="section-nav" aria-label="Page sections">',
    '        <a href="#problem-solution">Problem &amp; Solution</a>',
    '        <a href="#where-kane-helped">Where Kane Helped</a>',
    '        <a href="#the-loop">The Loop</a>',
    '        <a href="#red-run">Why It Broke &amp; Traces</a>',
    '        <a href="#the-race">Fix Race</a>',
    '        <a href="#green-run">Before / After Proof</a>',
    '        <a href="#tests-and-proofs">Tests</a>',
    '        <a href="#all-runs">All Runs</a>',
    "      </nav>",
    "    </header>"
  ].join("\n");
}

function renderProblemAndSolution() {
  return [
    '      <section id="problem-solution">',
    "        <h2>Problem definition &amp; solution</h2>",
    '        <div class="two-col">',
    '          <div class="doc-panel">',
    "            <h3>The problem</h3>",
    "            <p>AI coding agents write features and unit tests quickly, pass <code>npm test</code>, and still ship real browser defects: double-click duplicate submissions, DOM/HTTP race conditions, and stale explanations. Worse, when a browser check fails without structured fault attribution, an agent asked to make CI green can weaken the test instead of fixing the app.</p>",
    "          </div>",
    '          <div class="doc-panel">',
    "            <h3>The solution</h3>",
    "            <p><strong>Why It Broke</strong> puts Kane CLI in charge as an independent browser judge. Every commit boots a fresh poll app, executes owner-approved plain-English flows in Chromium, collects V8 function coverage and source-hashed explanations, and allows a 3-agent worktree fix race only when Kane attributes the failure to an <code>application_issue</code>. No fix reaches <code>main</code> until Kane passes it again.</p>",
    "          </div>",
    "        </div>",
    '        <div class="pillars">',
    '          <div class="pillar">',
    "            <h3>1. Browser verdict</h3>",
    "            <p>Kane CLI runs owner-approved plain-text flows in a real browser, separating app defects from test issues with a confidence score, root cause, culprit step, and redacted HAR/action logs.</p>",
    "          </div>",
    '          <div class="pillar">',
    "            <h3>2. Explained code trace</h3>",
    "            <p>Every app function carries a SHA-256 source-hashed explanation. Reports pair Kane's verdict with the exact V8-traced functions that ran on the failing path and flag stale docs via drift checks.</p>",
    "          </div>",
    '          <div class="pillar">',
    "            <h3>3. Gated 3-agent fix race</h3>",
    "            <p>When Kane blames the app, three Factory Droid agents each attempt a fix in isolated git worktrees using Kane's verdict in their brief. Kane verifies every attempt; only a verified winner merges.</p>",
    "          </div>",
    "        </div>",
    "      </section>"
  ].join("\n");
}

function renderWhereKaneHelped({ red, race, green, repoUrl }) {
  const failingFlow = red?.failingFlows?.[0] ?? null;
  const verdict = failingFlow?.verdict ?? null;
  const redNet = failingFlow?.networkProof ?? null;
  const greenNet = failingFlow && green?.networkProofs ? green.networkProofs[failingFlow.name] ?? null : null;
  const deltaText =
    redNet?.postDeltaMs !== null && redNet?.postDeltaMs !== undefined
      ? ` (${redNet.postDeltaMs.toFixed(2)} ms apart)`
      : "";

  const oneLiner = String(verdict?.one_liner ?? failingFlow?.reason ?? "flow failed").replace(/\.+$/, "");
  const suggestion = String(verdict?.suggestion ?? "not reported").replace(/\.+$/, "");

  const detectDetail = red && failingFlow
    ? `All unit tests passed on commit ${commitLink(repoUrl, red.testedCommit)}, yet Kane's real-browser run of <span class="mono">${escapeHtml(failingFlow.name)}</span> in report ${reportLink(repoUrl, red.pad)} caught the defect: ${escapeHtml(oneLiner)}.`
    : "Kane CLI executes plain-English browser flows against a fresh poll app so real interaction defects are caught even when unit tests pass.";

  const triageDetail = red && verdict
    ? `Kane classified the failure as <span class="mono">${escapeHtml(verdict.family ?? "unknown")}</span> / <span class="mono">${escapeHtml(verdict.category ?? "unknown")}</span> (confidence <span class="mono">${escapeHtml(String(verdict.confidence ?? "n/a"))}</span>, culprit step <span class="mono">${escapeHtml(verdict.culprit_step ?? "n/a")}</span>), ruled out test/agent fault, ${redNet ? `logged <span class="mono">${redNet.postCount}x POST /api/polls</span>${escapeHtml(deltaText)} in the HAR, ` : ""}and suggested: "${escapeHtml(suggestion)}."`
    : "Kane returns a structured verdict distinguishing app bugs from test faults, including culprit step, network signals, and a suggested fix.";

  const raceDetail = race
    ? `Kane's verdict and the ${failingFlow ? `${failingFlow.trace.length}-function ` : ""}V8 execution trace were written into <a href="${escapeAttr(`${repoUrl}/blob/main/reports/races/${race.pad}/brief.md`)}">brief.md</a> for ${raceLink(repoUrl, race.pad)}. ${race.attempts.length} isolated Droid racers submitted independent fixes and Kane verified all four flows on every attempt (${race.attempts.filter((a) => a.status === "green").length}/${race.attempts.length} green).`
    : "When Kane names an app fault, its verdict feeds directly into the shared racer brief for three isolated worktree fix attempts.";

  const solveDetail = green && race?.pick
    ? `After the owner picked attempt <span class="mono">${escapeHtml(race.pick.letter ?? "?")}</span> (${commitLink(repoUrl, race.pick.commitShort ?? "")}), Kane re-verified the merge commit ${commitLink(repoUrl, green.testedCommit)} in report ${reportLink(repoUrl, green.pad)} (${green.flows.length}/${green.flows.length} flows pass, drift pass${redNet && greenNet ? `, HAR proof reduced from <span class="mono">${redNet.postCount}x</span> to <span class="mono">${greenNet.postCount}x POST /api/polls</span>` : ""}) before <span class="mono">main</span> advanced.`
    : "No candidate fix advances main until Kane runs a full post-merge verification pass across every approved flow.";

  return [
    '      <section id="where-kane-helped">',
    "        <h2>Where Kane CLI helped &amp; solved the issue</h2>",
    "        <p>Kane CLI is not a passive test runner here. It acts as the detector, root-cause triager, racer brief author, and final merge gate across the full repair cycle:</p>",
    '        <ol class="kane-roles">',
    `          <li><strong>1. Caught what unit tests missed</strong><span>${detectDetail}</span></li>`,
    `          <li><strong>2. Triaged root cause &amp; ruled out test fault</strong><span>${triageDetail}</span></li>`,
    `          <li><strong>3. Drove &amp; judged the 3-agent fix race</strong><span>${raceDetail}</span></li>`,
    `          <li><strong>4. Proved the fix before advancing main</strong><span>${solveDetail}</span></li>`,
    "        </ol>",
    "      </section>"
  ].join("\n");
}

function renderLatestStatus(latest, repoUrl) {
  if (!latest) {
    return [
      '      <section id="latest-status">',
      "        <h2>Latest status</h2>",
      '        <p class="empty">No verify report is committed on main yet.</p>',
      "      </section>"
    ].join("\n");
  }
  const flowItems = latest.flows
    .map((flow) => `          <li>${chipForOutcome(flow.outcome)} <span class="mono">${escapeHtml(flow.name)}</span></li>`)
    .join("\n");
  const driftChip = latest.drift.ok ? renderChip("PASS") : renderChip("FAIL");
  return [
    '      <section id="latest-status">',
    "        <h2>Latest status</h2>",
    '        <div class="status-band">',
    `          <p class="status-summary">Newest report: ${reportLink(repoUrl, latest.pad)} ${chipForOutcome(latest.outcome)} testing commit ${commitLink(repoUrl, latest.testedCommit)}. Drift: ${driftChip}.</p>`,
    '          <ul class="flow-list">',
    flowItems,
    "          </ul>",
    "        </div>",
    "      </section>"
  ].join("\n");
}

function renderLoopSection(loop) {
  const items = loop
    .map(
      (step, index) =>
        `          <li><div class="loop-step-head"><span class="step-index">${index + 1}.</span> <strong>${escapeHtml(step.name)}</strong> ${renderChip(step.chip)}</div><div class="step-body"><span class="step-role">${escapeHtml(step.role)}</span> <span class="step-detail">${step.html}</span></div></li>`
    )
    .join("\n");
  return [
    '      <section id="the-loop">',
    "        <h2>The loop</h2>",
    '        <ol class="loop-list">',
    items,
    "        </ol>",
    "      </section>"
  ].join("\n");
}

function renderRedSection(red, repoUrl) {
  if (!red) {
    return [
      '      <section id="red-run">',
      "        <h2>The red run</h2>",
      '        <p class="empty">No red run yet. The first red run appears here, with Kane\'s verdict and the functions that ran.</p>',
      "      </section>"
    ].join("\n");
  }
  const flowBlocks = red.failingFlows.map((flow) => renderFailingFlow(flow, repoUrl)).join("\n");
  const figure = red.featuredImage
    ? [
        '        <figure class="featured-shot">',
        `          <img src="${escapeAttr(red.featuredImage.sitePath)}" alt="Failing step screenshot from report ${escapeAttr(red.pad)}">`,
        `          <figcaption>Featured failing step from report ${escapeHtml(red.pad)}.</figcaption>`,
        "        </figure>"
      ].join("\n")
    : "";
  return [
    '      <section id="red-run">',
    "        <h2>The red run</h2>",
    `        <p>Report ${reportLink(repoUrl, red.pad)} ${renderChip("FAIL")} on commit ${commitLink(repoUrl, red.testedCommit)}. Drift: ${red.drift.ok ? renderChip("PASS") : renderChip("FAIL")}.</p>`,
    flowBlocks,
    figure,
    "      </section>"
  ]
    .filter(Boolean)
    .join("\n");
}

function renderFailingFlow(flow, repoUrl) {
  const failureItems =
    flow.failures.length > 0
      ? flow.failures.map((item) => `            <li>${escapeHtml(item.displayTitle)}</li>`).join("\n")
      : `            <li>${escapeHtml(flow.reason || "No failure message recorded.")}</li>`;

  const verdict = flow.verdict ?? {};
  const verdictRows = [
    ...(verdict.bug_title ? [["Bug title", verdict.bug_title]] : []),
    ["Family", verdict.family],
    ["Category", verdict.category],
    ...(verdict.severity ? [["Severity", verdict.severity]] : []),
    ["Root cause", verdict.root_cause],
    ["Suggestion", verdict.suggestion],
    ...(verdict.agent_fault_assessment ? [["Fault assessment", verdict.agent_fault_assessment]] : []),
    ["Confidence", verdict.confidence],
    ["Culprit step", verdict.culprit_step]
  ]
    .map(
      ([label, value]) =>
        `            <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value === undefined || value === null || value === "" ? "not reported" : String(value))}</dd></div>`
    )
    .join("\n");

  const signals = Array.isArray(verdict.signals) ? verdict.signals : [];
  const signalsBlock =
    signals.length > 0
      ? [
          "          <h4>Kane verdict signals</h4>",
          '          <ul class="signal-list">',
          ...signals.map(
            (sig) =>
              `            <li><span class="mono">step ${escapeHtml(sig.step ?? "?")}</span> <span class="sig-kind">[${escapeHtml(sig.kind ?? "signal")}]</span> ${escapeHtml(sig.excerpt ?? "")}</li>`
          ),
          "          </ul>"
        ].join("\n")
      : "";

  const net = flow.networkProof ?? null;
  const netRows = net && net.entries.length > 0
    ? net.entries
        .map(
          (e) =>
            `              <tr><td class="mono">${escapeHtml(e.started ?? "")}</td><td class="mono">${escapeHtml(e.method)}</td><td class="mono">${escapeHtml(e.pathname)}</td><td class="mono">${escapeHtml(e.status ?? "")}</td></tr>`
        )
        .join("\n")
    : "";
  const netBlock =
    net && net.entries.length > 0
      ? [
          "          <h4>Committed network HAR trace</h4>",
          `          <p class="proof-caption">Extracted from <a class="mono" href="${escapeAttr(`${repoUrl}/blob/main/${net.harPath}`)}">${escapeHtml(net.harPath)}</a>: <span class="mono">${net.postCount}x POST /api/polls</span>${net.postDeltaMs !== null ? ` (<span class="mono">${net.postDeltaMs.toFixed(2)} ms</span> between duplicate requests)` : ""}.</p>`,
          '          <div class="table-wrap">',
          "            <table>",
          "              <thead><tr><th>Timestamp (UTC)</th><th>Method</th><th>Endpoint</th><th>Status</th></tr></thead>",
          "              <tbody>",
          netRows,
          "              </tbody>",
          "            </table>",
          "          </div>"
        ].join("\n")
      : "";

  const ev = flow.evidenceLinks ?? {};
  const evParts = [
    ev.dir ? `<a href="${escapeAttr(`${repoUrl}/tree/main/${ev.dir}`)}">evidence folder</a>` : null,
    ev.failureYaml ? `<a href="${escapeAttr(`${repoUrl}/blob/main/${ev.failureYaml}`)}">failure.yaml</a>` : null,
    ev.networkHar ? `<a href="${escapeAttr(`${repoUrl}/blob/main/${ev.networkHar}`)}">0-network.har</a>` : null,
    ev.actionsNdjson ? `<a href="${escapeAttr(`${repoUrl}/blob/main/${ev.actionsNdjson}`)}">0-actions.ndjson</a>` : null,
    ev.dagDiagram ? `<a href="${escapeAttr(`${repoUrl}/blob/main/${ev.dagDiagram}`)}">0-dag_diagram.md</a>` : null
  ].filter(Boolean);
  const evBlock =
    evParts.length > 0
      ? `          <p class="evidence-bar"><strong>Committed proof artifacts:</strong> ${evParts.join(" · ")}</p>`
      : "";

  const traceBlocks =
    flow.trace.length === 0
      ? '          <p class="empty">No app function trace recorded for this flow.</p>'
      : flow.trace
          .map((fn) => {
            const label = `${fn.file}:${fn.line} ${fn.name ?? "(anonymous)"}`;
            const explanation = fn.explanation ?? "No explanation recorded.";
            const sourceHtml = fn.source
              ? [
                  "            <details>",
                  "              <summary>Source</summary>",
                  `              <pre><code>${escapeHtml(fn.source)}</code></pre>`,
                  "            </details>"
                ].join("\n")
              : "";
            return [
              '          <article class="trace-fn">',
              `            <h4><span class="mono">${escapeHtml(label)}</span> <span class="fn-status">[${escapeHtml(fn.status ?? "unknown")}]</span></h4>`,
              `            <p>${escapeHtml(explanation)}</p>`,
              sourceHtml,
              "          </article>"
            ]
              .filter(Boolean)
              .join("\n");
          })
          .join("\n");

  return [
    '        <div class="failing-flow">',
    `          <h3><span class="mono">${escapeHtml(flow.name)}</span> ${renderChip("FAIL")}</h3>`,
    '          <ul class="failure-titles">',
    failureItems,
    "          </ul>",
    '          <dl class="verdict-grid">',
    verdictRows,
    "          </dl>",
    signalsBlock,
    netBlock,
    evBlock,
    `          <h4>Functions that ran in this flow, in file order (${flow.trace.length})</h4>`,
    traceBlocks,
    "        </div>"
  ]
    .filter(Boolean)
    .join("\n");
}

function renderRaceSection(race, repoUrl) {
  if (!race) {
    return [
      '      <section id="the-race">',
      "        <h2>The race</h2>",
      '        <p class="empty">No race has reached main yet. A race appears here once it picks an attempt or when no attempt passes.</p>',
      '        <p class="empty">No pick on main yet.</p>',
      "      </section>"
    ].join("\n");
  }
  const pickedLetter = race.pick?.letter ?? null;
  const rows = race.attempts
    .map((attempt) => {
      const commitHtml =
        attempt.commit === null
          ? "none"
          : pickedLetter === attempt.letter
            ? commitLink(repoUrl, attempt.commit)
            : `<span class="mono">${escapeHtml(attempt.commit)}</span>`;
      const flowsText = formatAttemptFlows(attempt.flows);
      const driftText =
        attempt.drift === null
          ? "not verified"
          : attempt.drift.ok
            ? "passed"
            : `failed (${attempt.drift.problems} problem(s))`;
      const linesText = `+${attempt.insertions} -${attempt.deletions}`;
      const statusChip = attempt.status === "green" ? renderChip("PASS") : renderChip("FAIL");
      return [
        "            <tr>",
        `              <td class="mono">${escapeHtml(attempt.letter)}</td>`,
        `              <td>${commitHtml}</td>`,
        `              <td>${statusChip} ${escapeHtml(attempt.status)}${attempt.reason ? `: ${escapeHtml(attempt.reason)}` : ""}</td>`,
        `              <td>${escapeHtml(flowsText)}</td>`,
        `              <td>${escapeHtml(driftText)}</td>`,
        `              <td class="mono">${escapeHtml(linesText)}</td>`,
        "            </tr>"
      ].join("\n");
    })
    .join("\n");

  const outcomeBlock = race.pick
    ? [
        '        <div class="pick-box">',
        `          <p><strong>Picked attempt ${escapeHtml(race.pick.letter ?? "?")}.</strong> ${escapeHtml(race.pick.pickedByLine)}</p>`,
        race.pick.reason ? `          <p>Reason: ${escapeHtml(race.pick.reason)}</p>` : "",
        race.pick.resultLine ? `          <p>${escapeHtml(race.pick.resultLine)}</p>` : "",
        "        </div>"
      ]
        .filter(Boolean)
        .join("\n")
    : [
        '        <div class="pick-box">',
        "          <p><strong>No attempt passed. No code was merged.</strong></p>",
        "        </div>"
      ].join("\n");

  const raceDocs = [
    `<a href="${escapeAttr(`${repoUrl}/blob/main/reports/races/${race.pad}/brief.md`)}">brief.md</a>`,
    `<a href="${escapeAttr(`${repoUrl}/blob/main/reports/races/${race.pad}/comparison.md`)}">comparison.md</a>`,
    race.pick ? `<a href="${escapeAttr(`${repoUrl}/blob/main/reports/races/${race.pad}/pick.md`)}">pick.md</a>` : null,
    `<a href="${escapeAttr(`${repoUrl}/blob/main/reports/races/${race.pad}/attempts.json`)}">attempts.json</a>`
  ].filter(Boolean);

  return [
    '      <section id="the-race">',
    "        <h2>The race</h2>",
    `        <p>${raceLink(repoUrl, race.pad)} for red report ${escapeHtml(race.redReportPad ?? "unknown")}. Committed race artifacts: ${raceDocs.join(" · ")}.</p>`,
    '        <div class="table-wrap">',
    "          <table>",
    "            <thead>",
    "              <tr><th>Attempt</th><th>Commit</th><th>Status and reason</th><th>Verdict per flow</th><th>Drift</th><th>Lines changed</th></tr>",
    "            </thead>",
    "            <tbody>",
    rows || '              <tr><td colspan="6">No attempt rows recorded.</td></tr>',
    "            </tbody>",
    "          </table>",
    "        </div>",
    outcomeBlock,
    "      </section>"
  ].join("\n");
}

function renderGreenSection(green, red, race, repoUrl) {
  if (!green) {
    const extra = race && !race.pick ? " No attempt passed in the latest race, so no green merge exists." : "";
    return [
      '      <section id="green-run">',
      "        <h2>The green run after the pick</h2>",
      `        <p class="empty">No green run after a pick yet.${escapeHtml(extra)}</p>`,
      "      </section>"
    ].join("\n");
  }
  const flowItems = green.flows
    .map((flow) => `          <li>${chipForOutcome(flow.outcome)} <span class="mono">${escapeHtml(flow.name)}</span> (${escapeHtml(flow.reason ?? "")})</li>`)
    .join("\n");

  const failingFlow = red?.failingFlows?.[0] ?? null;
  const redNet = failingFlow?.networkProof ?? null;
  const greenNet = failingFlow && green.networkProofs ? green.networkProofs[failingFlow.name] ?? null : null;
  const compareBlock =
    redNet && greenNet
      ? [
          "        <h3>Before vs. after network HAR proof</h3>",
          '        <div class="table-wrap">',
          "          <table>",
          "            <thead><tr><th>Run</th><th>Flow outcome</th><th>POST /api/polls count</th><th>API sequence in committed HAR</th><th>Proof file</th></tr></thead>",
          "            <tbody>",
          `              <tr><td class="mono">Before (${reportLink(repoUrl, red.pad)})</td><td>${renderChip("FAIL")}</td><td class="mono">${redNet.postCount}x (201)${redNet.postDeltaMs !== null ? ` · ${redNet.postDeltaMs.toFixed(2)} ms apart` : ""}</td><td class="mono">${escapeHtml(redNet.entries.map((e) => `${e.method} ${e.pathname} -> ${e.status}`).join("; "))}</td><td><a href="${escapeAttr(`${repoUrl}/blob/main/${redNet.harPath}`)}">0-network.har</a></td></tr>`,
          `              <tr><td class="mono">After (${reportLink(repoUrl, green.pad)})</td><td>${renderChip("PASS")}</td><td class="mono">${greenNet.postCount}x (201)</td><td class="mono">${escapeHtml(greenNet.entries.map((e) => `${e.method} ${e.pathname} -> ${e.status}`).join("; "))}</td><td><a href="${escapeAttr(`${repoUrl}/blob/main/${greenNet.harPath}`)}">0-network.har</a></td></tr>`,
          "            </tbody>",
          "          </table>",
          "        </div>"
        ].join("\n")
      : "";

  const figure = green.featuredImage
    ? [
        '        <figure class="featured-shot">',
        `          <img src="${escapeAttr(green.featuredImage.sitePath)}" alt="Passing step screenshot from report ${escapeAttr(green.pad)}">`,
        `          <figcaption>Featured passing step from report ${escapeHtml(green.pad)}.</figcaption>`,
        "        </figure>"
      ].join("\n")
    : "";
  return [
    '      <section id="green-run">',
    "        <h2>The green run after the pick</h2>",
    `        <p>Report ${reportLink(repoUrl, green.pad)} ${chipForOutcome(green.outcome)} verified the pick merge commit ${commitLink(repoUrl, green.testedCommit)}. Drift: ${green.drift.ok ? renderChip("PASS") : renderChip("FAIL")}.</p>`,
    '        <ul class="flow-list">',
    flowItems,
    "        </ul>",
    compareBlock,
    figure,
    "      </section>"
  ]
    .filter(Boolean)
    .join("\n");
}

function renderTestsAndProofs({ runs, red, race, green, repoUrl }) {
  const latestFlows = runs.length > 0 ? runs.at(-1).flows.length : 4;
  return [
    '      <section id="tests-and-proofs">',
    "        <h2>Tests, flows &amp; verification layers</h2>",
    "        <p>Every change passes four independent verification layers so neither a silent browser bug nor a stale explanation can slip onto main.</p>",
    '        <div class="table-wrap">',
    "          <table>",
    "            <thead><tr><th>Layer</th><th>Command</th><th>What it verifies</th><th>Committed proof</th></tr></thead>",
    "            <tbody>",
    `              <tr><td><strong>Real-browser Kane flows</strong></td><td class="mono">npm run verify</td><td>${latestFlows} owner-approved plain-English flows in Chromium (<span class="mono">poll-create</span>, <span class="mono">poll-vote</span>, <span class="mono">poll-vote-once</span>, <span class="mono">poll-create-once</span>) with SHA-256 tamper protection in <span class="mono">flows/approvals.json</span>.</td><td><a href="${escapeAttr(`${repoUrl}/tree/main/flows`)}">flows/</a> · ${runs.length} reports</td></tr>`,
    `              <tr><td><strong>Unit &amp; harness tests</strong></td><td class="mono">npm test</td><td>166 Node tests across 16 suites covering poll store/API, drift checker, explain CLI, flow approvals, redaction, locks, Stop hook, race runner, verify runner, and deterministic site generation.</td><td><a href="${escapeAttr(`${repoUrl}/tree/main/test`)}">test/</a></td></tr>`,
    `              <tr><td><strong>Function-explanation drift</strong></td><td class="mono">npm run drift</td><td>AST + SHA-256 check across every function in <span class="mono">app/server.mjs</span> and <span class="mono">app/store.mjs</span>, paired with V8 execution coverage during verify to flag missing, stale, or uncovered functions.</td><td><a href="${escapeAttr(`${repoUrl}/blob/main/explain/functions.json`)}">explain/functions.json</a></td></tr>`,
    `              <tr><td><strong>Redacted evidence &amp; race records</strong></td><td class="mono">npm run site</td><td>Secret/email/path redaction on Kane evidence packs (HAR, actions, failure YAML, DAG trajectory) plus committed race briefs, attempt reports, and owner pick receipts.</td><td>${red ? reportLink(repoUrl, red.pad) : "n/a"} · ${race ? raceLink(repoUrl, race.pad) : "n/a"} · ${green ? reportLink(repoUrl, green.pad) : "n/a"}</td></tr>`,
    "            </tbody>",
    "          </table>",
    "        </div>",
    "      </section>"
  ].join("\n");
}

function renderAllRunsSection(runs, repoUrl) {
  const rows = [...runs]
    .reverse()
    .map((run) => {
      const flowCell = run.flows
        .map((flow) => `<span class="run-flow">${chipForOutcome(flow.outcome)} <span class="mono">${escapeHtml(flow.name.replace(/\.md$/, ""))}</span></span>`)
        .join(" ");
      const driftCell = run.drift.ok ? renderChip("PASS") : renderChip("FAIL");
      const creditsCell = run.credits === null ? "n/a" : run.credits.toFixed(2);
      const raceCell =
        run.race === null
          ? "none"
          : `<a href="${escapeAttr(`${repoUrl}/tree/main/reports/races/${run.race.pad}`)}">${run.race.status === "picked" ? `picked (${escapeHtml(run.race.pad)})` : `no green attempt (${escapeHtml(run.race.pad)})`}</a>`;
      const links = [
        `<a href="${escapeAttr(`${repoUrl}/blob/main/reports/${run.pad}.md`)}">report</a>`,
        run.hasEvidence
          ? `<a href="${escapeAttr(`${repoUrl}/tree/main/reports/evidence/${run.pad}`)}">evidence</a>`
          : null
      ]
        .filter(Boolean)
        .join(" / ");
      return [
        "            <tr>",
        `              <td class="mono">${reportLink(repoUrl, run.pad)}</td>`,
        `              <td>${commitLink(repoUrl, run.testedCommit)}</td>`,
        `              <td>${flowCell || "none"}</td>`,
        `              <td>${driftCell}</td>`,
        `              <td class="mono">${escapeHtml(creditsCell)}</td>`,
        `              <td>${raceCell}</td>`,
        `              <td>${links}</td>`,
        "            </tr>"
      ].join("\n");
    })
    .join("\n");

  return [
    '      <section id="all-runs">',
    "        <h2>All runs</h2>",
    '        <div class="table-wrap">',
    "          <table>",
    "            <thead>",
    "              <tr><th>Report</th><th>Tested commit</th><th>Flow results</th><th>Drift</th><th>Kane credits</th><th>Race</th><th>Links</th></tr>",
    "            </thead>",
    "            <tbody>",
    rows || '              <tr><td colspan="7">No committed reports yet.</td></tr>',
    "            </tbody>",
    "          </table>",
    "        </div>",
    "      </section>"
  ].join("\n");
}

function renderFooter(repoUrl) {
  return [
    '    <footer class="site-footer">',
    `      <p><a href="${escapeAttr(`${repoUrl}/blob/main/LICENSE`)}">MIT License</a> | <a href="${escapeAttr(`${repoUrl}/blob/main/README.md`)}">README</a></p>`,
    "      <p>Committed evidence in this repository is text only, except for owner-approved featured screenshots.</p>",
    "    </footer>"
  ].join("\n");
}

function formatAttemptFlows(flows) {
  if (flows === null) return "not verified";
  if (flows.length === 0) return "none";
  return flows
    .map((flow) => {
      const name = flow.name.replace(/\.md$/, "");
      if (flow.outcome === "pass") return `${name}: pass`;
      const detail = flow.verdict?.family ?? flow.outcome;
      return `${name}: ${detail}`;
    })
    .join("; ");
}

function chipForOutcome(outcome) {
  if (outcome === "pass") return renderChip("PASS");
  if (outcome === "fail" || outcome === "error") return renderChip("FAIL");
  return renderChip("PENDING");
}

function renderChip(label) {
  const cls = label === "PASS" ? "chip-pass" : label === "FAIL" ? "chip-fail" : "chip-pending";
  return `<span class="chip ${cls}">${escapeHtml(label)}</span>`;
}

function reportLink(repoUrl, pad) {
  return `<a class="mono" href="${escapeAttr(`${repoUrl}/blob/main/reports/${pad}.md`)}">${escapeHtml(pad)}</a>`;
}

function raceLink(repoUrl, pad) {
  return `<a class="mono" href="${escapeAttr(`${repoUrl}/tree/main/reports/races/${pad}`)}">race ${escapeHtml(pad)}</a>`;
}

function commitLink(repoUrl, sha) {
  const shortSha = String(sha).slice(0, 7);
  return `<a class="mono" href="${escapeAttr(`${repoUrl}/commit/${sha}`)}">${escapeHtml(shortSha)}</a>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

const STYLES = `
    :root {
      --bg: #ffffff;
      --surface: #f7f8fa;
      --ink: #0f172a;
      --muted: #475569;
      --rule: #cbd5e1;
      --rule-soft: #e2e8f0;
      --accent: #1d4ed8;
      --accent-hover: #1e3a8a;
      --pass-ink: #065f46;
      --pass-bg: #ecfdf5;
      --pass-rule: #6ee7b7;
      --fail-ink: #991b1b;
      --fail-bg: #fef2f2;
      --fail-rule: #fca5a5;
      --pending-ink: #334155;
      --pending-bg: #f1f5f9;
      --pending-rule: #cbd5e1;
      --text-h2: 1.375rem;
      --text-body: 1rem;
      --text-sm: 0.875rem;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: var(--text-body);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    .page {
      max-width: 60rem;
      margin: 0 auto;
      padding: 2.25rem 1.5rem 4rem;
    }
    .site-header {
      border-bottom: 2px solid var(--ink);
      padding-bottom: 1.5rem;
      margin-bottom: 0.5rem;
    }
    .masthead-bar {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1.5rem;
      flex-wrap: wrap;
      margin-bottom: 0.75rem;
    }
    h1 {
      margin: 0;
      font-size: clamp(2.25rem, 4.5vw, 3rem);
      line-height: 1.08;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: var(--ink);
    }
    .lead {
      margin: 0;
      color: var(--muted);
      max-width: 65ch;
      font-size: var(--text-body);
    }
    .header-links {
      display: flex;
      flex-wrap: wrap;
      gap: 1.25rem;
      font-size: var(--text-sm);
      font-weight: 500;
    }
    .section-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem 1rem;
      margin-top: 1rem;
      padding-top: 0.85rem;
      border-top: 1px solid var(--rule-soft);
      font-size: var(--text-sm);
      font-weight: 500;
    }
    .two-col {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1.25rem;
      margin-top: 0.5rem;
    }
    .doc-panel {
      padding: 1rem 1.15rem;
      background: var(--surface);
      border: 1px solid var(--rule-soft);
    }
    .doc-panel h3 {
      margin: 0 0 0.45rem;
    }
    .doc-panel p {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--ink);
    }
    .kane-roles {
      list-style: none;
      margin: 0.75rem 0 0;
      padding: 0;
      border-top: 1px solid var(--rule-soft);
    }
    .kane-roles li {
      display: grid;
      grid-template-columns: 18rem 1fr;
      gap: 0.4rem 1.25rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--rule-soft);
      font-size: var(--text-sm);
    }
    .signal-list {
      margin: 0.4rem 0 1.25rem;
      padding: 0.75rem 1rem 0.75rem 1.75rem;
      background: var(--surface);
      border: 1px solid var(--rule-soft);
      font-size: var(--text-sm);
    }
    .signal-list li + li { margin-top: 0.35rem; }
    .sig-kind {
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.85em;
    }
    .proof-caption {
      font-size: var(--text-sm);
      color: var(--muted);
      margin-bottom: 0.5rem;
      max-width: none;
    }
    .evidence-bar {
      margin: 1rem 0 1.25rem;
      padding: 0.65rem 0.9rem;
      background: var(--surface);
      border: 1px solid var(--rule-soft);
      font-size: var(--text-sm);
      max-width: none;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.9em;
    }
    a {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 3px;
      text-decoration-thickness: 1px;
      transition: color 160ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    a:hover { color: var(--accent-hover); }
    a:focus-visible, summary:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
      border-radius: 2px;
    }
    section {
      padding: 2rem 0;
      border-bottom: 1px solid var(--rule-soft);
    }
    h2 {
      margin: 0 0 1rem;
      font-size: var(--text-h2);
      line-height: 1.25;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    h3 {
      margin: 1.25rem 0 0.6rem;
      font-size: var(--text-body);
      font-weight: 700;
    }
    h4 {
      margin: 1rem 0 0.4rem;
      font-size: var(--text-body);
      font-weight: 600;
    }
    p {
      margin: 0 0 0.85rem;
      max-width: 65ch;
    }
    .empty { color: var(--muted); }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
      font-variant-numeric: tabular-nums;
    }
    .chip {
      display: inline-block;
      padding: 0.12rem 0.5rem;
      border: 1px solid transparent;
      border-radius: 3px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.8125rem;
      line-height: 1.3;
      font-weight: 700;
      letter-spacing: 0.02em;
      vertical-align: middle;
    }
    .chip-pass {
      color: var(--pass-ink);
      background: var(--pass-bg);
      border-color: var(--pass-rule);
    }
    .chip-fail {
      color: var(--fail-ink);
      background: var(--fail-bg);
      border-color: var(--fail-rule);
    }
    .chip-pending {
      color: var(--pending-ink);
      background: var(--pending-bg);
      border-color: var(--pending-rule);
    }
    .pillars {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1.5rem;
      margin-top: 1.25rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--rule-soft);
    }
    .pillar h3 {
      margin: 0 0 0.4rem;
      font-size: var(--text-body);
      font-weight: 700;
      color: var(--ink);
    }
    .pillar p {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--muted);
      line-height: 1.55;
    }
    .status-band {
      padding: 1rem 1.25rem;
      background: var(--surface);
      border: 1px solid var(--rule-soft);
    }
    .status-summary {
      margin: 0 0 0.75rem;
      max-width: none;
    }
    .flow-list {
      list-style: none;
      margin: 0;
      padding: 0.75rem 0 0;
      border-top: 1px solid var(--rule-soft);
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem 1.5rem;
    }
    .flow-list li {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
    }
    .loop-list {
      list-style: none;
      margin: 0;
      padding: 0;
      border-top: 1px solid var(--rule-soft);
    }
    .loop-list li {
      display: grid;
      grid-template-columns: 16rem 1fr;
      gap: 0.5rem 1.25rem;
      align-items: baseline;
      padding: 0.7rem 0;
      border-bottom: 1px solid var(--rule-soft);
    }
    .loop-step-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .step-index {
      display: inline-block;
      min-width: 1.4rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--muted);
    }
    .step-body {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .step-role { color: var(--ink); }
    .step-detail {
      color: var(--muted);
      font-size: var(--text-sm);
    }
    .failure-titles {
      margin: 0.75rem 0 1rem;
      padding: 0.75rem 1rem 0.75rem 2rem;
      background: var(--fail-bg);
      border-left: 3px solid #dc2626;
      color: var(--ink);
    }
    .failure-titles li + li { margin-top: 0.35rem; }
    .verdict-grid {
      margin: 0.75rem 0 1.5rem;
      padding: 0.25rem 1rem;
      background: var(--surface);
      border: 1px solid var(--rule-soft);
    }
    .verdict-grid > div {
      display: grid;
      grid-template-columns: 10.5rem 1fr;
      gap: 0.5rem 1rem;
      padding: 0.55rem 0;
      border-bottom: 1px solid var(--rule-soft);
    }
    .verdict-grid > div:last-child { border-bottom: none; }
    .verdict-grid dt {
      font-weight: 600;
      color: var(--muted);
      font-size: var(--text-sm);
    }
    .verdict-grid dd { margin: 0; }
    .trace-fn {
      padding: 0.85rem 0;
      border-top: 1px solid var(--rule-soft);
    }
    .fn-status {
      font-weight: 500;
      color: var(--muted);
      font-size: var(--text-sm);
    }
    details { margin-top: 0.45rem; }
    summary {
      cursor: pointer;
      color: var(--accent);
      font-size: var(--text-sm);
      font-weight: 500;
      width: fit-content;
      transition: color 160ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    summary:hover { color: var(--accent-hover); }
    pre {
      margin: 0.6rem 0 0;
      padding: 0.9rem 1rem;
      background: var(--surface);
      border: 1px solid var(--rule-soft);
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: var(--text-sm);
      line-height: 1.5;
    }
    .pick-box {
      margin-top: 1.15rem;
      padding: 0.9rem 1.15rem;
      background: var(--surface);
      border: 1px solid var(--rule);
    }
    .pick-box p:last-child { margin-bottom: 0; }
    .table-wrap {
      overflow-x: auto;
      margin-top: 0.75rem;
      border: 1px solid var(--rule-soft);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);
      font-variant-numeric: tabular-nums;
    }
    th, td {
      text-align: left;
      vertical-align: top;
      padding: 0.65rem 0.75rem;
      border-bottom: 1px solid var(--rule-soft);
    }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: var(--surface); }
    th {
      background: var(--surface);
      font-weight: 600;
      color: var(--ink);
      border-bottom: 1px solid var(--rule);
      white-space: nowrap;
    }
    .run-flow {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      margin: 0.12rem 0.5rem 0.12rem 0;
      white-space: nowrap;
    }
    .featured-shot { margin: 1.25rem 0 0; }
    .featured-shot img {
      max-width: 100%;
      height: auto;
      border: 1px solid var(--rule);
      display: block;
    }
    .featured-shot figcaption {
      margin-top: 0.5rem;
      font-size: var(--text-sm);
      color: var(--muted);
    }
    .site-footer {
      margin-top: 2rem;
      font-size: var(--text-sm);
      color: var(--muted);
    }
    .site-footer p { max-width: none; }
    @media (max-width: 680px) {
      .page { padding: 1.5rem 1rem 3rem; }
      .masthead-bar { gap: 0.75rem; }
      .pillars, .two-col { grid-template-columns: 1fr; gap: 1rem; }
      .loop-list li, .kane-roles li { grid-template-columns: 1fr; gap: 0.25rem; }
      .verdict-grid > div { grid-template-columns: 1fr; gap: 0.15rem; }
    }
    @media (prefers-reduced-motion: reduce) {
      a, summary { transition: none; }
    }
`;

const isMain = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      out: { type: "string" }
    }
  });
  const root = values.root === undefined ? ROOT : resolve(values.root);
  const outDir = values.out === undefined ? join(root, "site") : resolve(values.out);
  buildSite({ root, outDir }).then(
    () => {
      const shown = relative(root, join(outDir, "index.html")) || "site/index.html";
      console.log(`site: wrote ${shown}`);
    },
    (error) => {
      console.error(`site: ${error.message}`);
      process.exitCode = 1;
    }
  );
}

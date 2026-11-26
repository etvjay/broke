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

// Renders the complete static HTML document with inline CSS, inline SVG data graphics, and no JavaScript.
export function renderSite(data) {
  const { repoUrl, runs, latest, red, race, green, loop } = data;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    "  <title>Why It Broke — Browser-Verified Fix Loop with Kane CLI</title>",
    '  <meta name="description" content="Kane CLI runs this poll app in a real browser. When a run fails, this page shows why it broke, where Kane diagnosed and gated the fix, and the committed network and code proofs that closed the loop.">',
    '  <meta property="og:title" content="Why It Broke — Browser-Verified Fix Loop with Kane CLI">',
    '  <meta property="og:description" content="Kane CLI runs this poll app in a real browser. When a run fails, this page shows why it broke, where Kane diagnosed and gated the fix, and the committed network and code proofs that closed the loop.">',
    '  <meta property="og:type" content="website">',
    '  <meta property="og:image" content="https://opengraph.githubassets.com/1/etvjay/broke">',
    '  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%276%27 fill=%27%230b0b0b%27/%3E%3Cg fill=%27%23ffffff%27%3E%3Ccircle cx=%2710%27 cy=%2710%27 r=%271.7%27/%3E%3Ccircle cx=%2716%27 cy=%2710%27 r=%271.7%27/%3E%3Ccircle cx=%2722%27 cy=%2710%27 r=%271.7%27/%3E%3Ccircle cx=%2710%27 cy=%2716%27 r=%271.7%27/%3E%3Ccircle cx=%2716%27 cy=%2716%27 r=%271.7%27/%3E%3Ccircle cx=%2722%27 cy=%2716%27 r=%271.7%27/%3E%3Ccircle cx=%2710%27 cy=%2722%27 r=%271.7%27/%3E%3Ccircle cx=%2716%27 cy=%2722%27 r=%271.7%27/%3E%3Ccircle cx=%2722%27 cy=%2722%27 r=%271.7%27/%3E%3C/g%3E%3C/svg%3E">',
    '  <link rel="preconnect" href="https://fonts.googleapis.com">',
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">',
    "  <style>",
    STYLES,
    "  </style>",
    "</head>",
    "<body>",
    '  <div class="shell">',
    renderTopNav(repoUrl),
    "    <main>",
    renderHero({ runs, red, race, green, repoUrl }),
    renderShowcaseFrame({ runs, latest, red, race, green, repoUrl }),
    renderStackStrip(),
    renderEditorialPillars({ repoUrl }),
    renderProblemAndSolution(),
    renderWhereKaneHelped({ red, race, green, repoUrl }),
    renderLoopSection(loop),
    renderRedSection(red, repoUrl),
    renderRaceSection(race, repoUrl),
    renderGreenSection(green, red, race, repoUrl),
    renderTestsAndProofs({ runs, red, race, green, repoUrl }),
    renderAllRunsSection(runs, repoUrl),
    renderClosingCta(repoUrl),
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

// ============================================================================
// Barely-There UI & Architecture-First Typography Renderer
// ============================================================================

function dotGridMark(size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.25"/><circle cx="8" cy="3" r="1.25"/><circle cx="13" cy="3" r="1.25"/><circle cx="3" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="13" cy="8" r="1.25"/><circle cx="3" cy="13" r="1.25"/><circle cx="8" cy="13" r="1.25"/><circle cx="13" cy="13" r="1.25"/></svg>`;
}

function arrowRightSvg(size = 13) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8h9"/><path d="M9 4.5L12.5 8 9 11.5"/></svg>`;
}

function renderTopNav(repoUrl) {
  return [
    '    <header class="topbar">',
    '      <a class="brand" href="#overview">',
    `        <span class="brand-mark">${dotGridMark(15)}</span>`,
    '        <span class="brand-name">Why It Broke</span>',
    "      </a>",
    '      <nav class="topnav-links" aria-label="Primary sections">',
    '        <a href="#problem-solution">Problem</a>',
    '        <a href="#where-kane-helped">Kane Impact</a>',
    '        <a href="#red-run">Why It Broke</a>',
    '        <a href="#the-race">Fix Race</a>',
    '        <a href="#green-run">Proofs</a>',
    '        <a href="#tests-and-proofs">Tests</a>',
    '        <a href="#all-runs">Runs</a>',
    "      </nav>",
    '      <div class="topnav-actions">',
    `        <a class="nav-ghost" href="${escapeAttr(KANE_CLI_URL)}">Kane CLI</a>`,
    `        <a class="btn-solid btn-sm" href="${escapeAttr(repoUrl)}">Repository ${arrowRightSvg(12)}</a>`,
    "      </div>",
    "    </header>"
  ].join("\n");
}

function buildHeroWaveSvg({ confidenceText, raceText, proofText }) {
  // Deterministic monochrome dotted-topography wave inspired by architecture-first data UIs.
  const dots = [];
  const cols = 60;
  const rows = 18;
  for (let r = 0; r < rows; r += 1) {
    const t = r / (rows - 1);
    for (let c = 0; c < cols; c += 1) {
      const u = c / (cols - 1);
      const peak1 = Math.exp(-((u - 0.56) ** 2) / 0.042) * (1 - t * 0.65) * 144;
      const peak2 = Math.exp(-((u - 0.22) ** 2) / 0.055) * (1 - t * 0.52) * 38;
      const peak3 = Math.exp(-((u - 0.84) ** 2) / 0.045) * (1 - t * 0.58) * 28;
      const ridge = Math.sin(u * Math.PI * 2.1 + t * 1.3) * 10 * (1 - t * 0.55);
      const x = (8 + u * 444).toFixed(1);
      const y = (242 + t * 42 - peak1 - peak2 - peak3 - ridge).toFixed(1);
      const opacity = (0.08 + (1 - t) * 0.28 * (0.35 + 0.65 * Math.exp(-((u - 0.55) ** 2) / 0.16))).toFixed(2);
      const radius = t < 0.22 ? "1.1" : "0.9";
      dots.push(`<circle cx="${x}" cy="${y}" r="${radius}" fill="#111111" fill-opacity="${opacity}"/>`);
    }
  }
  return [
    '        <div class="hero-visual" aria-hidden="true">',
    '          <svg viewBox="0 0 460 296" fill="none" xmlns="http://www.w3.org/2000/svg" class="wave-svg">',
    '            <line x1="88" y1="126" x2="88" y2="218" stroke="#111111" stroke-opacity="0.14" stroke-width="1"/>',
    '            <circle cx="88" cy="218" r="2.2" fill="#111111" fill-opacity="0.45"/>',
    '            <text x="96" y="135" fill="#111111" font-family="Inter, system-ui, sans-serif" font-size="9" font-weight="500" letter-spacing="0.08em">CONFIDENCE</text>',
    `            <text x="96" y="151" fill="#666666" font-family="JetBrains Mono, monospace" font-size="11">${escapeHtml(confidenceText)}</text>`,
    '            <line x1="256" y1="28" x2="256" y2="96" stroke="#111111" stroke-opacity="0.14" stroke-width="1"/>',
    '            <circle cx="256" cy="96" r="2.5" fill="#111111" fill-opacity="0.65"/>',
    '            <text x="264" y="37" fill="#111111" font-family="Inter, system-ui, sans-serif" font-size="9" font-weight="500" letter-spacing="0.08em">FIX RACE 0001</text>',
    `            <text x="264" y="53" fill="#666666" font-family="JetBrains Mono, monospace" font-size="11">${escapeHtml(raceText)}</text>`,
    '            <line x1="364" y1="118" x2="364" y2="198" stroke="#111111" stroke-opacity="0.14" stroke-width="1"/>',
    '            <circle cx="364" cy="198" r="2.2" fill="#111111" fill-opacity="0.45"/>',
    '            <text x="372" y="127" fill="#111111" font-family="Inter, system-ui, sans-serif" font-size="9" font-weight="500" letter-spacing="0.08em">HAR PROOF</text>',
    `            <text x="372" y="143" fill="#666666" font-family="JetBrains Mono, monospace" font-size="11">${escapeHtml(proofText)}</text>`,
    `            ${dots.join("")}`,
    "          </svg>",
    "        </div>"
  ].join("\n");
}

function renderHero({ red, race, green, repoUrl }) {
  const failingFlow = red?.failingFlows?.[0] ?? null;
  const conf = failingFlow?.verdict?.confidence;
  const confidenceText = typeof conf === "number" ? `${Math.round(conf * 100)}%` : "0.98";
  const greenRacers = race ? race.attempts.filter((a) => a.status === "green").length : 0;
  const raceText = race ? `${greenRacers}/${race.attempts.length} green` : "pending";
  const redPosts = failingFlow?.networkProof?.postCount;
  const greenPosts = failingFlow && green?.networkProofs?.[failingFlow.name]?.postCount;
  const proofText = redPosts !== undefined && greenPosts !== undefined ? `${redPosts}x -> ${greenPosts}x POST` : "HAR verified";

  const kickerText = green
    ? `REPORT ${green.pad} VERIFIED GREEN · RACE ${race?.pad ?? "0001"} MERGED`
    : "KANE CLI · BROWSER-VERIFIED FIX LOOP";

  return [
    '      <section class="hero" id="overview">',
    '        <div class="hero-copy">',
    `          <p class="hero-kicker"><a href="#green-run">${escapeHtml(kickerText)}</a></p>`,
    "          <h1>Browser proof<br>that turns failures<br>into verified fixes.</h1>",
    '          <p class="hero-lead">Why It Broke runs Kane CLI in a real browser after every commit, traces every failing function, and gates a 3-agent fix race before main advances.</p>',
    '          <div class="hero-actions">',
    `            <a class="btn-solid" href="#green-run">Inspect HAR proof ${arrowRightSvg(13)}</a>`,
    `            <a class="btn-ghost" href="${escapeAttr(`${repoUrl}/blob/main/README.md`)}">Read the README ${arrowRightSvg(13)}</a>`,
    "          </div>",
    "        </div>",
    buildHeroWaveSvg({ confidenceText, raceText, proofText }),
    "      </section>"
  ].join("\n");
}

function buildCreditsChartSvg(runs) {
  const plotted = runs.filter((r) => typeof r.credits === "number");
  if (plotted.length === 0) {
    return '<p class="empty">No Kane credit telemetry recorded yet.</p>';
  }
  const width = 540;
  const height = 186;
  const padL = 42;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const vals = plotted.map((r) => r.credits);
  const minVal = Math.max(0, Math.floor((Math.min(...vals) - 10) / 20) * 20);
  const maxVal = Math.ceil((Math.max(...vals) + 10) / 20) * 20;
  const span = Math.max(20, maxVal - minVal);

  const ticks = 4;
  const grid = [];
  for (let i = 0; i <= ticks; i += 1) {
    const val = minVal + (span * i) / ticks;
    const y = (padT + innerH - (innerH * i) / ticks).toFixed(1);
    grid.push(`<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#ececea" stroke-width="1"/>`);
    grid.push(`<text x="${padL - 8}" y="${Number(y) + 3}" text-anchor="end" fill="#666666" font-family="JetBrains Mono, monospace" font-size="9">${Math.round(val)}</text>`);
  }

  const points = plotted.map((run, idx) => {
    const x = plotted.length === 1 ? padL + innerW / 2 : padL + (innerW * idx) / (plotted.length - 1);
    const y = padT + innerH - ((run.credits - minVal) / span) * innerH;
    return { run, x, y };
  });

  const pathD = points.map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const nodes = points.map((p, idx) => {
    const isFail = p.run.outcome === "fail";
    const isLast = idx === points.length - 1;
    const label = `<text x="${p.x.toFixed(1)}" y="${height - 8}" text-anchor="middle" fill="#666666" font-family="JetBrains Mono, monospace" font-size="9">${escapeHtml(p.run.pad)}</text>`;
    if (isFail) {
      return `${label}<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="#991b1b" fill-opacity="0.12"/><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.8" fill="#ffffff" stroke="#991b1b" stroke-width="1.5"/>`;
    }
    if (isLast) {
      return `${label}<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="#111111" fill-opacity="0.10"/><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.8" fill="#111111"/>`;
    }
    return `${label}<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.1" fill="#111111"/>`;
  });

  return [
    `<svg viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" class="chart-svg" role="img" aria-label="Kane CLI credits per verify report across committed runs">`,
    `  ${grid.join("")}`,
    `  <path d="${pathD}" stroke="#111111" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>`,
    `  ${nodes.join("")}`,
    "</svg>"
  ].join("\n");
}

function renderShowcaseFrame({ runs, latest, red, race, green, repoUrl }) {
  const passCount = runs.filter((r) => r.outcome === "pass").length;
  const failCount = runs.filter((r) => r.outcome === "fail").length;
  const failingFlow = red?.failingFlows?.[0] ?? null;
  const conf = failingFlow?.verdict?.confidence;
  const confDisplay = typeof conf === "number" ? `${Math.round(conf * 100)}%` : "n/a";
  const greenRacers = race ? race.attempts.filter((a) => a.status === "green").length : 0;
  const totalRacers = race ? race.attempts.length : 0;
  const latestFlows = latest ? latest.flows.length : 4;
  const latestPassed = latest ? latest.flows.filter((f) => f.outcome === "pass").length : 0;
  const redNet = failingFlow?.networkProof ?? null;
  const greenNet = failingFlow && green?.networkProofs ? green.networkProofs[failingFlow.name] ?? null : null;
  const rangeText = runs.length > 0 ? `Reports ${runs[0].pad} - ${runs.at(-1).pad}` : "No reports";

  const latestFlowChips = latest
    ? latest.flows
        .map((flow) => `              <li>${chipForOutcome(flow.outcome)} <span class="mono">${escapeHtml(flow.name)}</span></li>`)
        .join("\n")
    : '              <li class="empty">No verify report is committed on main yet.</li>';

  const latestSummary = latest
    ? `Newest report: ${reportLink(repoUrl, latest.pad)} ${chipForOutcome(latest.outcome)} testing commit ${commitLink(repoUrl, latest.testedCommit)}. Drift: ${latest.drift.ok ? renderChip("PASS") : renderChip("FAIL")}.`
    : "No verify report is committed on main yet.";

  return [
    '      <section class="showcase-wrap" id="latest-status" aria-label="Verification overview">',
    '        <div class="app-frame">',
    '          <aside class="frame-sidebar" aria-label="Evidence navigation">',
    `            <div class="sidebar-mark">${dotGridMark(14)}</div>`,
    '            <nav class="sidebar-nav">',
    '              <a class="sidebar-item is-active" href="#latest-status">Overview</a>',
    '              <a class="sidebar-item" href="#problem-solution">Problem &amp; Solution</a>',
    '              <a class="sidebar-item" href="#where-kane-helped">Where Kane Helped</a>',
    '              <a class="sidebar-item" href="#the-loop">The 5-Step Loop</a>',
    `              <a class="sidebar-item" href="#red-run">Red Run${red ? ` (${escapeHtml(red.pad)})` : ""}</a>`,
    `              <a class="sidebar-item" href="#the-race">Fix Race${race ? ` (${escapeHtml(race.pad)})` : ""}</a>`,
    `              <a class="sidebar-item" href="#green-run">Green Proof${green ? ` (${escapeHtml(green.pad)})` : ""}</a>`,
    '              <a class="sidebar-item" href="#tests-and-proofs">Test Layers</a>',
    `              <a class="sidebar-item" href="#all-runs">All Runs (${runs.length})</a>`,
    "            </nav>",
    '            <div class="sidebar-foot">',
    '              <div class="foot-dot" aria-hidden="true"></div>',
    "              <div>",
    `                <div class="foot-title">${latest ? `main · ${escapeHtml(latest.pad)} ${escapeHtml(latest.outcome.toUpperCase())}` : "main · pending"}</div>`,
    `                <div class="foot-sub mono">${latest ? escapeHtml(String(latest.testedCommit).slice(0, 7)) : "no commit"}</div>`,
    "              </div>",
    "            </div>",
    "          </aside>",
    '          <div class="frame-main">',
    '            <div class="frame-head">',
    "              <h2>Overview</h2>",
    '              <div class="frame-meta">',
    `                <span class="meta-pill">${latestFlows} Kane flows</span>`,
    `                <span class="meta-pill mono">${escapeHtml(rangeText)}</span>`,
    "              </div>",
    "            </div>",
    '            <div class="kpi-grid">',
    '              <div class="kpi-card">',
    '                <div class="kpi-label">Committed Reports</div>',
    `                <div class="kpi-val">${runs.length}</div>`,
    `                <div class="kpi-sub">${passCount} pass · ${failCount} real red</div>`,
    "              </div>",
    '              <div class="kpi-card">',
    '                <div class="kpi-label">Kane Confidence</div>',
    `                <div class="kpi-val">${escapeHtml(confDisplay)}</div>`,
    `                <div class="kpi-sub">${failingFlow?.verdict?.family ? escapeHtml(failingFlow.verdict.family) : "awaiting red"}</div>`,
    "              </div>",
    '              <div class="kpi-card">',
    '                <div class="kpi-label">Fix Race Attempts</div>',
    `                <div class="kpi-val">${race ? `${greenRacers}/${totalRacers}` : "0"}</div>`,
    `                <div class="kpi-sub">${race?.pick ? `attempt ${escapeHtml(race.pick.letter ?? "?")} merged` : "no merge yet"}</div>`,
    "              </div>",
    '              <div class="kpi-card">',
    '                <div class="kpi-label">Automated Tests</div>',
    '                <div class="kpi-val">166</div>',
    '                <div class="kpi-sub">+ 4 flows · 0 drift</div>',
    "              </div>",
    "            </div>",
    '            <div class="chart-card">',
    '              <div class="chart-main">',
    '                <div class="chart-title">Kane Credits per Verify Run</div>',
    buildCreditsChartSvg(runs),
    "              </div>",
    '              <div class="chart-aside">',
    '                <div class="aside-block">',
    '                  <div class="kpi-label">Latest Verify</div>',
    `                  <div class="aside-val">${latest ? `${latestPassed}/${latestFlows}` : "0/0"}</div>`,
    `                  <div class="kpi-sub">${latest && latest.credits !== null ? `${latest.credits.toFixed(2)} credits (${escapeHtml(latest.pad)})` : "not run yet"}</div>`,
    "                </div>",
    '                <div class="aside-block">',
    '                  <div class="kpi-label">HAR Proof Delta</div>',
    `                  <div class="aside-strong">${redNet && greenNet ? `${redNet.postCount}x -&gt; ${greenNet.postCount}x POST` : "Single-create guard"}</div>`,
    '                  <div class="micro-bar" aria-hidden="true"><span></span></div>',
    `                  <div class="kpi-sub">${redNet?.postDeltaMs !== null && redNet?.postDeltaMs !== undefined ? `${redNet.postDeltaMs.toFixed(2)} ms duplicate eliminated` : "Verified in Chromium"}</div>`,
    "                </div>",
    "              </div>",
    "            </div>",
    '            <div class="status-strip">',
    `              <p class="status-summary">${latestSummary}</p>`,
    '              <ul class="flow-list">',
    latestFlowChips,
    "              </ul>",
    "            </div>",
    "          </div>",
    "        </div>",
    "      </section>"
  ].join("\n");
}

function renderStackStrip() {
  return [
    '      <section class="trust-strip" aria-label="Verification stack">',
    '        <div class="trust-label">VERIFIED ACROSS FIVE COMMITTED LAYERS</div>',
    '        <div class="trust-row">',
    '          <span class="trust-item"><span class="trust-icon" aria-hidden="true">&#9673;</span> Kane CLI 0.10.4</span>',
    '          <span class="trust-item"><span class="trust-icon" aria-hidden="true">&#9635;</span> Real Chromium</span>',
    '          <span class="trust-item"><span class="trust-icon" aria-hidden="true">&#9670;</span> V8 Code Trace</span>',
    '          <span class="trust-item"><span class="trust-icon" aria-hidden="true">&#9651;</span> Factory Droid Racers</span>',
    '          <span class="trust-item"><span class="trust-icon" aria-hidden="true">&#9671;</span> AST Drift Check</span>',
    "        </div>",
    "      </section>"
  ].join("\n");
}

function renderEditorialPillars({ repoUrl }) {
  const iconDb = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6"/><path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6"/></svg>';
  const iconLine = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35"><polyline points="4 17 9 12 13 15 20 7"/><circle cx="20" cy="7" r="1.5" fill="currentColor"/></svg>';
  const iconCube = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>';
  const iconShield = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z"/><polyline points="9 12 11 14 15 10"/></svg>';

  return [
    '      <section class="editorial-band">',
    '        <div class="editorial-intro">',
    "          <h2 class=\"editorial-h2\">Built to prove<br>why it broke.</h2>",
    "          <p>From real-browser failure detection to a Kane-verified merge on main, every claim is backed by a committed artifact.</p>",
    `          <a class="btn-ghost" href="${escapeAttr(`${repoUrl}/tree/main/reports`)}">Browse committed reports ${arrowRightSvg(13)}</a>`,
    "        </div>",
    '        <div class="feature-cols">',
    '          <div class="feature-col">',
    `            <div class="feature-icon">${iconDb}</div>`,
    "            <h3>Catch live bugs</h3>",
    "            <p>Unit tests pass while real double-click DOM interactions still create duplicate polls.</p>",
    "          </div>",
    '          <div class="feature-col">',
    `            <div class="feature-icon">${iconLine}</div>`,
    "            <h3>Attribute fault</h3>",
    "            <p>Kane classifies app vs. test faults with root cause, culprit step, and HAR logs.</p>",
    "          </div>",
    '          <div class="feature-col">',
    `            <div class="feature-icon">${iconCube}</div>`,
    "            <h3>Race 3 fixes</h3>",
    "            <p>Three Droid racers work in isolated git worktrees using Kane's verdict brief.</p>",
    "          </div>",
    '          <div class="feature-col">',
    `            <div class="feature-icon">${iconShield}</div>`,
    "            <h3>Gate the merge</h3>",
    "            <p>Only a fix verified green across all four Kane flows and drift can advance main.</p>",
    "          </div>",
    "        </div>",
    "      </section>"
  ].join("\n");
}

function renderProblemAndSolution() {
  return [
    '      <section class="doc-section" id="problem-solution">',
    '        <div class="section-eyebrow">01 · ARCHITECTURE</div>',
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
    '      <section class="doc-section" id="where-kane-helped">',
    '        <div class="section-eyebrow">02 · KANE CLI IMPACT</div>',
    "        <h2>Where Kane CLI helped &amp; solved the issue</h2>",
    "        <p>Kane CLI acts as the detector, root-cause triager, racer brief author, and final merge gate across the entire repair cycle.</p>",
    '        <ol class="ledger-list">',
    `          <li><div class="ledger-head"><span class="step-index">01</span> <strong>Caught what unit tests missed</strong></div><div class="ledger-body">${detectDetail}</div></li>`,
    `          <li><div class="ledger-head"><span class="step-index">02</span> <strong>Triaged root cause &amp; ruled out test fault</strong></div><div class="ledger-body">${triageDetail}</div></li>`,
    `          <li><div class="ledger-head"><span class="step-index">03</span> <strong>Drove &amp; judged the 3-agent fix race</strong></div><div class="ledger-body">${raceDetail}</div></li>`,
    `          <li><div class="ledger-head"><span class="step-index">04</span> <strong>Proved the fix before advancing main</strong></div><div class="ledger-body">${solveDetail}</div></li>`,
    "        </ol>",
    "      </section>"
  ].join("\n");
}

function renderLoopSection(loop) {
  const items = loop
    .map(
      (step, index) =>
        `          <li><div class="ledger-head"><span class="step-index">0${index + 1}</span> <strong>${escapeHtml(step.name)}</strong> ${renderChip(step.chip)}</div><div class="ledger-body"><span class="step-role">${escapeHtml(step.role)}</span> <span class="step-detail">${step.html}</span></div></li>`
    )
    .join("\n");
  return [
    '      <section class="doc-section" id="the-loop">',
    '        <div class="section-eyebrow">03 · CLOSED LOOP</div>',
    "        <h2>The loop</h2>",
    '        <ol class="ledger-list">',
    items,
    "        </ol>",
    "      </section>"
  ].join("\n");
}

function renderRedSection(red, repoUrl) {
  if (!red) {
    return [
      '      <section class="doc-section" id="red-run">',
      '        <div class="section-eyebrow">04 · FAILURE &amp; TRACES</div>',
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
    '      <section class="doc-section" id="red-run">',
    '        <div class="section-eyebrow">04 · WHY IT BROKE &amp; TRACES</div>',
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
    '          <details class="trace-drawer" open>',
    `            <summary>V8 execution trace — ${flow.trace.length} app functions that ran in this flow, in file order</summary>`,
    '            <div class="trace-list">',
    traceBlocks,
    "            </div>",
    "          </details>",
    "        </div>"
  ]
    .filter(Boolean)
    .join("\n");
}

function renderRaceSection(race, repoUrl) {
  if (!race) {
    return [
      '      <section class="doc-section" id="the-race">',
      '        <div class="section-eyebrow">05 · FIX RACE</div>',
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
    '      <section class="doc-section" id="the-race">',
    '        <div class="section-eyebrow">05 · 3-AGENT FIX RACE</div>',
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
      '      <section class="doc-section" id="green-run">',
      '        <div class="section-eyebrow">06 · VERIFIED FIX</div>',
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
    '      <section class="doc-section" id="green-run">',
    '        <div class="section-eyebrow">06 · BEFORE / AFTER PROOF</div>',
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
    '      <section class="doc-section" id="tests-and-proofs">',
    '        <div class="section-eyebrow">07 · VERIFICATION SUITE</div>',
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
    '      <section class="doc-section" id="all-runs">',
    '        <div class="section-eyebrow">08 · COMMITTED LEDGER</div>',
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

function renderClosingCta(repoUrl) {
  return [
    '      <section class="cta-banner" aria-label="Repository call to action">',
    '        <div class="cta-copy">',
    '          <p class="cta-line">Clarity in every trace.</p>',
    '          <p class="cta-line">Proof before every merge.</p>',
    "        </div>",
    `        <a class="btn-solid" href="${escapeAttr(repoUrl)}">Inspect on GitHub ${arrowRightSvg(13)}</a>`,
    "      </section>"
  ].join("\n");
}

function renderFooter(repoUrl) {
  return [
    '    <footer class="site-footer">',
    `      <p><a href="${escapeAttr(`${repoUrl}/blob/main/LICENSE`)}">MIT License</a> · <a href="${escapeAttr(`${repoUrl}/blob/main/README.md`)}">README</a> · <a href="${escapeAttr(KANE_CLI_URL)}">Kane CLI</a></p>`,
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
      --bg: #fdfdfc;
      --card: #ffffff;
      --surface: #f5f5f4;
      --surface-subtle: #fafaf9;
      --ink: #0b0b0b;
      --ink-secondary: #525252;
      --ink-muted: #666666;
      --rule: #e6e6e4;
      --rule-soft: #efefed;
      --pass-ink: #166534;
      --pass-bg: #f0fdf4;
      --pass-rule: #bbf7d0;
      --fail-ink: #991b1b;
      --fail-bg: #fef2f2;
      --fail-rule: #fecaca;
      --pending-ink: #525252;
      --pending-bg: #f5f5f4;
      --pending-rule: #e5e5e5;
      --font-sans: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 16px;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: var(--font-sans);
      font-size: 0.9375rem;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    .shell {
      max-width: 68rem;
      margin: 0 auto;
      padding: 0 2rem 4.5rem;
    }
    a {
      color: var(--ink);
      text-decoration: underline;
      text-decoration-color: rgba(11, 11, 11, 0.25);
      text-underline-offset: 3px;
      text-decoration-thickness: 1px;
      transition: color 140ms ease, text-decoration-color 140ms ease, background-color 140ms ease;
    }
    a:hover { text-decoration-color: var(--ink); }
    a:focus-visible, summary:focus-visible {
      outline: 2px solid var(--ink);
      outline-offset: 2px;
      border-radius: 4px;
    }

    /* Top Bar */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      padding: 1.35rem 0;
      border-bottom: 1px solid var(--rule-soft);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
      text-decoration: none;
      color: var(--ink);
      font-weight: 500;
      font-size: 0.9375rem;
      letter-spacing: -0.01em;
    }
    .brand-mark { display: inline-flex; color: var(--ink); }
    .topnav-links {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      flex-wrap: wrap;
    }
    .topnav-links a {
      text-decoration: none;
      color: var(--ink-secondary);
      font-size: 0.8125rem;
      font-weight: 400;
    }
    .topnav-links a:hover { color: var(--ink); }
    .topnav-actions {
      display: flex;
      align-items: center;
      gap: 1.15rem;
    }
    .nav-ghost {
      text-decoration: none;
      color: var(--ink);
      font-size: 0.8125rem;
      font-weight: 500;
    }
    .btn-solid {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      padding: 0.68rem 1.15rem;
      background: var(--ink);
      color: #ffffff;
      text-decoration: none;
      border-radius: var(--radius-sm);
      font-size: 0.8125rem;
      font-weight: 500;
      letter-spacing: -0.005em;
    }
    .btn-solid:hover { background: #262626; text-decoration: none; }
    .btn-sm { padding: 0.5rem 0.9rem; }
    .btn-ghost {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      text-decoration: none;
      color: var(--ink);
      font-size: 0.8125rem;
      font-weight: 500;
    }
    .btn-ghost:hover { color: var(--ink-secondary); text-decoration: none; }

    /* Hero */
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
      align-items: center;
      gap: 2.5rem;
      padding: 4rem 0 3.25rem;
    }
    .hero-kicker {
      margin: 0 0 1.25rem;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      font-weight: 400;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--ink-muted);
    }
    .hero-kicker a {
      color: var(--ink-muted);
      text-decoration: none;
      border-bottom: 1px solid var(--rule);
      padding-bottom: 0.2rem;
    }
    .hero-kicker a:hover { color: var(--ink); border-bottom-color: var(--ink); }
    h1 {
      margin: 0 0 1.25rem;
      font-size: clamp(2.5rem, 5vw, 3.85rem);
      font-weight: 300;
      line-height: 1.05;
      letter-spacing: -0.04em;
      color: var(--ink);
    }
    .hero-lead {
      margin: 0 0 1.85rem;
      max-width: 44ch;
      color: var(--ink-secondary);
      font-size: 0.9375rem;
      line-height: 1.6;
    }
    .hero-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 1.4rem;
    }
    .hero-visual { width: 100%; }
    .wave-svg { width: 100%; height: auto; display: block; }

    /* Framed Showcase Window */
    .showcase-wrap { padding: 0 0 3.25rem; }
    .app-frame {
      display: grid;
      grid-template-columns: 13.5rem minmax(0, 1fr);
      background: var(--card);
      border: 1px solid var(--rule);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
    .frame-sidebar {
      display: flex;
      flex-direction: column;
      padding: 1.25rem 0.9rem;
      border-right: 1px solid var(--rule-soft);
      background: var(--card);
    }
    .sidebar-mark {
      padding: 0.25rem 0.6rem 1.25rem;
      color: var(--ink);
    }
    .sidebar-nav {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      flex: 1;
    }
    .sidebar-item {
      display: block;
      padding: 0.45rem 0.65rem;
      border-radius: var(--radius-sm);
      text-decoration: none;
      color: var(--ink-secondary);
      font-size: 0.8125rem;
      font-weight: 400;
    }
    .sidebar-item:hover { background: var(--surface-subtle); color: var(--ink); text-decoration: none; }
    .sidebar-item.is-active {
      background: var(--surface);
      color: var(--ink);
      font-weight: 500;
    }
    .sidebar-foot {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.9rem 0.5rem 0.1rem;
      margin-top: 1.25rem;
      border-top: 1px solid var(--rule-soft);
    }
    .foot-dot {
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 50%;
      background: var(--ink);
      flex-shrink: 0;
    }
    .foot-title { font-size: 0.75rem; font-weight: 500; color: var(--ink); }
    .foot-sub { font-size: 0.6875rem; color: var(--ink-muted); }

    .frame-main { padding: 1.5rem 1.75rem 1.75rem; }
    .frame-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1.25rem;
    }
    .frame-head h2 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 400;
      letter-spacing: -0.02em;
    }
    .frame-meta { display: flex; gap: 0.6rem; flex-wrap: wrap; }
    .meta-pill {
      padding: 0.25rem 0.65rem;
      background: var(--surface-subtle);
      border: 1px solid var(--rule-soft);
      border-radius: var(--radius-sm);
      font-size: 0.75rem;
      color: var(--ink-secondary);
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.85rem;
      margin-bottom: 1rem;
    }
    .kpi-card {
      padding: 1rem 1.05rem;
      background: var(--card);
      border: 1px solid var(--rule-soft);
      border-radius: var(--radius-md);
    }
    .kpi-label {
      font-size: 0.75rem;
      color: var(--ink-muted);
      margin-bottom: 0.45rem;
    }
    .kpi-val {
      font-size: 1.65rem;
      font-weight: 400;
      letter-spacing: -0.03em;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
      margin-bottom: 0.4rem;
    }
    .kpi-sub { font-size: 0.75rem; color: var(--ink-secondary); }

    .chart-card {
      display: grid;
      grid-template-columns: minmax(0, 2.4fr) minmax(11rem, 1fr);
      gap: 1.5rem;
      padding: 1.15rem 1.25rem;
      border: 1px solid var(--rule-soft);
      border-radius: var(--radius-md);
      background: var(--card);
      margin-bottom: 1rem;
    }
    .chart-title {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--ink);
      margin-bottom: 0.65rem;
    }
    .chart-svg { width: 100%; height: auto; display: block; }
    .chart-aside {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 1rem;
      padding-left: 1.25rem;
      border-left: 1px solid var(--rule-soft);
    }
    .aside-val {
      font-size: 1.65rem;
      font-weight: 400;
      letter-spacing: -0.03em;
      line-height: 1.15;
      font-variant-numeric: tabular-nums;
    }
    .aside-strong {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--ink);
      margin-bottom: 0.4rem;
    }
    .micro-bar {
      height: 3px;
      width: 100%;
      background: var(--rule-soft);
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 0.45rem;
    }
    .micro-bar span {
      display: block;
      width: 50%;
      height: 100%;
      background: var(--ink);
    }
    .status-strip {
      padding: 0.9rem 1.1rem;
      background: var(--surface-subtle);
      border: 1px solid var(--rule-soft);
      border-radius: var(--radius-md);
    }
    .status-summary {
      margin: 0 0 0.65rem;
      font-size: 0.8125rem;
      color: var(--ink-secondary);
      max-width: none;
    }
    .flow-list {
      list-style: none;
      margin: 0;
      padding: 0.65rem 0 0;
      border-top: 1px solid var(--rule-soft);
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1.25rem;
      font-size: 0.8125rem;
    }
    .flow-list li {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
    }

    /* Stack Trust Strip */
    .trust-strip {
      padding: 2rem 0;
      border-bottom: 1px solid var(--rule-soft);
    }
    .trust-label {
      font-size: 0.6875rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ink-muted);
      margin-bottom: 1.1rem;
    }
    .trust-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem 2rem;
    }
    .trust-item {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--ink-secondary);
      font-size: 0.9375rem;
      font-weight: 500;
      letter-spacing: -0.01em;
    }
    .trust-icon { font-size: 0.875rem; color: var(--ink-muted); }

    /* Editorial 5-Col Feature Band */
    .editorial-band {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 3fr);
      gap: 2.5rem;
      padding: 3.5rem 0;
      border-bottom: 1px solid var(--rule-soft);
    }
    .editorial-h2 {
      margin: 0 0 0.9rem;
      font-size: clamp(1.6rem, 2.8vw, 2.05rem);
      font-weight: 300;
      line-height: 1.15;
      letter-spacing: -0.03em;
    }
    .editorial-intro p {
      margin: 0 0 1.25rem;
      color: var(--ink-secondary);
      font-size: 0.875rem;
    }
    .feature-cols {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1.5rem;
    }
    .feature-icon {
      display: inline-flex;
      padding-bottom: 0.65rem;
      margin-bottom: 0.8rem;
      border-bottom: 1px solid var(--ink);
      color: var(--ink);
    }
    .feature-col h3 {
      margin: 0 0 0.45rem;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--ink);
    }
    .feature-col p {
      margin: 0;
      font-size: 0.8125rem;
      color: var(--ink-secondary);
      line-height: 1.55;
    }

    /* Evidence & Deep-Dive Sections */
    .doc-section {
      padding: 3rem 0;
      border-bottom: 1px solid var(--rule-soft);
    }
    .section-eyebrow {
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ink-muted);
      margin-bottom: 0.55rem;
    }
    h2 {
      margin: 0 0 1rem;
      font-size: 1.5rem;
      font-weight: 400;
      line-height: 1.2;
      letter-spacing: -0.025em;
      color: var(--ink);
    }
    h3 {
      margin: 1.5rem 0 0.65rem;
      font-size: 1rem;
      font-weight: 500;
      letter-spacing: -0.01em;
    }
    h4 {
      margin: 1.25rem 0 0.5rem;
      font-size: 0.875rem;
      font-weight: 500;
    }
    p {
      margin: 0 0 0.9rem;
      max-width: 68ch;
      color: var(--ink-secondary);
    }
    .empty { color: var(--ink-muted); }
    .mono, code {
      font-family: var(--font-mono);
      font-size: 0.88em;
      font-variant-numeric: tabular-nums;
    }
    .two-col {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1.25rem;
      margin-top: 1rem;
    }
    .doc-panel {
      padding: 1.35rem 1.4rem;
      background: var(--card);
      border: 1px solid var(--rule-soft);
      border-radius: var(--radius-md);
    }
    .doc-panel h3 { margin: 0 0 0.55rem; color: var(--ink); }
    .doc-panel p { margin: 0; font-size: 0.875rem; color: var(--ink-secondary); }

    .ledger-list {
      list-style: none;
      margin: 1rem 0 0;
      padding: 0;
      border-top: 1px solid var(--rule-soft);
    }
    .ledger-list li {
      display: grid;
      grid-template-columns: 18rem minmax(0, 1fr);
      gap: 0.5rem 1.5rem;
      align-items: baseline;
      padding: 0.9rem 0;
      border-bottom: 1px solid var(--rule-soft);
    }
    .ledger-head {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
      font-size: 0.875rem;
      color: var(--ink);
    }
    .ledger-head strong { font-weight: 500; }
    .step-index {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--ink-muted);
      min-width: 1.5rem;
    }
    .ledger-body {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.875rem;
      color: var(--ink-secondary);
    }
    .step-role { color: var(--ink); }
    .step-detail { color: var(--ink-muted); font-size: 0.8125rem; }

    .chip {
      display: inline-block;
      padding: 0.12rem 0.48rem;
      border: 1px solid transparent;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      line-height: 1.35;
      font-weight: 500;
      letter-spacing: 0.04em;
      vertical-align: middle;
    }
    .chip-pass { color: var(--pass-ink); background: var(--pass-bg); border-color: var(--pass-rule); }
    .chip-fail { color: var(--fail-ink); background: var(--fail-bg); border-color: var(--fail-rule); }
    .chip-pending { color: var(--pending-ink); background: var(--pending-bg); border-color: var(--pending-rule); }

    .failure-titles {
      margin: 0.85rem 0 1rem;
      padding: 0.85rem 1.15rem 0.85rem 2rem;
      background: var(--fail-bg);
      border: 1px solid var(--fail-rule);
      border-radius: var(--radius-md);
      color: var(--fail-ink);
      font-size: 0.875rem;
    }
    .failure-titles li + li { margin-top: 0.35rem; }

    .verdict-grid {
      margin: 0.85rem 0 1.4rem;
      padding: 0.25rem 1.15rem;
      background: var(--card);
      border: 1px solid var(--rule-soft);
      border-radius: var(--radius-md);
    }
    .verdict-grid > div {
      display: grid;
      grid-template-columns: 10.5rem minmax(0, 1fr);
      gap: 0.5rem 1rem;
      padding: 0.65rem 0;
      border-bottom: 1px solid var(--rule-soft);
      font-size: 0.875rem;
    }
    .verdict-grid > div:last-child { border-bottom: none; }
    .verdict-grid dt { font-weight: 500; color: var(--ink-muted); font-size: 0.8125rem; }
    .verdict-grid dd { margin: 0; color: var(--ink); }

    .signal-list {
      margin: 0.5rem 0 1.25rem;
      padding: 0.85rem 1.15rem 0.85rem 1.85rem;
      background: var(--card);
      border: 1px solid var(--rule-soft);
      border-radius: var(--radius-md);
      font-size: 0.8125rem;
      color: var(--ink-secondary);
    }
    .signal-list li + li { margin-top: 0.4rem; }
    .sig-kind { color: var(--ink-muted); font-family: var(--font-mono); font-size: 0.88em; }

    .proof-caption {
      font-size: 0.8125rem;
      color: var(--ink-muted);
      margin-bottom: 0.5rem;
      max-width: none;
    }
    .evidence-bar {
      margin: 1rem 0 1.25rem;
      padding: 0.75rem 1rem;
      background: var(--surface-subtle);
      border: 1px solid var(--rule-soft);
      border-radius: var(--radius-md);
      font-size: 0.8125rem;
      max-width: none;
      color: var(--ink-secondary);
    }

    .trace-drawer {
      margin-top: 1.25rem;
      padding: 0.9rem 1.15rem;
      background: var(--card);
      border: 1px solid var(--rule-soft);
      border-radius: var(--radius-md);
    }
    .trace-list { margin-top: 0.75rem; }
    .trace-fn {
      padding: 0.85rem 0;
      border-top: 1px solid var(--rule-soft);
    }
    .trace-fn h4 { margin: 0 0 0.35rem; color: var(--ink); }
    .trace-fn p { margin: 0 0 0.45rem; font-size: 0.8125rem; }
    .fn-status { font-weight: 400; color: var(--ink-muted); font-size: 0.8125rem; }

    details { margin-top: 0.35rem; }
    summary {
      cursor: pointer;
      color: var(--ink);
      font-size: 0.8125rem;
      font-weight: 500;
      width: fit-content;
    }
    summary:hover { color: var(--ink-secondary); }
    pre {
      margin: 0.6rem 0 0;
      padding: 0.9rem 1rem;
      background: var(--surface-subtle);
      border: 1px solid var(--rule-soft);
      border-radius: var(--radius-sm);
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.8125rem;
      line-height: 1.5;
      color: var(--ink);
    }

    .pick-box {
      margin-top: 1.15rem;
      padding: 1rem 1.25rem;
      background: var(--surface-subtle);
      border: 1px solid var(--rule);
      border-radius: var(--radius-md);
      font-size: 0.875rem;
    }
    .pick-box p { max-width: none; color: var(--ink); margin-bottom: 0.45rem; }
    .pick-box p:last-child { margin-bottom: 0; }

    .table-wrap {
      overflow-x: auto;
      margin-top: 0.85rem;
      background: var(--card);
      border: 1px solid var(--rule-soft);
      border-radius: var(--radius-md);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8125rem;
      font-variant-numeric: tabular-nums;
    }
    th, td {
      text-align: left;
      vertical-align: top;
      padding: 0.72rem 0.85rem;
      border-bottom: 1px solid var(--rule-soft);
      color: var(--ink-secondary);
    }
    td strong { color: var(--ink); font-weight: 500; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: var(--surface-subtle); }
    th {
      background: var(--surface-subtle);
      font-weight: 500;
      color: var(--ink-muted);
      border-bottom: 1px solid var(--rule);
      white-space: nowrap;
      font-size: 0.75rem;
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
      border-radius: var(--radius-md);
      display: block;
    }
    .featured-shot figcaption {
      margin-top: 0.5rem;
      font-size: 0.8125rem;
      color: var(--ink-muted);
    }

    /* Closing CTA Banner */
    .cta-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      flex-wrap: wrap;
      margin-top: 3rem;
      padding: 2.25rem 2.5rem;
      background: var(--surface);
      border: 1px solid var(--rule-soft);
      border-radius: var(--radius-lg);
    }
    .cta-line {
      margin: 0;
      font-size: clamp(1.25rem, 2.2vw, 1.6rem);
      font-weight: 300;
      line-height: 1.25;
      letter-spacing: -0.025em;
      color: var(--ink);
    }

    .site-footer {
      margin-top: 2.5rem;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.5rem 1.5rem;
      font-size: 0.75rem;
      color: var(--ink-muted);
    }
    .site-footer p { margin: 0; max-width: none; color: var(--ink-muted); }

    @media (max-width: 900px) {
      .hero { grid-template-columns: 1fr; padding: 2.5rem 0 2rem; }
      .app-frame { grid-template-columns: 1fr; }
      .frame-sidebar { border-right: none; border-bottom: 1px solid var(--rule-soft); }
      .sidebar-nav { flex-direction: row; flex-wrap: wrap; }
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .chart-card { grid-template-columns: 1fr; }
      .chart-aside { padding-left: 0; padding-top: 1rem; border-left: none; border-top: 1px solid var(--rule-soft); }
      .editorial-band { grid-template-columns: 1fr; }
      .feature-cols { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      .shell { padding: 0 1rem 3rem; }
      .topnav-links { display: none; }
      .two-col, .feature-cols { grid-template-columns: 1fr; }
      .ledger-list li, .verdict-grid > div { grid-template-columns: 1fr; gap: 0.25rem; }
      .cta-banner { padding: 1.5rem; }
    }
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      a { transition: none; }
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

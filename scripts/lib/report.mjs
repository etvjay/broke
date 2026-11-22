import { parseExpressionAt } from "acorn";
import { countKey } from "./coverage.mjs";
import { functionKey } from "./functions.mjs";

export function padNumber(number) {
  return String(number).padStart(4, "0");
}

// Markdown for one verify run. Each flow gets a section with Kane's verdict
// and a trace of the app functions its run covered. The drift table ends it.
export function renderReport({ number, head, flows, drift, driftNote = null, functions, explanations }) {
  const written = new Map(explanations.map((entry) => [functionKey(entry.file, entry.name), entry.explanation]));
  const status = new Map(
    drift.rows.filter((row) => row.name !== null).map((row) => [functionKey(row.file, row.name), row.explanation])
  );
  const lines = [
    `# Why It Broke report ${padNumber(number)}`,
    "",
    `Tested commit: ${head}`,
    "",
    "## Flows",
    "",
    "| Flow | Verdict | Detail |",
    "| --- | --- | --- |"
  ];
  for (const flow of flows) {
    lines.push(`| ${cell(flow.name)} | ${flow.outcome} | ${cell(detail(flow))} |`);
  }
  for (const flow of flows) {
    lines.push("", ...flowSection(flow, functions, written, status));
  }
  lines.push("", "## Drift", "", drift.ok ? "Drift check passed." : `Drift check failed: ${drift.problems.length} problem(s).`);
  if (driftNote) lines.push("", driftNote);
  if (drift.problems.length > 0) {
    lines.push("");
    for (const problem of drift.problems) lines.push(`- ${cell(problem.message)}`);
  }
  lines.push("", "| Location | Function | Explanation | Flows that ran it |", "| --- | --- | --- | --- |");
  for (const row of drift.rows) {
    lines.push(`| ${row.file}:${row.line} | ${cell(row.name ?? "(anonymous)")} | ${row.explanation} | ${flowsCell(row)} |`);
  }
  return `${lines.join("\n")}\n`;
}

function flowSection(flow, functions, written, status) {
  const lines = [`## ${flow.name}: ${flow.outcome}`, "", `- Verdict: ${flow.outcome}`, `- Reason: ${shown(flow.reason)}`];
  if (flow.verdict) lines.push(...verdictLines(flow.verdict));
  if (flow.evidence) lines.push(...evidenceLines(flow.evidence));
  if (flow.counts === null) {
    lines.push("", "No coverage for this run, so no trace is shown.");
    return lines;
  }
  const step = flow.verdict?.culprit_step;
  if (step !== undefined && step !== null) {
    lines.push("", `Kane's culprit step is ${step}. It is shown beside the trace and is not mapped to a function.`);
  }
  const ran = functions.filter((fn) => (flow.counts.get(countKey(fn.file, fn.startOffset)) ?? 0) > 0);
  lines.push("", ran.length === 0 ? "No app function ran in this flow." : "Functions that ran in this flow, in file order:");
  for (const fn of ran) lines.push("", ...traceEntry(fn, written, status));
  return lines;
}

function verdictLines(verdict) {
  return [
    `- Family: ${shown(verdict.family)}`,
    `- Category: ${shown(verdict.category)}`,
    `- Root cause: ${shown(verdict.root_cause)}`,
    `- Suggestion: ${shown(verdict.suggestion)}`,
    `- Fault assessment: ${shown(verdict.agent_fault_assessment)}`,
    `- Confidence: ${shown(verdict.confidence)}`
  ];
}

function evidenceLines(evidence) {
  if (evidence.status === "none" || evidence.status === "missing" || evidence.status === "error") {
    return [`- Evidence: not copied. ${evidence.reason}`];
  }
  const lines = [];
  if (evidence.status === "copied") {
    lines.push(`- Evidence: [redacted copy](${evidence.dir}/), ${evidence.files.length} text files, manifest sha256 ${evidence.manifest}`);
  } else {
    lines.push("- Evidence: no text file was copied.");
  }
  if (evidence.blocked.length > 0) {
    lines.push(`- Left out by the second scan: ${evidence.blocked.map((item) => `${item.path} (${item.kinds.join(", ")})`).join("; ")}`);
  }
  if (evidence.binarySkipped > 0) {
    lines.push(`- Not copied: screenshots and other binary files (${evidence.binarySkipped}).`);
  }
  return lines;
}

function traceEntry(fn, written, status) {
  const key = fn.name === null ? null : functionKey(fn.file, fn.name);
  const paragraphs = [];
  if (key === null) {
    paragraphs.push("This function is anonymous, so it has no explanation. Give it a name, then explain it.");
  } else if (!written.has(key)) {
    paragraphs.push("No explanation yet. The drift check fails until one is written.");
  } else {
    paragraphs.push(written.get(key));
    if (status.get(key) === "stale") {
      paragraphs.push("Stale: the code changed since this explanation was written. Update it with npm run explain.");
    }
  }
  paragraphs.push(`Signature: \`${signatureOf(fn)}\``);
  const lines = [`### ${fn.file}:${fn.line} ${fn.name ?? "(anonymous)"}`];
  for (const paragraph of paragraphs) lines.push("", paragraph);
  lines.push("", ...sourceBlock(fn.source));
  return lines;
}

// The header up to the body, on one line. A parameter can hold a brace, so the
// parser finds where the body starts.
function signatureOf(fn) {
  const body = parseExpressionAt(fn.source, 0, { ecmaVersion: "latest" }).body;
  return oneLine(fn.source.slice(0, body.start));
}

function sourceBlock(source) {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(source) + 1));
  return ["<details>", "<summary>Source</summary>", "", `${fence}js`, source, fence, "", "</details>"];
}

function longestBacktickRun(text) {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}

function flowsCell(row) {
  if (row.name === null) return "n/a";
  if (row.flows === null) return "not checked";
  return row.flows.length === 0 ? "none" : row.flows.join(", ");
}

function detail(flow) {
  if (flow.outcome !== "pass") return flow.reason;
  const credits = flow.credits === null ? "credits not reported" : `${flow.credits} credits`;
  return `${flow.reason}, ${flow.steps} steps, ${credits}, ${flow.seconds} s`;
}

function shown(value) {
  return value === undefined || value === null || value === "" ? "not reported" : oneLine(value);
}

function oneLine(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function cell(value) {
  return oneLine(value).replaceAll("|", "\\|");
}

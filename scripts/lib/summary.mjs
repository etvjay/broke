import { countKey } from "./coverage.mjs";
import { functionKey } from "./functions.mjs";

// Drift problems a racer can fix. Unrun functions are not here: racers cannot add flows.
export const FIXABLE_DRIFT = new Set(["missing", "stale", "anonymous", "duplicate", "removed"]);

// The summary verify writes next to each report. The race reads it to decide
// whether a red can start a race, and it reads each attempt's summary.
export function buildSummary({ number, testedCommit, flows, drift, functions, explanations, unrunChecked }) {
  const written = new Map(explanations.map((entry) => [functionKey(entry.file, entry.name), entry.explanation]));
  const statusAt = new Map(drift.rows.map((row) => [`${row.file}:${row.line}`, row.explanation]));
  return {
    number,
    testedCommit,
    outcome: outcomeOf(flows, drift),
    flows: flows.map((flow) => ({
      name: flow.name,
      outcome: flow.outcome,
      reason: flow.reason,
      verdict: flow.verdict,
      steps: flow.steps,
      credits: flow.credits,
      seconds: flow.seconds,
      trace: traceOf(flow, functions, written, statusAt)
    })),
    drift: {
      ok: drift.ok,
      skipped: !unrunChecked,
      problems: drift.problems.map(({ kind, file, name, line, message }) => ({ kind, file, name, line, message }))
    }
  };
}

export function outcomeOf(flows, drift) {
  if (flows.some((flow) => flow.outcome === "error")) return "error";
  if (flows.some((flow) => flow.outcome === "fail") || !drift.ok) return "fail";
  return "pass";
}

// Whether a red report starts a fix race, and why. Each rule is a stop for the owner.
export function classifyRed(summary) {
  if (summary.outcome !== "fail") return { race: false, reason: "The latest report is not red." };
  const problems = summary.drift?.problems ?? [];
  const errored = summary.flows.find((flow) => flow.outcome === "error");
  if (errored) return { race: false, reason: `${errored.name} errored. The owner decides.` };
  const unrun = problems.find((problem) => problem.kind === "unrun");
  if (unrun) {
    return { race: false, reason: `${unrun.file} ${unrun.name} ran in no flow. Racers cannot add flows, so the owner decides.` };
  }
  const failing = summary.flows.filter((flow) => flow.outcome === "fail");
  const notApp = failing.find((flow) => flow.verdict?.family !== "app_bug");
  if (notApp) {
    return {
      race: false,
      reason: `${notApp.name} does not put the fault in the app (family ${notApp.verdict?.family ?? "none"}). The owner decides.`
    };
  }
  const fixable = problems.filter((problem) => FIXABLE_DRIFT.has(problem.kind));
  if (failing.length === 0 && fixable.length === 0) {
    return { race: false, reason: "The report has no app fault and no fixable drift." };
  }
  const parts = [];
  if (failing.length > 0) parts.push(`app fault in ${failing.map((flow) => flow.name).join(", ")}`);
  if (fixable.length > 0) parts.push(`fixable drift (${[...new Set(fixable.map((problem) => problem.kind))].join(", ")})`);
  return { race: true, reason: `Starts a race: ${parts.join("; ")}.` };
}

function traceOf(flow, functions, written, statusAt) {
  if (flow.counts === null) return [];
  return functions
    .filter((fn) => (flow.counts.get(countKey(fn.file, fn.startOffset)) ?? 0) > 0)
    .map((fn) => ({
      file: fn.file,
      line: fn.line,
      name: fn.name,
      status: fn.name === null ? "anonymous" : statusAt.get(`${fn.file}:${fn.line}`),
      explanation: fn.name === null ? null : (written.get(functionKey(fn.file, fn.name)) ?? null)
    }));
}

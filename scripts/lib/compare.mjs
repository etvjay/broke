import { padNumber } from "./report.mjs";

// Lists the attempts side by side. It names no winner: the owner picks one.
export function renderComparison(attempts, { raceNumber, base, startReport = null }) {
  const lines = [`# Race ${padNumber(raceNumber)} comparison`, ""];
  if (startReport !== null) lines.push(startReport, "");
  lines.push(
    `Each attempt started from ${base}. This comparison names no winner. The owner picks one attempt with npm run race:pick.`,
    "",
    "| Attempt | Branch | Commit | Status | Reason | Files | Lines | Explanations changed | Flows | Drift |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const attempt of attempts) {
    lines.push(
      `| ${attempt.letter} | ${attempt.branch} | ${attempt.commit ?? "none"} | ${attempt.status} | ${cell(attempt.reason)} | ${attempt.files} | +${attempt.insertions} -${attempt.deletions} | ${attempt.explanationsChanged} | ${flowsCell(attempt.flows)} | ${driftCell(attempt.drift)} |`
    );
  }
  const failures = attempts.flatMap((attempt) => failuresOf(attempt).map((line) => `- Attempt ${attempt.letter}: ${line}`));
  lines.push("", "## Failing flows", "", ...(failures.length === 0 ? ["None."] : failures), "");
  return lines.join("\n");
}

// Each failing flow as "name: family, root cause", or as its reason when Kane gave no verdict.
export function failuresOf(attempt) {
  return (attempt.flows ?? [])
    .filter((flow) => flow.outcome !== "pass")
    .map((flow) => `${flow.name}: ${flow.verdict?.family ?? flow.outcome}, ${flow.verdict?.root_cause ?? flow.reason ?? "no reason"}`);
}

// Counts explanations whose text changed, plus those added or removed.
export function explanationChanges(before, after) {
  const key = (entry) => `${entry.file}#${entry.name}`;
  const was = new Map(before.map((entry) => [key(entry), entry.explanation]));
  const now = new Map(after.map((entry) => [key(entry), entry.explanation]));
  let changed = 0;
  for (const [name, text] of was) {
    if (!now.has(name) || now.get(name) !== text) changed += 1;
  }
  for (const name of now.keys()) {
    if (!was.has(name)) changed += 1;
  }
  return changed;
}

function flowsCell(flows) {
  if (flows === null) return "not verified";
  if (flows.length === 0) return "none";
  return ["pass", "fail", "error"]
    .map((outcome) => ({ outcome, count: flows.filter((flow) => flow.outcome === outcome).length }))
    .filter((part) => part.count > 0)
    .map((part) => `${part.count} ${part.outcome}`)
    .join(", ");
}

function driftCell(drift) {
  if (drift === null) return "not verified";
  return drift.ok ? "passed" : `failed, ${drift.problems} problem(s)`;
}

function cell(value) {
  return String(value).replace(/\s+/g, " ").trim().replaceAll("|", "\\|");
}

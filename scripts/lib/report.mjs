export function padNumber(number) {
  return String(number).padStart(4, "0");
}

// One row per flow, then the drift result.
export function renderReport({ number, head, flows, drift, driftNote }) {
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
  lines.push("", "## Drift", "", drift.ok ? "Drift check passed." : `Drift check failed: ${drift.problems.length} problem(s).`);
  if (driftNote) lines.push("", driftNote);
  if (drift.problems.length > 0) lines.push("");
  for (const problem of drift.problems) lines.push(`- ${cell(problem.message)}`);
  return `${lines.join("\n")}\n`;
}

function detail(flow) {
  if (flow.outcome !== "pass") return flow.reason;
  const credits = flow.credits === null ? "credits not reported" : `${flow.credits} credits`;
  return `${flow.reason}, ${flow.steps} steps, ${credits}, ${flow.seconds} s`;
}

function cell(value) {
  return String(value).replace(/\s+/g, " ").replaceAll("|", "\\|").trim();
}

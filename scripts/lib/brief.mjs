// The brief a racer gets: Kane's verdict, the explained trace of each failing
// flow, the drift problems, the rules, and what earlier attempts on this commit got wrong.
export function buildBrief({ head, summary, report, priorAttempts }) {
  const lines = [
    "# Fix the app",
    "",
    `Base commit: ${head}`,
    "",
    "A Kane run failed on this commit. Change the app so the failing flow passes and the drift check passes.",
    ""
  ];
  for (const flow of summary.flows.filter((item) => item.outcome === "fail")) {
    const verdict = flow.verdict ?? {};
    lines.push(
      `## Kane's verdict on ${flow.name}`,
      "",
      `- Family: ${verdict.family ?? "not reported"}`,
      `- Category: ${verdict.category ?? "not reported"}`,
      `- Root cause: ${verdict.root_cause ?? "not reported"}`,
      `- Suggestion: ${verdict.suggestion ?? "not reported"}`,
      `- Fault assessment: ${verdict.agent_fault_assessment ?? "not reported"}`,
      "",
      "### Trace: the app functions that ran in this flow, in file order",
      ""
    );
    for (const fn of flow.trace) {
      lines.push(`- ${fn.file}:${fn.line} ${fn.name ?? "(anonymous)"} [${fn.status}]: ${fn.explanation ?? "no explanation"}`);
    }
    lines.push("");
  }
  if (summary.drift.problems.length > 0) {
    lines.push("## Drift problems", "");
    for (const problem of summary.drift.problems) lines.push(`- ${problem.message}`);
    lines.push("");
  }
  lines.push(
    "## Rules",
    "",
    "- Change only files under `app/` and `explain/`.",
    "- Commit your fix with git. A racer that makes no commit fails.",
    "- After you change a function, update its explanation with npm run explain -- <file> <name> \"<one sentence>\", then run npm run drift.",
    "- Do not push. Do not edit `flows/`, `reports/`, `scripts/`, `.factory/`, or `AGENTS.md`.",
    "- Do not weaken a flow or the drift check to make it pass.",
    "",
    "## Earlier attempts on this commit",
    ""
  );
  if (priorAttempts.length === 0) lines.push("None.");
  for (const line of priorAttempts) lines.push(`- ${line}`);
  lines.push("", "## The report", "", report.trimEnd(), "");
  return lines.join("\n");
}

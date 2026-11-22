#!/usr/bin/env node
// Test double for kane-cli. FAKE_KANE_SCENARIO picks the outcome:
// pass (default), fail, no-run-end, or low-credits (balance only).
const scenario = process.env.FAKE_KANE_SCENARIO || "pass";
const args = process.argv.slice(2);
const JSON_HEADERS = { "content-type": "application/json" };

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function finish(code) {
  process.stdout.write("", () => process.exit(code));
}

async function exerciseApp(base) {
  const page = await fetch(`${base}/`);
  await page.text();
  const cookie = (page.headers.get("set-cookie") || "").split(";")[0];
  await (await fetch(`${base}/api/polls`)).json();
  const created = await fetch(`${base}/api/polls`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ question: "Lunch spot?", options: ["Noodles", "Tacos"] }) });
  const { poll } = await created.json();
  const refused = await fetch(`${base}/api/polls`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ question: "Only one?", options: ["Yes"] }) });
  await refused.json();
  const first = await fetch(`${base}/api/polls/${poll.id}/vote`, { method: "POST", headers: { ...JSON_HEADERS, cookie }, body: JSON.stringify({ option: 0 }) });
  await first.json();
  const repeat = await fetch(`${base}/api/polls/${poll.id}/vote`, { method: "POST", headers: { ...JSON_HEADERS, cookie }, body: JSON.stringify({ option: 1 }) });
  await repeat.json();
  await (await fetch(`${base}/api/polls`)).json();
  return created.status === 201 && refused.status === 400 && first.status === 200 && repeat.status === 409;
}

async function run() {
  const url = args[args.indexOf("--url") + 1];
  emit({ type: "stream_start" });
  const checked = await exerciseApp(url);
  emit({ step: 1, status: "done", remark: "opened the start page" });
  emit({ step: 2, status: "done", remark: "created a poll" });
  emit({ step: 3, status: checked ? "done" : "failed", remark: "voted" });
  if (scenario === "no-run-end") return finish(1);
  emit({ type: "coverage", status: "skipped", reason: "not_assurance_project", pack: process.env.FAKE_KANE_PACK || "/tmp/fake-kane.evidence" });
  if (scenario === "fail") {
    emit({
      type: "run_end",
      status: "failed",
      credits_consumed: 1.1,
      verdict: { confirmed: true, status: "failed", family: "app_bug", category: "functional", severity: "high", root_cause: process.env.FAKE_KANE_ROOT_CAUSE || "The vote count did not change", agent_fault_assessment: "app", confidence: 0.8, suggestion: "Check castVote", one_liner: "Vote did not count", culprit_step: 3, relevant_steps: [3], mode: "agent" }
    });
    return finish(1);
  }
  emit({ type: "run_end", status: "passed", credits_consumed: 1.25 });
  return finish(0);
}

if (args[0] === "balance") {
  process.stdout.write(`Available credits: ${scenario === "low-credits" ? "100.00" : "9000.00"}\n`);
  finish(0);
} else if (args[0] === "run") {
  await run();
} else {
  process.stderr.write(`fake kane: unsupported command ${args[0]}\n`);
  finish(2);
}

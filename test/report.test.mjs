import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDrift } from "../scripts/drift.mjs";
import { countKey } from "../scripts/lib/coverage.mjs";
import { functionKey, scanSource } from "../scripts/lib/functions.mjs";
import { renderReport } from "../scripts/lib/report.mjs";

const FILE = "app/store.mjs";
const HEAD = "a".repeat(40);
const SOURCE = `export function castVote(polls, option) {
  return polls[option];
}

function neverCalled() {
  return 1;
}

function tally(votes) {
  return votes + 1;
}
`;

const functions = scanSource(SOURCE, FILE);
const lineOf = (name) => functions.find((fn) => fn.name === name).line;
const headingOf = (name) => `### ${FILE}:${lineOf(name)} ${name}`;
const explanations = functions.map((fn) => ({ file: fn.file, name: fn.name, explanation: `Explains ${fn.name}.`, hash: fn.hash }));

function countsFor(names) {
  return new Map(functions.map((fn) => [countKey(fn.file, fn.startOffset), names.includes(fn.name) ? 2 : 0]));
}

const passFlow = {
  name: "poll-create.md",
  outcome: "pass",
  reason: "passed",
  verdict: null,
  steps: 12,
  credits: 21.35,
  seconds: 74.5,
  counts: countsFor(["castVote", "neverCalled"])
};
const failFlow = {
  name: "poll-vote.md",
  outcome: "fail",
  reason: "Vote did not count",
  verdict: {
    family: "app_bug",
    category: "functional",
    root_cause: "The vote count did not change",
    suggestion: "Check castVote",
    culprit_step: 3,
    confidence: 0.8,
    agent_fault_assessment: "app",
    one_liner: "Vote did not count"
  },
  steps: 3,
  credits: 1.1,
  seconds: 35.9,
  counts: countsFor(["castVote", "tally"])
};
const flows = [passFlow, failFlow];

function driftFor(list, explained) {
  const ranByFlow = {};
  for (const fn of list) {
    ranByFlow[functionKey(fn.file, fn.name)] = flows
      .filter((flow) => flow.counts.get(countKey(fn.file, fn.startOffset)) > 0)
      .map((flow) => flow.name);
  }
  return checkDrift({ functions: list, explanations: explained, ranByFlow });
}

const drift = driftFor(functions, explanations);
const report = renderReport({ number: 1, head: HEAD, flows, drift, functions, explanations });

function sectionOf(text, title) {
  const start = text.indexOf(`## ${title}`);
  assert.notEqual(start, -1, `no section titled ${title}`);
  const rest = text.slice(start + 3);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

test("the report names the tested commit", () => {
  assert.match(report, new RegExp(`^Tested commit: ${HEAD}$`, "m"));
});

test("a failed flow shows Kane's root cause, suggestion, and fault assessment", () => {
  const body = sectionOf(report, "poll-vote.md: fail");
  assert.match(body, /- Root cause: The vote count did not change/);
  assert.match(body, /- Suggestion: Check castVote/);
  assert.match(body, /- Fault assessment: app/);
  assert.match(body, /- Family: app_bug/);
  assert.match(body, /- Confidence: 0\.8/);
});

test("each trace lists only the functions that ran in that flow, in file order", () => {
  const passBody = sectionOf(report, "poll-create.md: pass");
  assert.ok(passBody.includes(headingOf("castVote")));
  assert.ok(passBody.includes(headingOf("neverCalled")));
  assert.ok(!passBody.includes(headingOf("tally")));
  const failBody = sectionOf(report, "poll-vote.md: fail");
  assert.ok(failBody.includes(headingOf("castVote")));
  assert.ok(failBody.includes(headingOf("tally")));
  assert.ok(!failBody.includes(headingOf("neverCalled")));
  assert.ok(failBody.indexOf(headingOf("castVote")) < failBody.indexOf(headingOf("tally")));
});

test("source sits inside a collapsed details block", () => {
  const body = sectionOf(report, "poll-create.md: pass");
  const details = body.match(/<details>[\s\S]*?<\/details>/g) ?? [];
  assert.equal(details.length, 2);
  assert.ok(details.some((block) => block.includes("function castVote(polls, option) {")));
  assert.ok(!body.replace(/<details>[\s\S]*?<\/details>/g, "").includes("function castVote(polls, option) {"));
});

test("Kane's culprit step sits beside the trace and is not mapped to a function", () => {
  const body = sectionOf(report, "poll-vote.md: fail");
  assert.match(body, /Kane's culprit step is 3\. It is shown beside the trace and is not mapped to a function/);
});

test("the drift table lists each function, its explanation, and the flows that ran it", () => {
  const drifting = report.slice(report.indexOf("## Drift"));
  assert.ok(drifting.includes(`| ${FILE}:${lineOf("castVote")} | castVote | current | poll-create.md, poll-vote.md |`));
  assert.ok(drifting.includes(`| ${FILE}:${lineOf("neverCalled")} | neverCalled | current | poll-create.md |`));
  assert.ok(drifting.includes(`| ${FILE}:${lineOf("tally")} | tally | current | poll-vote.md |`));
});

test("an explanation written before its function changed is marked stale", () => {
  const stale = explanations.map((entry) => (entry.name === "tally" ? { ...entry, hash: "0".repeat(64) } : entry));
  const text = renderReport({ number: 1, head: HEAD, flows, drift: driftFor(functions, stale), functions, explanations: stale });
  assert.match(sectionOf(text, "poll-vote.md: fail"), /Stale: the code changed/);
  assert.match(text, /Drift check failed: 1 problem/);
});

test("a flow that errored with no coverage says so instead of showing an empty trace", () => {
  const errored = {
    name: "poll-vote-once.md",
    outcome: "error",
    reason: "app failed to start: exit 1",
    verdict: null,
    steps: 0,
    credits: null,
    seconds: 0.2,
    counts: null
  };
  const text = renderReport({
    number: 1,
    head: HEAD,
    flows: [errored],
    drift,
    driftNote: "The ran-in-no-flow check was skipped.",
    functions,
    explanations
  });
  assert.match(sectionOf(text, "poll-vote-once.md: error"), /No coverage for this run/);
  assert.match(text, /The ran-in-no-flow check was skipped/);
});

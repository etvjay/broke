import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDrift } from "../scripts/drift.mjs";

const FILE = "app/store.mjs";

function fn(name, hash = `hash-of-${name}`, line = 1) {
  return { file: FILE, name, line, hash };
}

function explained(name, hash = `hash-of-${name}`) {
  return { file: FILE, name, explanation: `Explains ${name}.`, hash };
}

function kinds(result) {
  return result.problems.map((problem) => `${problem.kind} ${problem.name}`);
}

const RAN = { [`${FILE}#alpha`]: ["poll-vote.md"], [`${FILE}#beta`]: ["poll-create.md"] };

test("passes when every function is explained, current, and ran in a flow", () => {
  const result = checkDrift({
    functions: [fn("alpha"), fn("beta")],
    explanations: [explained("alpha"), explained("beta")],
    ranByFlow: RAN
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(
    result.rows.map((row) => [row.name, row.explanation, row.flows]),
    [["alpha", "current", ["poll-vote.md"]], ["beta", "current", ["poll-create.md"]]]
  );
});

test("flags a function with no explanation", () => {
  const result = checkDrift({ functions: [fn("alpha")], explanations: [], ranByFlow: RAN });
  assert.equal(result.ok, false);
  assert.deepEqual(kinds(result), ["missing alpha"]);
});

test("flags an explanation written for older source as stale", () => {
  const result = checkDrift({
    functions: [fn("alpha", "new-hash")],
    explanations: [explained("alpha", "old-hash")],
    ranByFlow: RAN
  });
  assert.deepEqual(kinds(result), ["stale alpha"]);
});

test("flags an explanation for a function that no longer exists", () => {
  const result = checkDrift({ functions: [], explanations: [explained("gone")], ranByFlow: {} });
  assert.deepEqual(kinds(result), ["removed gone"]);
});

test("flags a function that no flow ran", () => {
  const result = checkDrift({ functions: [fn("alpha")], explanations: [explained("alpha")], ranByFlow: {} });
  assert.deepEqual(kinds(result), ["unrun alpha"]);
});

test("skips the flow check when no flow data is given", () => {
  const result = checkDrift({ functions: [fn("alpha")], explanations: [explained("alpha")] });
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].flows, null);
});

test("flags an anonymous function with its file and line", () => {
  const result = checkDrift({ functions: [fn(null, "hash-anon", 4)], explanations: [] });
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].kind, "anonymous");
  assert.match(result.problems[0].message, /app\/store\.mjs:4/);
});

test("flags a name defined twice in one file, once", () => {
  const result = checkDrift({
    functions: [fn("alpha"), fn("alpha", "hash-of-alpha", 9)],
    explanations: [explained("alpha")]
  });
  assert.deepEqual(kinds(result), ["duplicate alpha"]);
});

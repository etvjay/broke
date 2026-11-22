import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyExplanation, readExplanations } from "../scripts/lib/explanations.mjs";

const FUNCTIONS = [
  { file: "app/store.mjs", name: "createPoll", line: 3, hash: "hash-create" },
  { file: "app/server.mjs", name: "handleRequest", line: 9, hash: "hash-handle" }
];

test("writes the explanation with the function's current hash", () => {
  const next = applyExplanation({
    functions: FUNCTIONS, explanations: [], file: "app/store.mjs", name: "createPoll", text: "Creates a poll."
  });
  assert.deepEqual(next, [{ file: "app/store.mjs", name: "createPoll", explanation: "Creates a poll.", hash: "hash-create" }]);
});

test("replaces an earlier explanation for the same function", () => {
  const earlier = [{ file: "app/store.mjs", name: "createPoll", explanation: "Old.", hash: "hash-old" }];
  const next = applyExplanation({
    functions: FUNCTIONS, explanations: earlier, file: "app/store.mjs", name: "createPoll", text: "New."
  });
  assert.deepEqual(next, [{ file: "app/store.mjs", name: "createPoll", explanation: "New.", hash: "hash-create" }]);
});

test("keeps the list sorted by file and then name", () => {
  let list = applyExplanation({
    functions: FUNCTIONS, explanations: [], file: "app/store.mjs", name: "createPoll", text: "Creates a poll."
  });
  list = applyExplanation({
    functions: FUNCTIONS, explanations: list, file: "app/server.mjs", name: "handleRequest", text: "Handles requests."
  });
  assert.deepEqual(list.map((entry) => `${entry.file}#${entry.name}`), ["app/server.mjs#handleRequest", "app/store.mjs#createPoll"]);
});

test("refuses a function name that is not in the app", () => {
  assert.throws(
    () => applyExplanation({ functions: FUNCTIONS, explanations: [], file: "app/store.mjs", name: "nope", text: "Text." }),
    /no named function nope in app\/store\.mjs/
  );
});

test("refuses an empty explanation", () => {
  assert.throws(
    () => applyExplanation({ functions: FUNCTIONS, explanations: [], file: "app/store.mjs", name: "createPoll", text: "   " }),
    /empty/
  );
});

test("refuses an explanation with an em dash", () => {
  assert.throws(
    () => applyExplanation({ functions: FUNCTIONS, explanations: [], file: "app/store.mjs", name: "createPoll", text: "Creates a poll \u2014 fast." }),
    /em dash/
  );
});

test("reads an empty list when the explanation file does not exist yet", async () => {
  assert.deepEqual(await readExplanations(join(tmpdir(), `missing-${randomUUID()}.json`)), []);
});

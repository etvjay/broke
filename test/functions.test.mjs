import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scanApp, scanSource } from "../scripts/lib/functions.mjs";

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function withAppTree(files, run) {
  const root = await mkdtemp(join(tmpdir(), "why-it-broke-scan-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      const full = join(root, "app", path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, text);
    }
    return await run(join(root, "app"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("names each declared function with its line and source offsets", () => {
  const source = "export function alpha() {\n  return 1;\n}\n\nfunction beta() {}\n";
  const found = scanSource(source, "app/x.mjs");
  assert.deepEqual(found.map((fn) => [fn.name, fn.line]), [["alpha", 1], ["beta", 5]]);
  assert.equal(source.slice(found[0].startOffset, found[0].endOffset), "function alpha() {\n  return 1;\n}");
});

test("hash is the SHA-256 of the function's own source text", () => {
  const [fn] = scanSource("function alpha() {\n  return 1;\n}\n", "app/x.mjs");
  assert.equal(fn.hash, sha256("function alpha() {\n  return 1;\n}"));
});

test("editing one function leaves another function's hash unchanged", () => {
  const before = scanSource("function a() { return 1; }\nfunction b() { return 2; }\n", "app/x.mjs");
  const after = scanSource("function a() { return 1; }\nfunction b() { return 3; }\n", "app/x.mjs");
  assert.equal(before[0].hash, after[0].hash);
  assert.notEqual(before[1].hash, after[1].hash);
});

test("adding a function above moves a line number but keeps the hash", () => {
  const before = scanSource("function b() { return 2; }\n", "app/x.mjs");
  const after = scanSource("function a() {}\nfunction b() { return 2; }\n", "app/x.mjs");
  assert.equal(after[1].line, 2);
  assert.equal(before[0].hash, after[1].hash);
});

test("anonymous functions get a null name", () => {
  const found = scanSource("const f = () => 1;\nlist.map(function (x) { return x; });\n", "app/x.mjs");
  assert.deepEqual(found.map((fn) => fn.name), [null, null]);
});

test("a named function expression keeps its name", () => {
  const [fn] = scanSource("const g = function named() { return 1; };\n", "app/x.mjs");
  assert.equal(fn.name, "named");
});

test("non-ASCII source is refused with the file, line, and code point", () => {
  assert.throws(
    () => scanSource("function a() {\n  return 'caf\u00e9';\n}\n", "app/x.mjs"),
    /app\/x\.mjs:2:\d+ has non-ASCII character U\+00E9/
  );
});

test("scanApp reads only .mjs files under app and labels them from the repo root", async () => {
  await withAppTree({ "store.mjs": "function a() {}\n", "public/app.js": "function b() {}\n", "public/extra.mjs": "function c() {}\n" }, async (appDir) => {
    const found = await scanApp(appDir);
    assert.deepEqual(found.map((fn) => `${fn.file}#${fn.name}`).sort(), ["app/public/extra.mjs#c", "app/store.mjs#a"]);
  });
});

test("scanApp refuses a non-ASCII file", async () => {
  await withAppTree({ "store.mjs": "function a() { return 'caf\u00e9'; }\n" }, async (appDir) => {
    await assert.rejects(scanApp(appDir), /app\/store\.mjs:1:\d+ has non-ASCII character U\+00E9/);
  });
});

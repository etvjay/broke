import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File } from "../scripts/lib/hash.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FLOWS = ["poll-create.md", "poll-vote.md", "poll-vote-once.md"];

async function readApprovals() {
  return JSON.parse(await readFile(join(ROOT, "flows", "approvals.json"), "utf8"));
}

test("each flow exists, is not empty, and has no URL or credential", async () => {
  for (const name of FLOWS) {
    const text = await readFile(join(ROOT, "flows", name), "utf8");
    assert.ok(text.trim().length > 0, `${name} is empty`);
    assert.doesNotMatch(text, /http/i, `${name} contains a URL`);
    assert.doesNotMatch(text, /password|api[_ ]?key|token/i, `${name} mentions a credential`);
  }
});

test("every approved hash matches the flow file on disk", async () => {
  const approvals = await readApprovals();
  for (const [name, hash] of Object.entries(approvals)) {
    assert.equal(await sha256File(join(ROOT, "flows", name)), hash, `${name} changed since approval`);
  }
});

test("every flow has an owner approval (owner runs npm run flows:approve)", async () => {
  const approvals = await readApprovals();
  for (const name of FLOWS) {
    assert.ok(approvals[name], `${name} is not approved yet`);
  }
});

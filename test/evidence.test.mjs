import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareEvidence, writeEvidenceFiles } from "../scripts/lib/evidence.mjs";
import { PACK_ENTRIES, zipEntries } from "./fixtures/evidence-pack.mjs";

const temps = [];

after(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "wib-evidence-test-"));
  temps.push(dir);
  return dir;
}

async function packFile() {
  const path = join(await tempDir(), "pack.evidence");
  await writeFile(path, zipEntries(PACK_ENTRIES));
  return path;
}

test("a pack is redacted and scanned: text is copied, a token file is left out, images are counted", async () => {
  const evidence = await prepareEvidence({ packPath: await packFile(), dir: "evidence/0001/poll-create" });
  assert.equal(evidence.status, "copied");
  const copied = Object.fromEntries(evidence.files.map((file) => [file.path, file.content]));
  assert.equal(copied["run.yaml"], "run: open the start page\nstatus: passed\n");
  assert.match(copied["tests/open-page/logs/tui.log"], /Profile <profile> opened ~\/kane\/app\/server\.mjs/);
  assert.match(copied["tests/open-page/result.yaml"], /owner: <email>/);
  assert.match(copied["tests/open-page/logs/network.log"], /GET http:\/\/<ip>:3100\/ Cookie: <redacted>/);
  assert.equal(copied["tests/open-page/logs/token.log"], undefined);
  assert.deepEqual(evidence.blocked, [{ path: "tests/open-page/logs/token.log", kinds: ["token"] }]);
  assert.equal(evidence.binarySkipped, 1);
  assert.match(evidence.manifest, /^[0-9a-f]{64}$/);
});

test("the manifest is the same for the same pack", async () => {
  const path = await packFile();
  const first = await prepareEvidence({ packPath: path, dir: "evidence/0001/a" });
  const second = await prepareEvidence({ packPath: path, dir: "evidence/0001/a" });
  assert.equal(first.manifest, second.manifest);
});

test("no pack path means no evidence, and a missing pack is reported", async () => {
  assert.equal((await prepareEvidence({ packPath: null, dir: "evidence/0001/a" })).status, "none");
  const missing = await prepareEvidence({ packPath: join(await tempDir(), "gone.evidence"), dir: "evidence/0001/a" });
  assert.equal(missing.status, "missing");
  assert.deepEqual(missing.files, []);
});

test("a pack that unzip cannot read is an error, and nothing is copied from it", async () => {
  const path = join(await tempDir(), "bad.evidence");
  await writeFile(path, "not a zip\n");
  const broken = await prepareEvidence({ packPath: path, dir: "evidence/0001/a" });
  assert.equal(broken.status, "error");
  assert.deepEqual(broken.files, []);
});

test("writeEvidenceFiles writes the redacted copy under the target folder", async () => {
  const evidence = await prepareEvidence({ packPath: await packFile(), dir: "evidence/0001/poll-create" });
  const target = join(await tempDir(), "evidence", "0001", "poll-create");
  await writeEvidenceFiles(target, evidence.files);
  assert.match(await readFile(join(target, "tests/open-page/logs/tui.log"), "utf8"), /<profile>/);
  await assert.rejects(readFile(join(target, "tests/open-page/logs/token.log")), { code: "ENOENT" });
});

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { sha256File } from "./lib/hash.mjs";

const FLOWS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "flows");
const APPROVALS_FILE = join(FLOWS_DIR, "approvals.json");

const approvals = await readApprovals(APPROVALS_FILE);
const names = (await readdir(FLOWS_DIR)).filter((name) => name.endsWith(".md")).sort();
const rows = [];
for (const name of names) {
  const hash = await sha256File(join(FLOWS_DIR, name));
  rows.push({ name, hash, status: statusOf(approvals[name], hash) });
}

for (const row of rows) {
  console.log(`${row.status.padEnd(9)} ${row.hash.slice(0, 12)}  flows/${row.name}`);
}

if (rows.every((row) => row.status === "approved")) {
  console.log("All flows are approved. Nothing to do.");
  process.exit(0);
}
if (!process.stdin.isTTY) {
  console.error("Approval needs a terminal. Nothing written.");
  process.exit(2);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question('Read the flows above. Type "approve" to record these hashes: ');
rl.close();
if (answer.trim() !== "approve") {
  console.log("Not approved. Nothing written.");
  process.exit(1);
}

const next = Object.fromEntries(rows.map((row) => [row.name, row.hash]));
await writeFile(APPROVALS_FILE, `${JSON.stringify(next, null, 2)}\n`);
console.log(`Recorded ${rows.length} approvals in flows/approvals.json. Commit that file.`);

async function readApprovals(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function statusOf(approvedHash, hash) {
  if (approvedHash === undefined) return "new";
  return approvedHash === hash ? "approved" : "changed";
}

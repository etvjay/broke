import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { redact, scanSecrets } from "./redact.mjs";

const run = promisify(execFile);
const IMAGE = /\.(?:jpe?g|png|gif|webp)$/i;

// Unpacks a Kane evidence pack (a zip), redacts each text file, and scans it
// again. Returns what may be copied. Nothing is written to the repo here.
export async function prepareEvidence({ packPath, dir }) {
  const none = { dir, status: "none", reason: "Kane reported no evidence pack.", files: [], blocked: [], binarySkipped: 0, manifest: null };
  if (!packPath) return none;
  if (!(await exists(packPath))) return { ...none, status: "missing", reason: "Kane's evidence pack is not on disk." };
  const scratch = await mkdtemp(join(tmpdir(), "wib-evidence-"));
  try {
    await run("unzip", ["-q", "-o", packPath, "-d", scratch]);
    return await copyable(scratch, dir);
  } catch (error) {
    return { ...none, status: "error", reason: `Could not read the evidence pack: ${firstLine(error.stderr || error.message)}` };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

// Writes clean copies under targetDir, keeping the pack's folder layout.
export async function writeEvidenceFiles(targetDir, files) {
  for (const file of files) {
    const target = join(targetDir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

async function copyable(scratch, dir) {
  const files = [];
  const blocked = [];
  let binarySkipped = 0;
  for (const path of await listFiles(scratch)) {
    const bytes = await readFile(join(scratch, path));
    if (IMAGE.test(path) || bytes.includes(0)) {
      binarySkipped += 1;
      continue;
    }
    const content = redact(bytes.toString("utf8"));
    const kinds = scanSecrets(content);
    if (kinds.length > 0) blocked.push({ path, kinds });
    else files.push({ path, content, sha256: sha256(content) });
  }
  const copied = files.length > 0;
  return {
    dir,
    status: copied ? "copied" : "empty",
    reason: copied ? null : "No text file was copied.",
    files,
    blocked,
    binarySkipped,
    manifest: copied ? sha256(files.map((file) => `${file.sha256}  ${file.path}\n`).join("")) : null
  };
}

async function listFiles(root, prefix = "") {
  const found = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await listFiles(root, path)));
    else if (entry.isFile()) found.push(path);
  }
  return found.sort();
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function firstLine(text) {
  return String(text).trim().split("\n")[0];
}

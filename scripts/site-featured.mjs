import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ROOT } from "./config.mjs";
import { padNumber } from "./lib/report.mjs";
import { parseRootFailureYaml } from "./site.mjs";

const IMAGE_FILES = ["screenshot.jpg", "annotated.png"];

// Extracts candidate screenshots for a red run (and optional green run) outside the repo,
// matching the green step strictly by step.json summary, never by step number.
export async function extractFeatured({ root = ROOT, redNumber, greenNumber = null, log = () => {} }) {
  if (!redNumber) throw new Error("usage: npm run site:featured -- NNNN [MMMM]");
  const redPad = padNumber(Number(redNumber));
  const summaryPath = join(root, "reports", `${redPad}.json`);
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  const failingFlow = (summary.flows ?? []).find((flow) => flow.outcome === "fail");
  if (!failingFlow) throw new Error(`report ${redPad} has no failing flow`);
  const flowBase = failingFlow.name.replace(/\.md$/, "");

  const redEvidenceDir = join(root, "reports", "evidence", redPad, flowBase);
  const failureRows = parseRootFailureYaml(await readFile(join(redEvidenceDir, "failure.yaml"), "utf8"));
  if (failureRows.length === 0 || !failureRows[0].path) {
    throw new Error(`report ${redPad} ${flowBase} failure.yaml has no failing step row`);
  }
  const redStepDir = dirname(failureRows[0].path).replaceAll("\\", "/");
  const redRunId = parseRunId(await readFile(join(redEvidenceDir, "run.yaml"), "utf8"));
  if (!redRunId) throw new Error(`report ${redPad} ${flowBase} run.yaml has no run_id`);

  const redPack = await findPackByRunId(redRunId);
  if (!redPack) throw new Error(`could not find evidence pack for run_id ${redRunId}`);
  const redEntries = new Set(await listZipEntries(redPack.fullPath));
  const stepJsonEntry = `${redStepDir}/step.json`;
  if (!redEntries.has(stepJsonEntry)) {
    throw new Error(`pack ${redPack.displayPath} has no ${stepJsonEntry}`);
  }
  const redStep = JSON.parse((await extractZipBuffer(redPack.fullPath, stepJsonEntry)).toString("utf8"));
  const targetSummary = redStep.summary;
  if (typeof targetSummary !== "string" || targetSummary.trim() === "") {
    throw new Error(`step ${redStepDir} in ${redPack.displayPath} has no summary`);
  }

  const redOutDir = join(homedir(), ".why-it-broke", "featured", redPad);
  await mkdir(redOutDir, { recursive: true });
  const redCopied = await copyStepImages(redPack.fullPath, redEntries, redStepDir, redOutDir);
  const redMatchesText = [
    `report: ${redPad}`,
    `flow: ${failingFlow.name}`,
    `summary: ${targetSummary}`,
    `pack: ${redPack.displayPath}`,
    `step: ${redStepDir}`,
    `matches: 1`,
    `files: ${redCopied.length > 0 ? redCopied.join(", ") : "none"}`,
    ""
  ].join("\n");
  await writeFile(join(redOutDir, "matches.txt"), redMatchesText, "utf8");
  log(`red ${redPad}: summary="${targetSummary}" pack=${redPack.displayPath} files=${redCopied.join(", ") || "none"}`);

  let greenResult = null;
  if (greenNumber !== null && greenNumber !== undefined && String(greenNumber).trim() !== "") {
    const greenPad = padNumber(Number(greenNumber));
    const greenEvidenceDir = join(root, "reports", "evidence", greenPad, flowBase);
    const greenRunId = parseRunId(await readFile(join(greenEvidenceDir, "run.yaml"), "utf8"));
    if (!greenRunId) throw new Error(`report ${greenPad} ${flowBase} run.yaml has no run_id`);
    const greenPack = await findPackByRunId(greenRunId);
    if (!greenPack) throw new Error(`could not find evidence pack for run_id ${greenRunId}`);
    const greenEntriesList = await listZipEntries(greenPack.fullPath);
    const greenEntries = new Set(greenEntriesList);

    const matchedDirs = [];
    for (const entry of greenEntriesList) {
      if (!entry.endsWith("/step.json")) continue;
      const stepJson = JSON.parse((await extractZipBuffer(greenPack.fullPath, entry)).toString("utf8"));
      if (stepJson.summary === targetSummary) {
        matchedDirs.push(dirname(entry).replaceAll("\\", "/"));
      }
    }

    const greenOutDir = join(homedir(), ".why-it-broke", "featured", greenPad);
    await mkdir(greenOutDir, { recursive: true });
    let greenCopied = [];
    let statusNote = "";
    if (matchedDirs.length === 1) {
      greenCopied = await copyStepImages(greenPack.fullPath, greenEntries, matchedDirs[0], greenOutDir);
      statusNote = `1 match (${matchedDirs[0]})`;
      log(`green ${greenPad}: summary="${targetSummary}" pack=${greenPack.displayPath} step=${matchedDirs[0]} files=${greenCopied.join(", ") || "none"}`);
    } else if (matchedDirs.length === 0) {
      statusNote = "0 matches; nothing copied";
      log(`green ${greenPad}: 0 matches for summary="${targetSummary}" in ${greenPack.displayPath}; nothing copied.`);
    } else {
      statusNote = `${matchedDirs.length} matches (${matchedDirs.join(", ")}); ambiguous, nothing copied`;
      log(`green ${greenPad}: ${matchedDirs.length} matches for summary="${targetSummary}" in ${greenPack.displayPath}; nothing copied.`);
    }
    const greenMatchesText = [
      `report: ${greenPad}`,
      `flow: ${failingFlow.name}`,
      `summary: ${targetSummary}`,
      `pack: ${greenPack.displayPath}`,
      `result: ${statusNote}`,
      `files: ${greenCopied.length > 0 ? greenCopied.join(", ") : "none"}`,
      ""
    ].join("\n");
    await writeFile(join(greenOutDir, "matches.txt"), greenMatchesText, "utf8");
    greenResult = { pad: greenPad, summary: targetSummary, pack: greenPack.displayPath, matchedDirs, copied: greenCopied };
  }

  return {
    red: { pad: redPad, summary: targetSummary, pack: redPack.displayPath, stepDir: redStepDir, copied: redCopied },
    green: greenResult
  };
}

function parseRunId(yamlText) {
  const match = /^run_id:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(yamlText);
  return match ? match[1] : null;
}

async function findPackByRunId(runId) {
  const sessionsRoot = join(homedir(), ".testmuai", "kaneai", "sessions");
  let sessions;
  try {
    sessions = await readdir(sessionsRoot);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  for (const session of sessions.sort()) {
    const candidate = join(sessionsRoot, session, "evidence", `${runId}.evidence`);
    try {
      await stat(candidate);
      return {
        fullPath: candidate,
        displayPath: `~/.testmuai/kaneai/sessions/${session}/evidence/${runId}.evidence`
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function copyStepImages(packPath, entries, stepDir, outDir) {
  const copied = [];
  for (const file of IMAGE_FILES) {
    const entry = `${stepDir}/${file}`;
    if (!entries.has(entry)) continue;
    const data = await extractZipBuffer(packPath, entry);
    await writeFile(join(outDir, basename(file)), data);
    copied.push(file);
  }
  return copied;
}

function listZipEntries(packPath) {
  return new Promise((resolvePromise, reject) => {
    execFile("unzip", ["-Z1", packPath], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === "ENOENT") {
          reject(new Error("unzip is required to read Kane evidence packs, but it is not installed or not on PATH."));
        } else {
          reject(new Error(`unzip -Z1 failed: ${stderr.trim() || error.message}`));
        }
        return;
      }
      resolvePromise(stdout.split("\n").map((line) => line.trim()).filter(Boolean));
    });
  });
}

function extractZipBuffer(packPath, entry) {
  return new Promise((resolvePromise, reject) => {
    execFile("unzip", ["-p", packPath, entry], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === "ENOENT") {
          reject(new Error("unzip is required to read Kane evidence packs, but it is not installed or not on PATH."));
        } else {
          reject(new Error(`unzip -p failed for ${entry}: ${stderr.toString("utf8").trim() || error.message}`));
        }
        return;
      }
      resolvePromise(stdout);
    });
  });
}

const isMain = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { root: { type: "string" } }
  });
  const root = values.root === undefined ? ROOT : resolve(values.root);
  extractFeatured({
    root,
    redNumber: positionals[0],
    greenNumber: positionals[1] ?? null,
    log: (line) => console.log(line)
  }).catch((error) => {
    console.error(`site:featured: ${error.message}`);
    process.exitCode = 1;
  });
}

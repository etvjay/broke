import { pathToFileURL } from "node:url";
import { APP_DIR, EXPLAIN_FILE } from "./config.mjs";
import { readExplanations } from "./lib/explanations.mjs";
import { functionKey, scanApp } from "./lib/functions.mjs";

export function checkDrift({ functions, explanations, ranByFlow }) {
  const problems = [];
  const rows = [];
  const explainedBy = new Map(explanations.map((entry) => [functionKey(entry.file, entry.name), entry]));
  const counts = new Map();
  for (const fn of functions) {
    if (fn.name === null) continue;
    const key = functionKey(fn.file, fn.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const reportedDuplicates = new Set();
  for (const fn of functions) {
    if (fn.name === null) {
      problems.push(problem("anonymous", fn, `${fn.file}:${fn.line} is an anonymous function. Give it a name.`));
      rows.push({ file: fn.file, name: null, line: fn.line, explanation: "anonymous", flows: null });
      continue;
    }
    const key = functionKey(fn.file, fn.name);
    if (counts.get(key) > 1 && !reportedDuplicates.has(key)) {
      reportedDuplicates.add(key);
      problems.push(problem("duplicate", fn, `${fn.file} ${fn.name} is defined more than once. Names must be unique per file.`));
    }
    const entry = explainedBy.get(key);
    let explanation = "current";
    if (!entry) {
      explanation = "missing";
      problems.push(problem("missing", fn, `${fn.file} ${fn.name} has no explanation. Run npm run explain.`));
    } else if (entry.hash !== fn.hash) {
      explanation = "stale";
      problems.push(problem("stale", fn, `${fn.file} ${fn.name} changed after its explanation was written. Update the explanation.`));
    }
    let flows = null;
    if (ranByFlow) {
      flows = ranByFlow[key] ?? [];
      if (flows.length === 0) {
        problems.push(problem("unrun", fn, `${fn.file} ${fn.name} ran in no flow. Add a flow that reaches it, or remove it.`));
      }
    }
    rows.push({ file: fn.file, name: fn.name, line: fn.line, explanation, flows });
  }
  const known = new Set(functions.filter((fn) => fn.name !== null).map((fn) => functionKey(fn.file, fn.name)));
  for (const entry of explanations) {
    const key = functionKey(entry.file, entry.name);
    if (!known.has(key)) {
      problems.push({
        kind: "removed",
        file: entry.file,
        name: entry.name,
        line: null,
        message: `explanation for ${key} names a function that no longer exists. Remove the entry.`
      });
    }
  }
  return { ok: problems.length === 0, problems, rows };
}

function problem(kind, fn, message) {
  return { kind, file: fn.file, name: fn.name, line: fn.line, message };
}

const isMain = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}

async function main() {
  const functions = await scanApp(APP_DIR);
  const explanations = await readExplanations(EXPLAIN_FILE);
  const result = checkDrift({ functions, explanations });
  for (const row of result.rows) {
    console.log(`${row.explanation.padEnd(9)} ${row.file}:${row.line}  ${row.name ?? "(anonymous)"}`);
  }
  for (const item of result.problems) console.log(`PROBLEM ${item.message}`);
  console.log(result.ok ? "Drift check passed." : `Drift check failed: ${result.problems.length} problem(s).`);
  console.log("Flow coverage is checked by npm run verify.");
  process.exitCode = result.ok ? 0 : 1;
}

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export function countKey(file, startOffset) {
  return `${file}:${startOffset}`;
}

// Reads every V8 coverage file in coverageDir and returns invocation counts
// for app functions, keyed by countKey(file, startOffset).
export async function readRun(coverageDir, appDir) {
  const names = await coverageFiles(coverageDir);
  if (names.length === 0) throw new Error(`no coverage files in ${coverageDir}`);
  const base = dirname(appDir);
  const counts = new Map();
  for (const name of names) {
    const report = JSON.parse(await readFile(join(coverageDir, name), "utf8"));
    for (const script of report.result) {
      if (!script.url.startsWith("file:")) continue;
      const rel = relative(base, fileURLToPath(script.url));
      if (!rel.startsWith(`app${sep}`)) continue;
      const file = rel.split(sep).join("/");
      for (const fn of script.functions) {
        const [range] = fn.ranges;
        const key = countKey(file, range.startOffset);
        counts.set(key, (counts.get(key) ?? 0) + range.count);
      }
    }
  }
  return counts;
}

async function coverageFiles(dir) {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

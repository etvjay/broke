import { pathToFileURL } from "node:url";
import { APP_DIR, EXPLAIN_FILE } from "./config.mjs";
import { applyExplanation, readExplanations, writeExplanations } from "./lib/explanations.mjs";
import { scanApp } from "./lib/functions.mjs";

const USAGE = 'usage: npm run explain -- <file> <name> "<text>"';

const isMain = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}

async function main(args) {
  if (args.length !== 3) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const [file, name, text] = args;
  const functions = await scanApp(APP_DIR);
  const explanations = await readExplanations(EXPLAIN_FILE);
  const next = applyExplanation({ functions, explanations, file, name, text });
  await writeExplanations(EXPLAIN_FILE, next);
  const target = functions.find((fn) => fn.file === file && fn.name === name);
  console.log(`Wrote explanation for ${file} ${name} (hash ${target.hash.slice(0, 12)}).`);
}

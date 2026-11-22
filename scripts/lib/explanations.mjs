import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { functionKey } from "./functions.mjs";

export const EXPLANATION_MAX = 400;

export async function readExplanations(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const list = JSON.parse(text);
  if (!Array.isArray(list)) throw new Error(`${file} must hold a JSON list`);
  return list;
}

export async function writeExplanations(file, list) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(sortEntries(list), null, 2)}\n`);
}

export function applyExplanation({ functions, explanations, file, name, text }) {
  const target = functions.find((fn) => fn.file === file && fn.name === name);
  if (!target) {
    throw new Error(`no named function ${name} in ${file}; list them with npm run drift`);
  }
  const entry = { file, name, explanation: cleanExplanation(text), hash: target.hash };
  const key = functionKey(file, name);
  const others = explanations.filter((item) => functionKey(item.file, item.name) !== key);
  return sortEntries([...others, entry]);
}

function cleanExplanation(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) throw new Error("explanation is empty");
  if (text.length > EXPLANATION_MAX) {
    throw new Error(`explanation must be ${EXPLANATION_MAX} characters or fewer`);
  }
  if (text.includes("\u2014")) {
    throw new Error("explanation has an em dash; use a comma, parentheses, or a new sentence");
  }
  return text;
}

function sortEntries(list) {
  return [...list].sort((a, b) => compareText(a.file, b.file) || compareText(a.name, b.name));
}

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

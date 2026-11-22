import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { parse } from "acorn";

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

export async function scanApp(appDir) {
  const names = (await readdir(appDir, { recursive: true })).filter((name) => name.endsWith(".mjs")).sort();
  const found = [];
  for (const name of names) {
    const path = join(appDir, name);
    const file = relative(dirname(appDir), path).split(sep).join("/");
    found.push(...scanSource(await readFile(path, "utf8"), file));
  }
  return found;
}

export function scanSource(source, file) {
  const stray = findNonAscii(source);
  if (stray) {
    throw new Error(
      `${file}:${stray.line}:${stray.column} has non-ASCII character U+${stray.hex}. ` +
        "App source must be ASCII, or V8 offsets and function hashes stop matching."
    );
  }
  const tree = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const nodes = [];
  collectFunctions(tree, nodes);
  return nodes
    .sort((a, b) => a.start - b.start)
    .map((node) => toFunctionInfo(source, file, node));
}

export function functionKey(file, name) {
  return `${file}#${name}`;
}

function findNonAscii(source) {
  let line = 1;
  let column = 1;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.codePointAt(index);
    if (code > 127) {
      return { line, column, hex: code.toString(16).toUpperCase().padStart(4, "0") };
    }
    if (code === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return null;
}

function collectFunctions(node, found) {
  if (Array.isArray(node)) {
    for (const child of node) collectFunctions(child, found);
    return;
  }
  if (!node || typeof node.type !== "string") return;
  if (FUNCTION_TYPES.has(node.type)) found.push(node);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collectFunctions(value, found);
  }
}

function toFunctionInfo(source, file, node) {
  const text = source.slice(node.start, node.end);
  return {
    file,
    name: node.id ? node.id.name : null,
    startOffset: node.start,
    endOffset: node.end,
    line: lineAt(source, node.start),
    source: text,
    hash: createHash("sha256").update(text, "utf8").digest("hex")
  };
}

function lineAt(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

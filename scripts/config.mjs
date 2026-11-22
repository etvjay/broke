import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const APP_DIR = join(ROOT, "app");
export const EXPLAIN_FILE = join(ROOT, "explain", "functions.json");

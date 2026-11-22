import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const APP_DIR = join(ROOT, "app");
export const EXPLAIN_FILE = join(ROOT, "explain", "functions.json");

export const FLOWS = ["poll-create", "poll-vote", "poll-vote-once"];
export const KANE_BIN = "kane-cli";
export const CREDIT_FLOOR = 2000;
// About 4 times the slowest probe run (74.5 s wall).
export const FLOW_TIMEOUT_S = 300;
export const KANE_MAX_STEPS = 50;
// Kane reaches the app on localhost. No tunnel is built.
export const TUNNEL_MODE = "local";
export const APP_BOOT_TIMEOUT_MS = 15000;
export const STOP_TIMEOUT_MS = 10000;

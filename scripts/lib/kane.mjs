import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { FLOW_TIMEOUT_S, KANE_MAX_STEPS } from "../config.mjs";

const KILL_AFTER_MS = 60000;

// Runs one flow with kane-cli. The flow text is the objective argument,
// spawned without a shell. Kane's NDJSON events are parsed from stdout.
export async function runKane({ kaneBin, env, flowFile, url, timeoutS = FLOW_TIMEOUT_S, maxSteps = KANE_MAX_STEPS }) {
  const objective = await readFile(flowFile, "utf8");
  const args = [
    "run",
    objective,
    "--target", "desktop",
    "--headless",
    "--agent",
    "--timeout", String(timeoutS),
    "--max-steps", String(maxSteps),
    "--url", url
  ];
  const child = spawn(kaneBin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const killer = setTimeout(() => child.kill("SIGKILL"), timeoutS * 1000 + KILL_AFTER_MS);
  let exitCode;
  let signal;
  try {
    [exitCode, signal] = await once(child, "close");
  } finally {
    clearTimeout(killer);
  }
  const events = parseEvents(stdout);
  const runEnd = lastOfType(events, "run_end");
  const coverage = lastOfType(events, "coverage");
  return {
    exitCode,
    signal,
    stderr,
    events,
    steps: events.filter(isStep),
    runEnd,
    verdict: runEnd?.status === "failed" ? (runEnd.verdict ?? null) : null,
    creditsConsumed: runEnd?.credits_consumed ?? null,
    lastEventType: events.length > 0 ? typeOf(events.at(-1)) : null,
    packPath: coverage?.pack ?? null
  };
}

// Maps a Kane run to pass, fail, or error. Only run_end decides the outcome.
export function classifyRun({ exitCode, signal = null, runEnd, lastEventType = null }) {
  const exit = signal ? `killed by ${signal}` : `exit ${exitCode}`;
  if (!runEnd) return errorResult(`no run_end (${exit}, last event ${lastEventType ?? "none"})`);
  if (runEnd.status === "passed") {
    return exitCode === 0 ? { outcome: "pass", reason: "passed" } : errorResult(`run_end says passed but Kane ${exit}`);
  }
  if (runEnd.status === "failed") {
    if (!runEnd.verdict) return errorResult("run_end says failed but has no verdict");
    if (exitCode !== 1) return errorResult(`run_end says failed but Kane ${exit}`);
    return { outcome: "fail", reason: runEnd.verdict.one_liner ?? runEnd.verdict.root_cause ?? "failed" };
  }
  return errorResult(`run_end status is ${runEnd.status} (${exit})`);
}

function errorResult(reason) {
  return { outcome: "error", reason };
}

function parseEvents(stdout) {
  const events = [];
  for (const line of stdout.split("\n")) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    try {
      events.push(JSON.parse(text));
    } catch {
      // Plain text on stdout is not an event.
    }
  }
  return events;
}

function isStep(event) {
  return event.type === undefined && event.step !== undefined;
}

function typeOf(event) {
  return event.type ?? (isStep(event) ? "step" : "unknown");
}

function lastOfType(events, type) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) return events[index];
  }
  return null;
}

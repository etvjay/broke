import { spawn } from "node:child_process";
import { createServer } from "node:net";

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Starts the poll app with a clean environment, its own port and data file,
// and V8 coverage written to coverageDir when it exits cleanly.
export function startApp({ serverFile, cwd, port, dataFile, coverageDir }) {
  const child = spawn(process.execPath, [serverFile], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: String(port),
      DATA_FILE: dataFile,
      NODE_V8_COVERAGE: coverageDir
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  const app = { child, port, exited: false, exit: null, stderr: "" };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    app.stderr = (app.stderr + chunk).slice(-4000);
  });
  child.once("exit", (code, signal) => {
    app.exited = true;
    app.exit = { code, signal };
  });
  return app;
}

export async function waitForApp(app, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let answered = false;
  while (!app.exited && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${app.port}/api/polls`, { signal: AbortSignal.timeout(500) });
      const body = await response.text();
      answered = true;
      if (response.ok && isPollList(body)) return { ok: true, detail: "" };
    } catch {
      // Not listening yet. Retry until the deadline or until the app exits.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (app.exited) return { ok: false, detail: `${describeExit(app.exit)}${errorLine(app.stderr)}` };
  if (answered) return { ok: false, detail: "the port answered, but /api/polls did not return a poll list" };
  return { ok: false, detail: `no response within ${timeoutMs / 1000} s` };
}

// The poll app answers GET /api/polls with { polls: [...] }. Any other server
// on the port fails this check, so verify does not run Kane against it.
function isPollList(body) {
  try {
    return Array.isArray(JSON.parse(body).polls);
  } catch {
    return false;
  }
}

export function stopApp(app, timeoutMs) {
  if (app.exited) return Promise.resolve(app.exit);
  return new Promise((resolve) => {
    const killer = setTimeout(() => app.child.kill("SIGKILL"), timeoutMs);
    app.child.once("exit", (code, signal) => {
      clearTimeout(killer);
      resolve({ code, signal });
    });
    app.child.kill("SIGTERM");
  });
}

export function describeExit({ code, signal }) {
  return signal ? `killed by ${signal}` : `exit ${code}`;
}

function errorLine(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const line = lines.find((item) => /error/i.test(item)) ?? lines.at(-1);
  return line ? `: ${line}` : "";
}

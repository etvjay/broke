#!/usr/bin/env node
// Droid Stop hook, run after each agent turn (see .factory/hooks.json).
// Uncommitted changes under app/ or explain/ exit 2 so Droid commits them. A commit that
// changed app/ or explain/ since the latest report gets verify. A red that puts the fault in
// the app starts a fix race in the background. Exit 2 blocks the stop and gives Droid the
// reason. Exit 0 ends the turn with a message for the owner. Exit 1 is a non-blocking error.
// Racer worktrees (race/ branches) load the same hooks file, so the hook skips them.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RACE_SCRIPT, VERIFY_SCRIPT } from "./config.mjs";
import { git } from "./lib/git.mjs";
import { isStaleLock, readLock, stateDir } from "./lib/lock.mjs";
import { padNumber } from "./lib/report.mjs";
import { listDir, readJsonOrNull } from "./lib/race-support.mjs";
import { classifyRed } from "./lib/summary.mjs";

const COMMIT_ASK = "Commit your change under app/ or explain/ before you stop, so verify can run on it.";

export async function runStopHook(input, { verifyScript = VERIFY_SCRIPT, raceScript = RACE_SCRIPT, out, err }) {
  const root = (await git(input.cwd ?? process.cwd(), ["rev-parse", "--show-toplevel"])).trim();
  const branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  if (branch.startsWith("race/")) {
    out("This is a race worktree, so the Stop hook does not verify here.");
    return 0;
  }
  if ((await git(root, ["status", "--porcelain", "--", "app", "explain"])).trim() !== "") {
    if (input.stop_hook_active === true) {
      out("Uncommitted changes under app/ or explain/ remain. The Stop hook does not block again, so verify did not run on them.");
      return 0;
    }
    err(COMMIT_ASK);
    return 2;
  }
  const latest = await latestReport(root);
  if (latest === null) {
    out("No Why It Broke report exists yet. Run npm run verify once to create report 0001.");
    return 0;
  }
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  const diff = (await git(root, ["diff", "--name-only", latest.testedCommit, head, "--", "app", "explain"])).trim();
  if (diff === "") {
    out(`No change under app/ or explain/ since report ${padNumber(latest.number)}. Verify did not run.`);
    return 0;
  }
  const run = spawnSync(process.execPath, [verifyScript, "--root", root], { cwd: root, stdio: "inherit" });
  if (run.status !== 0 && run.status !== 1) {
    out(`Verify did not finish (exit ${run.status ?? run.signal}). Its output above says why. No race starts.`);
    return 0;
  }
  const report = await latestReport(root);
  if (report === null) throw new Error("verify exited without writing a report");
  const pad = padNumber(report.number);
  if (run.status === 0) {
    out(`Verified green: report ${pad}. Every flow passed and drift passed.`);
    return 0;
  }
  const summary = await readJsonOrNull(join(root, "reports", `${pad}.json`));
  if (summary === null) {
    out(`Verified red: report ${pad}, but its summary is missing, so no race starts.`);
    return 0;
  }
  const decision = classifyRed(summary);
  if (!decision.race) {
    out(`Verified red: report ${pad}. ${decision.reason}`);
    return 0;
  }
  const held = await readLock();
  if (held !== null && !isStaleLock(held)) {
    out(`Verified red: report ${pad}. ${decision.reason} Race ${padNumber(held.raceId)} holds the lock, so no new race starts.`);
    return 0;
  }
  const log = startRace({ root, raceScript, from: report.number });
  out(
    [
      `Verified red: report ${pad}. ${decision.reason}`,
      `A fix race started in the background. Its log: ${log}`,
      'If one attempt passes, the runner merges it. If two or three pass, the owner picks one with: npm run race:pick -- NNNN <a|b|c> --reason "<text>"'
    ].join("\n")
  );
  return 0;
}

// The newest report: its number, and the commit it tested, from its Tested commit line.
async function latestReport(root) {
  const numbers = (await listDir(join(root, "reports")))
    .map((name) => /^(\d{4})\.md$/.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  if (numbers.length === 0) return null;
  const number = Math.max(...numbers);
  const markdown = await readFile(join(root, "reports", `${padNumber(number)}.md`), "utf8");
  const tested = /^Tested commit: ([0-9a-f]{40})$/m.exec(markdown);
  if (tested === null) throw new Error(`report ${padNumber(number)} has no Tested commit line`);
  return { number, testedCommit: tested[1] };
}

// Starts the race detached. Its output goes to a log in the state folder, which outlives this hook.
function startRace({ root, raceScript, from }) {
  mkdirSync(stateDir(), { recursive: true });
  const log = join(stateDir(), "race-start.log");
  appendFileSync(log, `--- ${new Date().toISOString()} race from report ${padNumber(from)}\n`);
  const fd = openSync(log, "a");
  const child = spawn(process.execPath, [raceScript, "--root", root], {
    cwd: root,
    detached: true,
    stdio: ["ignore", fd, fd]
  });
  child.on("error", (error) => appendFileSync(log, `race did not start: ${error.message}\n`));
  child.unref();
  return log;
}

async function readStdin() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

const isMain = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  readStdin()
    .then((raw) =>
      runStopHook(raw.trim() === "" ? {} : JSON.parse(raw), {
        verifyScript: process.env.WHY_IT_BROKE_VERIFY_CMD || VERIFY_SCRIPT,
        raceScript: process.env.WHY_IT_BROKE_RACE_CMD || RACE_SCRIPT,
        out: (line) => console.log(line),
        err: (line) => console.error(line)
      })
    )
    .then(
      (code) => {
        process.exitCode = code;
      },
      (error) => {
        console.error(`stop hook: ${error.message}`);
        process.exitCode = 1;
      }
    );
}

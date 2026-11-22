#!/usr/bin/env node
// Test double for droid exec. Each racer's behavior comes from FAKE_RACER_<LETTER>:
// green or red commits an app change, none makes no commit, outside commits a
// flow edit, dirty changes app/ without committing, and stop-clean runs until it is
// stopped, then exits 0 without a commit.
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const args = process.argv.slice(2);
const worktree = args[args.indexOf("--cwd") + 1];
const brief = args[args.indexOf("-f") + 1];
const letter = basename(worktree).slice(-1);
const mode = process.env[`FAKE_RACER_${letter.toUpperCase()}`] ?? "none";
const git = (...rest) => execFileSync("git", ["-C", worktree, ...rest], { stdio: ["ignore", "pipe", "pipe"] }).toString();
// With FAKE_ORDER_LOG set, each start and end is appended to that file, so a test can read the order.
const order = (line) => {
  if (process.env.FAKE_ORDER_LOG) appendFileSync(process.env.FAKE_ORDER_LOG, `${line}\n`);
};

order(`start ${letter}`);
console.log(JSON.stringify({ type: "start", letter, mode, brief }));
if (mode === "stop-clean") {
  // Runs until it is stopped, then exits 0 without a commit, as a racer can after a timeout.
  process.on("SIGTERM", () => process.exit(0));
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
if (mode === "green" || mode === "red") {
  writeFileSync(join(worktree, "app", "fix.txt"), `${mode}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", `fix: attempt ${letter}`);
} else if (mode === "outside") {
  writeFileSync(join(worktree, "flows", "poll-vote.md"), "Changed by a racer.\n");
  git("add", "-A");
  git("commit", "-q", "-m", `flow edit ${letter}`);
} else if (mode === "dirty") {
  writeFileSync(join(worktree, "app", "fix.txt"), "dirty\n");
}
order(`end ${letter}`);
console.log(JSON.stringify({ type: "end", letter, mode }));

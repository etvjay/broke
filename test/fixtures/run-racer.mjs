#!/usr/bin/env node
// Test double for the race process. It runs one racer with runProcess and prints how the run ended.
// Usage: run-racer.mjs <log file> <racer script> <pid file>
import { runProcess } from "../../scripts/lib/race-support.mjs";

const [logFile, racerScript, pidFile] = process.argv.slice(2);
runProcess({ command: process.execPath, args: ["-e", racerScript, pidFile], cwd: process.cwd(), logFile }).then(
  (result) => {
    console.log(JSON.stringify(result));
  },
  (error) => {
    console.log(`stopped: ${error.message}`);
    process.exitCode = 3;
  }
);

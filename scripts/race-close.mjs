import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { lockPath, readLock, releaseLock } from "./lib/lock.mjs";
import { reportBranchName } from "./lib/race-support.mjs";
import { padNumber } from "./lib/report.mjs";

// Clears the lock of a race that has green attempts and no pick. Worktrees and branches stay.
export async function runClose({ number, log = () => {} }) {
  const raceNumber = Number(number);
  const n = padNumber(raceNumber);
  const lock = await readLock();
  if (lock === null) {
    log("No race is open, so there is no lock to clear.");
    return 2;
  }
  if (lock.raceId !== raceNumber) {
    log(`refused: race ${padNumber(lock.raceId)} holds the lock, not race ${n}.`);
    return 2;
  }
  if (lock.state !== "awaiting-pick") {
    log(`refused: race ${n} is ${lock.state}. Close a race only after its racers finish. If no racer runs, remove ${lockPath()} by hand.`);
    return 2;
  }
  await releaseLock();
  log(`Closed race ${n} without a pick. Its records are on ${reportBranchName(raceNumber)}. Its worktrees and branches stay for inspection.`);
  return 0;
}

const isMain = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const { positionals } = parseArgs({ allowPositionals: true, options: {} });
  runClose({ number: positionals[0], log: (line) => console.log(line) }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`race:close: ${error.message}`);
      process.exitCode = 2;
    }
  );
}

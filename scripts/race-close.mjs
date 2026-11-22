import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isStaleLock, lockPath, raceDir, readLock, releaseLock } from "./lib/lock.mjs";
import { reportBranchName } from "./lib/race-support.mjs";
import { padNumber } from "./lib/report.mjs";

// Clears the lock of a race that has green attempts and no pick, or of a race that stopped.
// Worktrees and branches stay.
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
  const stopped = isStaleLock(lock);
  if (lock.state !== "awaiting-pick" && !stopped) {
    log(`refused: race ${n} is ${lock.state}, and its process is still running. Close a race only after its racers finish. If you are sure no race runs, remove ${lockPath()} by hand.`);
    return 2;
  }
  await releaseLock();
  if (stopped) {
    log(`Closed race ${n}, which stopped before it finished. Its records stay in ${raceDir(raceNumber)}, and its worktrees and branches stay for inspection.`);
    return 0;
  }
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

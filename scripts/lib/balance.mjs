import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { KANE_BIN } from "../config.mjs";

const run = promisify(execFile);

export async function getBalance({ kaneBin = KANE_BIN, env = process.env } = {}) {
  const { stdout } = await run(kaneBin, ["balance"], { env });
  const match = /Available credits:\s*(\d+(?:\.\d+)?)/.exec(stdout);
  if (!match) throw new Error(`kane-cli balance printed no credit line: ${stdout.trim().slice(0, 200)}`);
  return Number(match[1]);
}

import { execFile } from "node:child_process";

export const COAUTHOR = "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>";

export function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args[0]} failed: ${stderr.trim() || error.message}`));
      else resolve(stdout);
    });
  });
}

export async function gitConfig(cwd, key) {
  try {
    return (await git(cwd, ["config", "--get", key])).trim();
  } catch {
    return "";
  }
}

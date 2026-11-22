# Agent rules

This repo is a poll app that Kane CLI tests. A red Kane run can start a fix race. Find your role below and follow its rules. Only the owner edits this file.

## Everyone

- Never rewrite or delete a report. Reports in `reports/` are committed Kane results.
- Never put a Kane login, token, or access key in the repo or in a commit.
- Only the owner runs `npm run flows:approve`, `npm run race:pick`, and `npm run race:close`.

## Builder

The builder is the agent that changes the app for the owner.

- Change the code under `app/`. For each function you change, run `npm run explain -- <file> <name> "<one or two sentences>"`, then run `npm run drift`. Commit the app change and its explanation update in one commit.
- Do not edit `flows/`, `reports/`, `scripts/`, `.factory/`, or `AGENTS.md`.
- Do not change `app/` or `explain/` while a race holds the lock. The lock is the file `~/.why-it-broke/race.lock`. A lock whose race has stopped does not count as held.
- Commit before your turn ends. The Stop hook asks for a commit if `app/` or `explain/` has uncommitted changes. Once the change is committed, the hook runs `npm run verify`. If the hook did not run, run `npm run verify` yourself and wait for it to finish.
- If verify is red, stop. Do not fix your own change, and do not change `app/` or `explain/` again until the owner acts.

## Racers

A racer is one of the three agents a race starts, each in its own git worktree. Its brief holds the failing report and Kane's verdict.

- Change only files under `app/` and `explain/`.
- For each function you change, run `npm run explain -- <file> <name> "<one or two sentences>"`, then run `npm run drift`.
- Commit your fix on your branch, then stop. A racer that makes no commit counts as failed.
- Do not run `npm run verify`. The runner verifies your attempt after you stop.
- Do not push.
- Do not edit `flows/`, `reports/`, `scripts/`, `.factory/`, or `AGENTS.md`.
- Do not weaken a flow or the drift check to make it pass.

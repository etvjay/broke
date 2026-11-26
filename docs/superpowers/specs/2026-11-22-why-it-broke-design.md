# Why It Broke: Design

**Date:** 2026-11-22
**Status:** Built. Verify runs 0001 to 0008 are committed and green. The fix race is tested with fake racers and a fake verify, and it has not run on a real red yet. On 26 Nov the owner added two race rules: a sole green attempt merges by itself, and a race with no green attempt commits its records to main. Fix race describes both. The page builder builds them before the first real race. See the README for the current status. This replaces the verified-receipts design of the same date. A builder check found five gaps. Each is settled as a call in the sections below and marked.
**Event:** KaneCLI Online Hackathon by TestMu AI ([kaneclihack.sh](https://www.kaneclihack.sh/)). The repo must be initialized on or after 12 Nov 2026. Old ideas are fine, old codebases are not. Submissions close Thu 26 Nov 2026, 11:59 PM IST (10:29 AM PT).

## Intent

Kane CLI judges a small poll app in a real browser after each change, and an AI coding agent makes those changes. When a run fails, the report gives Kane's verdict and lists the server functions that ran on the failing path, each with a plain-English explanation. If Kane places the fault in the app, three coding agents each try a fix in their own git worktree, and Kane judges each fix. If exactly one fix passes, the runner merges it. If two or three pass, the owner picks one. Every run is committed, so the git history shows what Kane caught, what was tried, and what was kept.

The poll app is the subject under test. Kane's verdict and the fix loop are what the project shows.

It is for vibecoders who want to learn what their code does, and for judges who need to see what broke and why.

The judges clear three bars first: the app works end to end, Kane caught or proved something, and the agent and Kane talked to each other. Then four equal scores: Ships, Verified, Closed loop, and Craft. The sections below map each one to a feature.

## Prior art and what is new

- **Proven** (vijaygopalbalasa/proven) already checks git-anchored receipts against frozen tests. This design does not claim receipts as new.
- **GuardianKane** (adventures-with-kane), an August 2026 hackathon entry, runs a Stop hook and shows a red-to-green dashboard. Its trace is per file, not per function, and it has no code explainer.
- **Proofline** runs a loop with repair briefs and git-diff-selected flows. **PatchLoop** (demonchant/kane-cli) runs one repair in an isolated worktree and accepts it only after a passing Kane rerun.
- **iGraph** is the author's earlier project for Build with DataHub (etvjay/iGraph, Aug 2026). It maps data lineage to signed authority and writes change receipts. It works on data, not code, and it predates this repo, so no code is reused. The README will credit it as the author's earlier work on the same pattern.

In the 103 Kane READMEs I scanned, I found no function-level trace tied to a failing Kane run, no drift check on function explanations, and no race of competing fixes that Kane judges and the owner picks. The combination is the claim.

## Goals

1. Kane judges a poll app (create a poll, vote, see results) in a real browser. The app starts with one command.
2. Three Kane flows: create a poll, vote, and refuse a second vote from the same browser.
3. Auto verify: after an agent turn that commits a change under `app/` or `explain/`, a Stop hook runs the three flows.
4. A Why It Broke report for each run: each flow's verdict, Kane's verdict for any failure, and the explained trace of the server functions that ran during each failing flow.
5. A drift check that fails when a function has no explanation, when its code changed after its explanation was written, or when no flow ran it.
6. A fix race after a red run that the racers can fix (see Fix race for which reds qualify): three Droid agents each fix the app in their own worktree and branch, the runner verifies each attempt with Kane, and a comparison shows the results. If exactly one attempt passes, the runner merges it. If two or three pass, the owner picks one for the runner to merge.
7. A 3 to 5 minute demo: one real red run from a real agent mistake, Kane's verdict, the report, the race, the merge, and the green main.

## Non-goals

- No hosted app, accounts, or database. Poll data lives in a local JSON file. The one hosted piece is the static report page (see the report page design).
- No login in the app and no third-party API. Judges can run the app as it is.
- No mobile target.
- No static code-impact map. The impact view shows what the flows ran, not what a line change might break.
- No security scanner. `poll-vote-once` checks one integrity rule. Any more security flows are optional and make no wider claim.
- No planted bugs. Every red run comes from a real mistake.

## Anti-goals

- An agent picking its own winner, or editing flows, explanations, reports, or scripts to pass.
- A report that hides failed runs or shows only green ones.
- Reading the drift check as proof that an explanation is correct. It proves only that an explanation was written after the last change to that function.

## Constraints

- The repo starts on or after 12 Nov 2026 from an empty folder, with no code from older projects. The organizers check commit history.
- Public GitHub repo under etvjay, a 3 to 5 minute YouTube demo, and at least two public posts. The owner uploads and posts. The agent drafts only.
- Kane CLI 0.10.4 on this VPS, under the owner's Kane profile. Every run passes `--target desktop`. About 10,180 credits at the start. The smoke run cost 13.06 credits for three actions.
- The runner stops below 2,000 credits.
- 2 CPUs, 7.6 GB RAM, Node 24, npm 11, Chromium.
- Git name and email are not set on this machine. The owner sets them before the first commit.
- Evidence is redacted before commit: email addresses, IPv4 addresses, home paths, the Kane profile name, and auth values. A second scan runs after redaction, and a match blocks that evidence from being committed.

## Approaches

The owner picked option C.

- **A. Why It Broke alone.** One fix attempt per failure. Lowest risk. The demo shows less.
- **B. Core first, race as a stretch goal.** The race is added only if the core works by Tue 24 Nov. This was my recommendation, because it leaves more slack.
- **C. Race built in from the start (chosen).** Worktrees, the attempt verifier, the comparison, and the pick are part of the first build. That costs about a day more than A, with little slack. The cut order below protects the core.

## How it works

### App

- Node 24, no dependencies. `app/server.mjs` uses `node:http`. Static files live in `app/public/`. A JSON store lives in `data/`, which is not committed.
- Logic lives on the server, so the trace covers it. The browser script only calls the API, and the trace does not cover it.
- The port comes from `PORT` (default 3000), so race attempts can run side by side.
- On SIGTERM or SIGINT the server closes and calls `process.exit()`, so V8 writes its coverage file. Build step 1 confirms this.
- Every function in `app/` has a name, and names are unique per file. Anonymous functions fail the drift check.

### Flows

- `flows/poll-create.md`, `flows/poll-vote.md`, and `flows/poll-vote-once.md` hold plain-English objectives. Their hashes live in `flows/approvals.json`.
- The owner approves the baseline flows once. The agent cannot approve. `npm run flows:approve` is for the owner.
- Build step 1 confirms the exact `kane-cli` command and NDJSON fields.

### Verify run (`npm run verify`)

1. Refuse a dirty tree. Verify runs on a commit.
2. Check the Kane balance and stop below 2,000 credits.
3. For each flow, one at a time: start the app on a random port with fresh data and `NODE_V8_COVERAGE` pointed at that flow's folder. Run `kane-cli run` with `--target desktop --headless --agent --timeout <s>`, read the NDJSON, and take the `run_end` event as the verdict. Stop the app cleanly. Kane reaches the app at `http://localhost:<port>` through `--url`. If build step 1 shows that Kane cannot reach localhost, the runner starts a `cloudflared` quick tunnel for each run, passes its URL the same way, and stops the tunnel when the run ends. Flows contain no URLs, so flow hashes do not change (my call).
4. A run that never reaches `run_end` gets an `error` verdict, with the exit code and last event.
5. Map the coverage to functions in `app/`. Each function's hash is the SHA-256 of its source text.
6. Run the drift check.
7. Write `reports/NNNN.md` and commit it as its own commit, naming the tested commit.
8. Exit 0 if every flow passes and drift passes. Exit 1 if a flow fails or drift fails. Exit 2 on errors.

### Why It Broke report

For each flow:
- The verdict: pass, fail, or error.
- For a failure, Kane's `family`, `category`, `root_cause`, `suggestion`, `culprit_step`, `confidence`, and fault assessment. Build step 1 fixes the exact field names.
- The trace: every function in `app/` that ran during this flow's run, in file order. Coverage is recorded per run, not per step, so the trace cannot show which functions ran before the failing step. Kane's `culprit_step` appears beside the trace and is not mapped to functions (my call). Each entry shows its signature and explanation. The source sits in a collapsed `<details>` block, so the report reads as a skeleton.
- Links to the redacted evidence.

The report ends with the drift table: each function, its explanation status, and the flows that ran it.

### Explanations (`explain/functions.json`)

- One entry per function: file, name, a plain-English explanation of one to three sentences, and the SHA-256 of the function's source.
- The agent updates an entry in the same commit as the code change, with `npm run explain -- <file> <name> "<text>"`. That command writes the text and the current hash, so writing the text is required.

### Drift check

Fails when:
- A function in `app/` has no explanation.
- An explanation's hash differs from the function's current source.
- An explanation names a function that no longer exists.
- A function in `app/` ran in no flow.

### Fix race (`npm run race`)

1. Starts only after a red report, and only when the code at HEAD is the code that report tested. Since that report, only files under `reports/races/` may differ. No race may hold the lock. These reds start a race (my call):
   - A flow failure that Kane's verdict puts in the app.
   - A drift failure that the racers can fix: a missing or stale explanation, an anonymous function, or an explanation for a removed function. The drift table is the brief.

   These reds do not start a race (my call):
   - A drift failure where a function ran in no flow. Racers cannot add flows, so the runner stops and asks the owner to approve a new flow or remove the code.
   - A flow failure that Kane's verdict puts in the flow (for example, family `automation_bug`). The runner stops and asks the owner. Flows are owner-approved, so racers never change them.
   - An `error` verdict (crash, timeout, login, or credits). It is not an app fault, so the runner reports it and stops.
2. Creates three git worktrees as sibling folders next to the repo, each on a new branch from HEAD: `race/NNNN-a`, `race/NNNN-b`, `race/NNNN-c`.
3. Starts three Factory Droid agents with `droid exec`, one per worktree, with the same brief: the failing report, Kane's verdict, and the explained trace. Each racer changes only `app/` and `explain/`, commits its fix, and stops. Racers do not touch `flows/`, `reports/`, `scripts/`, `.factory/`, or `AGENTS.md`. A racer that makes no commit counts as failed.
4. When each racer exits, the runner verifies its attempt in its worktree: the same three flows and drift check, on its own port and coverage folder. Attempts are verified one after another. Attempt reports stay outside the repo until the pick.
5. Writes `comparison.md` with, for each attempt: branch, commit, flow verdicts, drift result, files and lines changed, and explanations changed. It names no winner.
6. The merge takes one attempt in one of two ways (owner decision, 26 Nov):
   - One green attempt: the runner picks it and merges it, with no owner command. A sole green attempt must pass every flow and the drift check, as a pick requires. `pick.md` says `Picked by: runner` and gives the reason: it was the only attempt that passed Kane's verify.
   - Two or three green attempts: the race waits. The owner runs `npm run race:pick -- NNNN <a|b|c> --reason "<text>"`, and `pick.md` says `Picked by: owner`. The pick refuses an attempt that is not green.
   Both paths run the same merge. It leaves main alone until the merge is proven (my call). It merges the branch with `--no-ff` in a temporary worktree of main, copies the race reports into `reports/races/NNNN/`, records the pick in `pick.md`, and runs verify there. Only a green run moves main, by fast-forward. A red run leaves main where it was, records the failed merge in `pick.md`, and keeps the lock for the owner. After a successful pick, the runner removes the worktrees and keeps the branches.
7. The other branches stay in git with their reports, so judges can inspect them.
8. When no attempt is green (my call): nothing merges, and main's app code stays at its red HEAD. The race copies its records to `reports/races/NNNN/` and commits them to main as one commit, `race NNNN: no attempt is green`. That commit adds only that folder. Racer branches and worktrees stay local, and `comparison.md` shows why each attempt failed. The race lock clears, so the owner can start another race. Until the owner acts, the builder does not change `app/` or `explain/`. The owner then runs `npm run race` again on the same red code (the new brief lists the earlier attempts' failing verdicts, so racers do not repeat them) or fixes the app by hand. The owner can also close a race that has green attempts but no pick with `npm run race:close -- NNNN`, which clears the lock. The hook never starts a race on its own for red code that already has one.

### Auto mode (Stop hook)

- `.factory/hooks.json` runs `scripts/stop-hook.mjs` after each agent turn. The hook timeout is set above the longest verify run, because the default is 60 seconds.
- If the turn left uncommitted changes under `app/` or `explain/`, the hook exits 2 and asks for a commit. If `stop_hook_active` is already true, it exits 0 with a message instead, so it cannot loop.
- If HEAD changed under `app/` or `explain/` since the last report's tested commit, the hook runs verify.
- Green: the turn ends.
- Red: if the red starts a race (see Fix race), the hook starts it in the background and exits 0 with a message to the owner. Other reds exit 0 with the reason. The builder does not fix its own change. The racers do.
- While a race holds the lock, a lock file outside the repo stops the hook from starting another race. The lock is held from the start of a race until a pick succeeds, whether the owner's or the runner's, or the owner closes the race. A race with no green attempt releases it at once (see Fix race, step 8). AGENTS.md tells the builder not to change `app/` or `explain/` while the lock is held, and not after a red run until the owner acts.
- If the hook cannot run as documented, the fallback is AGENTS.md: the agent runs `npm run verify` and waits for the result.

### Agent rules (`AGENTS.md`)

- Builder: commit each app change together with its explanation update. Do not edit `flows/`, `reports/`, `scripts/`, or `.factory/`. Do not run `flows:approve`, `race:pick`, or `race:close`. Do not change `app/` or `explain/` while a race holds the lock, or after a red run until the owner acts.
- Racers: the rules in the race section.
- Everyone: never rewrite or delete a report.

### Repo layout

```
app/          server.mjs, public/
explain/      functions.json
flows/        poll-create.md, poll-vote.md, poll-vote-once.md, approvals.json
reports/      NNNN.md, races/NNNN/
scripts/      verify.mjs, drift.mjs, explain.mjs, race.mjs, race-pick.mjs, stop-hook.mjs
.factory/     hooks.json
AGENTS.md
README.md
docs/superpowers/specs/ and plans/
```

### How it meets the judges' bars

- Works end to end: `npm start` serves the app, and all three flows pass on main.
- Kane caught or proved something: a real red run, with Kane's verdict in the report.
- Agent and Kane talked: the brief goes to the racers, and their attempts come back as Kane verdicts.
- Closed loop: Kane's verdict, then the brief, then the racers, then Kane again, then the merge (the runner's for a sole green attempt, the owner's pick for two or three), then Kane on main.
- Verified: every report and comparison is a committed Kane result.
- Craft: one command to start, no login, and a README that shows a red run and its merge.

### Judge access

Judges can read every report and comparison in the repo without Kane. The owner shares a separate judge Kane login through the submission form. No credential goes in the repo or the README.

## Demo video (owner records and uploads, 3 to 5 minutes)

- 0:00 to 0:20: the problem.
- 0:20 to 1:00: the agent makes a change, and the Stop hook runs verify.
- 1:00 to 2:00: the red run, Kane's verdict, and the Why It Broke trace.
- 2:00 to 3:00: the race, the comparison, and the merge.
- 3:00 to 3:40: the green main and the drift check.
- 3:40 to 4:10: how to run it.

A live race may take 30 to 40 minutes. The recording can speed up the waits.

## Timeline (solo, 22 to 26 Nov)

- Sun 22 Nov: design approved, plan written, build step 1 (localhost test and Kane output check, about 15 credits).
- Mon 23 Nov: app, flows, the owner's baseline approval, verify with coverage, explanations, drift check, and reports. First real Kane runs.
- Tue 24 Nov: race, Stop hook, AGENTS.md. Checkpoint at the end of the day: a race has run end to end on a real red run. If not, attempts run one at a time, and the race stays.
- Wed 25 Nov: README, polish, recording, and drafted posts. Submit Wednesday evening.
- Thu 26 Nov: buffer only. Deadline 10:29 AM PT.

## Cut order

If time runs short, cut in this order:
1. Evidence copies in the repo. Keep the redacted hash and the link to the recorded run.
2. Any explanation view beyond the Markdown report.
3. The Stop hook. Replace it with the AGENTS.md rule and a manual `npm run verify`.
4. Parallel attempts. Run them one at a time.

The core stays: the trace with explanations, the drift check, the race comparison, the owner's pick, and the README.

## Risks

- A race may run long, and attempts may fail. Mitigation: one-at-a-time mode, and the comparison shows failures plainly.
- The drift check tests process, not truth. Mitigation: the README says so, and explanations are readable in the report.
- Coverage may not flush on signals. Mitigation: clean exit path, checked in build step 1.
- Hook behavior may differ from the docs. Mitigation: test on the first slice, and use the AGENTS.md fallback.
- Kane's run may use a cloud browser that cannot reach localhost. Mitigation: a cloudflared tunnel per run (cloudflared 2026.8.2 is installed).
- Credits are not the limit: a race costs about 120 credits for three verifies, against about 10,180 available.
- Time: this is more work than the earlier plan. The cut order protects the core.
- Overlap with Proven, Proofline, GuardianKane, and PatchLoop. Mitigation: credit them in the README.

## My calls (the owner can change these)

The builder check raised five gaps. I settled each one as a call, and each is marked in the sections above.

- Which reds start a race: flow failures the app caused, and drift failures the racers can fix. Error verdicts and never-run functions do not start one.
- No green attempt: nothing merges. The records commit to main, the lock clears, and the owner decides the next step. The hook does not re-race on its own.
- Kane reaches localhost by default. A per-run cloudflared tunnel is the fallback, and the runner owns it. Flows contain no URLs.
- The trace covers the whole flow run, not single steps. Kane's culprit step is shown beside it.
- The pick merges in a temporary worktree and moves main only after that merge verifies green.
- Repo name `why-it-broke` under etvjay, checked free on 22 Nov.
- "Kane agents" read as three coding agents (Factory Droid) that each get the Kane brief. Kane judges the fixes.
- The builder does not fix its own red change. The race does.
- The owner runs the pick only when two or three attempts are green. A sole green attempt merges by itself (owner decision, 26 Nov).
- No new app features until the first real red. After that, app changes come only from a fault Kane judges, through the race (owner decision, 26 Nov).
- iGraph is credited, not reused. It predates the repo rule.
- Striptease: the skeleton view is folded into the explainer as collapsed source in each trace entry. It does not claim to catch bugs.
- CodeGraph: the impact view is observed, not predicted. It shows which flows ran each function and flags changed functions that no flow ran.
- The poll app is the subject under test. Kane's verdict and the fix loop are the point (owner decision, 26 Nov).
- The verified-receipts design and plan were removed from the tree. They remain in history at e04b168. Their receipt chain and verifier are dropped.

## Left to the builder

- Exact `kane-cli` flags and NDJSON fields (build step 1).
- `droid exec` flags for racers: auto level and model.
- Hook JSON format and timeout key, from the Factory hooks docs.
- Explanation wording and the explain command's details.
- Visual design and copy.

## Owner actions

- Approve this design.
- Set Git user.name and user.email before the first commit.
- Create the judge Kane login and share it through the submission form.
- Record and upload the demo video, then post the two launch posts. The agent drafts them.
- Approve flow `poll-create-once` with `npm run flows:approve`. The first real red depends on it.

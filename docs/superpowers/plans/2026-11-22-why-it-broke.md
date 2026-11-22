# Why It Broke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a poll app, three Kane flows, and a verify runner that writes a Why It Broke report, a drift check on function explanations, and an owner-picked fix race, all committed in one public repo.

**Architecture:** A dependency-free Node 24 server (`app/`) is driven by Kane CLI through three flows. A verify runner starts the app per flow with V8 coverage, reads Kane's NDJSON verdict, maps coverage to `app/` functions, and writes a committed report. A drift check ties each function to a hashed explanation. After a red report that racers can fix, a runner gives three Factory Droid agents one git worktree each, verifies each attempt, writes a comparison, and merges only the attempt the owner picks, and only if main still verifies green. A Stop hook runs verify after each agent turn.

**Tech Stack:** Node 24 (`node:http`, `node:test`, `node:crypto`, `node:child_process`), npm 11, one dev dependency for scripts only (`acorn`, for function parsing; see Global Constraints), Kane CLI 0.10.4 (`--target desktop`), Factory Droid CLI (`droid exec`), Git 2.43 worktrees, cloudflared 2026.8.2 (fallback only).

**Spec:** `docs/superpowers/specs/2026-11-22-why-it-broke-design.md`. Read it with this plan. The plan argues from it. Where the two differ, stop and ask the owner.

## Global Constraints

- Node 24. `app/` has no runtime dependencies. Scripts may use one dev dependency, `acorn`, to parse `app/**/*.mjs` (my call; the owner confirms in plan review).
- Port: `PORT` env, default `3000`. Verify and race attempts use random free ports.
- Every Kane run passes `--target desktop --headless --agent`. Per-flow timeout is set in `scripts/config.mjs` from Task 1 measurements, with at least 2x headroom.
- Runner stops below 2,000 Kane credits. Three race attempt verifies cost about 100 to 190 credits (Task 1 measurements).
- Exit codes for `npm run verify`: `0` all flows pass and drift passes; `1` a flow fails or drift fails; `2` error (no `run_end`, unapproved flow, dirty tree, low credits, app failed to start, missing coverage).
- Verify refuses a dirty tree. It runs on a commit.
- Evidence is redacted before commit. A second secret scan blocks any file that still matches.
- Owner-only commands: `npm run flows:approve`, `npm run race:pick`, `npm run race:close`. The agent never runs them.
- Reports are never rewritten or deleted.
- Race lock lives outside the repo: `~/.why-it-broke/race.lock`.
- The agent never sets Git `user.name` or `user.email`. If identity is missing, stop.
- No em dashes in repo docs, reports, or commit messages.

## Review Focus

1. Non-ASCII source in `app/**/*.mjs` shifts V8 byte offsets and breaks hashes. Scanner rejects non-ASCII. Test: a file with `é` in a function fails with a clear message.
2. App fails to start (port taken, crash on boot). Verify must exit `2`, never report a green run. Test: occupy the port, expect exit `2`.
3. Kane run ends without `run_end` (timeout, crash, login error). Verdict is `error`, never `pass`. Test: stub Kane that exits after two events, expect `error`.
4. Coverage file missing or empty after a clean exit. Must be an error, not "no functions ran", or drift gives false results. Test: stub server that dies on SIGKILL, expect `error`.
5. Builder edits an approved flow, or two race attempts start at once. Verify exits `2` on hash mismatch. Race refuses a second start while the lock is held. Tests for both.

## File Structure

- `app/server.mjs`: HTTP routes, cookie voter id, clean shutdown. Only file that starts a server.
- `app/store.mjs`: JSON store read/write and poll logic (`createPoll`, `castVote`). Functions that take the data array and update it in place.
- `app/public/index.html`, `app/public/app.js`: browser UI. Thin fetch layer, no logic. Outside drift scope.
- `flows/*.md`, `flows/approvals.json`: Kane objectives and owner-approved hashes.
- `scripts/config.mjs`: paths, timeouts, credit floor, port range.
- `scripts/lib/functions.mjs`: parse `app/**/*.mjs`, list named functions with source hash.
- `scripts/lib/coverage.mjs`: read a V8 coverage folder, report which functions ran.
- `scripts/lib/kane.mjs`: run `kane-cli`, parse NDJSON, return verdict.
- `scripts/lib/redact.mjs`: redaction and second scan.
- `scripts/lib/report.mjs`: render `reports/NNNN.md` (verdicts, failure detail, trace, drift table).
- `scripts/lib/lock.mjs`, `scripts/lib/compare.mjs`, `scripts/lib/brief.mjs`: race state, comparison table, racer brief.
- `scripts/verify.mjs`, `scripts/drift.mjs`, `scripts/explain.mjs`, `scripts/flows-approve.mjs`, `scripts/race.mjs`, `scripts/race-pick.mjs`, `scripts/race-close.mjs`, `scripts/stop-hook.mjs`: CLI entry points.
- `explain/functions.json`: explanations and hashes.
- `.factory/hooks.json`: Stop hook config.
- `AGENTS.md`, `README.md`.
- `test/*.test.mjs`: `node:test` suites. Outside drift scope.

---

### Task 0: Repo start (owner precondition)

**Files:**
- Create: `.gitignore`
- Existing: `docs/superpowers/specs/*`, `docs/superpowers/plans/*`

**Interfaces:**
- Consumes: none
- Produces: a git repo on `main` with the design docs committed

- [ ] **Step 1: Check the owner set Git identity**

Run: `git config user.name && git config user.email`
Expected: both print values. If either is empty, stop and ask the owner to set them. Do not set them.

- [ ] **Step 2: Initialize the repo**

Run: `cd ~/kane && git init -b main`
Expected: `Initialized empty Git repository`.

- [ ] **Step 3: Write `.gitignore`**

Contents:
```
data/
node_modules/
*.log
.coverage-tmp/
```

- [ ] **Step 4: Commit the design docs**

Run: `git add .gitignore docs && git commit -m "docs: why it broke design and plan" -m "Supersedes the verified-receipts design and plan (both marked superseded)." -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"`
Expected: one commit on `main`.

---

### Task 1: Build step 1 checks (outside the repo)

Findings go to `~/kane-research/build-step-1/FINDINGS.md`. Nothing under `~/kane/app` is committed yet. Probe servers and flows live in `~/kane-research/build-step-1/`. Budget about 15 credits.

**Files:**
- Create (outside repo): `~/kane-research/build-step-1/probe-server.mjs`, `probe-flow-pass.md`, `probe-flow-fail.md`, `FINDINGS.md`

**Interfaces:**
- Consumes: none
- Produces: confirmed values for `scripts/config.mjs` (timeouts), the Kane command line, NDJSON field names, the coverage file path, the `droid exec` flags for racers, and the hook JSON format

- [ ] **Step 1: Localhost reachability.** Serve a one-page probe on `localhost:3100`. Run `kane-cli run probe-flow-pass.md --url http://localhost:3100 --target desktop --headless --agent --timeout 120`. Record whether Kane reaches the page.
  Gate: if Kane cannot reach localhost, record `TUNNEL_MODE=cloudflared`. Verify then starts `cloudflared tunnel --url http://localhost:<port>` per run and passes the URL to `--url`.

- [ ] **Step 2: Coverage on clean exit.** Run `NODE_V8_COVERAGE=/tmp/cov-probe node probe-server.mjs`, send one request, then `kill -TERM <pid>`. Confirm a `coverage-*.json` file appears and lists the handler functions with `count > 0`.
  Gate: no file, or no counts, means stop and redesign the trace before Task 5.

- [ ] **Step 3: Kane output fields.** Run the pass flow and the fail flow (the fail flow expects text the page does not show; this is a probe, not a planted bug in the product). Save NDJSON to `~/kane-research/build-step-1/`. Record:
  - exit codes (pass 0, fail 1 expected)
  - the `run_end` event fields and the `verdict` object fields (`family`, `category`, `root_cause`, `suggestion`, `culprit_step`, `confidence`, `agent_fault_assessment`)
  - the `coverage` event `pack` path
  - the credits from `run_end.credits_consumed`
  - the balance command (`kane-cli` subcommand that prints credits)

- [ ] **Step 4: Racer CLI.** Run `droid exec --help`. Record the flags for auto level, model, working directory, and prompt file. Confirm a non-interactive run in a worktree directory.

- [ ] **Step 5: Hook format.** From the Factory hooks docs, record the Stop hook JSON stdin fields (`stop_hook_active`, `cwd` or equivalent), the exit-code protocol, and the timeout key.

- [ ] **Step 6: Write FINDINGS.md** with each value above, the date, and the credit count. Commit nothing from this task.

---

### Task 2: App server and store

**Files:**
- Create: `app/server.mjs`, `app/store.mjs`, `app/public/index.html`, `app/public/app.js`, `test/store.test.mjs`, `test/server.test.mjs`, `package.json`

**Interfaces:**
- Consumes: Task 1 (localhost reachability, clean-exit coverage)
- Produces:
  - `store.mjs`: `loadPolls(file) -> Poll[]`, `savePolls(file, polls)`, `createPoll(polls, { question, options }) -> Poll`, `castVote(polls, pollId, optionIndex, voterId) -> { ok, reason? }`
  - `server.mjs`: `createServer({ dataFile }) -> http.Server`; the file runs the server when executed directly
  - HTTP: `GET /api/polls`, `POST /api/polls` (body `{question, options}`), `POST /api/polls/:id/vote` (body `{option}`), `GET /` static
  - Voter id: server sets cookie `voter=<uuid>` on first request. A second vote from the same voter on the same poll returns `409` with `{error:"already_voted"}`.
  - Shutdown: SIGTERM and SIGINT call `server.close()`, then `process.exit(0)`
  - Env: `PORT` (default `3000`), `DATA_FILE` (default `data/polls.json`)

- [ ] **Step 1: Write failing store tests** in `test/store.test.mjs`: `createPoll` rejects fewer than 2 options; `castVote` counts one vote; a second vote from the same voter returns `{ok:false, reason:"already_voted"}`.
- [ ] **Step 2: Run** `node --test test/store.test.mjs`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement `app/store.mjs`** with named function declarations only. No anonymous functions in `app/**/*.mjs`.
- [ ] **Step 4: Run** the store tests. Expected: PASS.
- [ ] **Step 5: Write failing server tests** in `test/server.test.mjs`: start `createServer({dataFile: tmp})` on port 0; `POST /api/polls` returns 201; `GET /api/polls` lists it; a second vote from the same cookie returns 409.
- [ ] **Step 6: Implement `app/server.mjs`** and `app/public/*`. Public files are a thin fetch layer with no logic.
- [ ] **Step 7: Verify clean shutdown.** Run `PORT=3000 node app/server.mjs & pid=$!; sleep 1; kill -TERM $pid; wait $pid; echo $?`. Expected: `0`.
- [ ] **Step 8: Commit** `feat: poll app server and store`.

---

### Task 3: Flows and owner approval

**Files:**
- Create: `flows/poll-create.md`, `flows/poll-vote.md`, `flows/poll-vote-once.md`, `flows/approvals.json` (empty object at first), `scripts/flows-approve.mjs`, `scripts/lib/hash.mjs`, `test/flows.test.mjs`

**Interfaces:**
- Consumes: Task 1 Kane command line and field names
- Produces:
  - `hash.mjs`: `sha256File(path) -> hex`
  - `flows/approvals.json`: `{ "<flow file name>": "<sha256 hex>" }`
  - `flows-approve.mjs`: prints each flow's hash and changed status, then requires the owner to type `approve` on a TTY. Writes approvals only on that input.

- [ ] **Step 1: Write the three flows.** Each is plain-English objectives, no URLs, no credentials. `poll-create` creates a poll with two options and checks it appears. `poll-vote` votes and checks the count rises. `poll-vote-once` votes twice from the same browser and checks the second vote shows the "already voted" message.
- [ ] **Step 2: Write failing test** in `test/flows.test.mjs`: each flow file exists, contains no `http` string, and `approvals.json` hash equals `sha256File` for each approved flow.
- [ ] **Step 3: Implement `hash.mjs` and `flows-approve.mjs`.**
- [ ] **Step 4: Stop for owner baseline approval.** The agent does not run `npm run flows:approve`. Ask the owner to read the three flows and run it. Expected: `approvals.json` holds three hashes.
- [ ] **Step 5: Run** `node --test test/flows.test.mjs`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: three poll flows, owner-approved baseline` (after the owner's approval lands).

---

### Task 4: Function scanner, explanations, drift check

**Files:**
- Create: `scripts/lib/functions.mjs`, `scripts/explain.mjs`, `scripts/drift.mjs`, `explain/functions.json` (empty), `test/drift.test.mjs`
- Modify: `package.json` (add `acorn` dev dependency; scripts `explain`, `drift`)

**Interfaces:**
- Consumes: `app/**/*.mjs` source
- Produces:
  - `functions.mjs`: `scanApp(appDir) -> FunctionInfo[]`, where `FunctionInfo = { file, name, startOffset, endOffset, line, source, hash }`. Throws on non-ASCII source. `name` is `null` for anonymous functions. Duplicate `file+name` is reported as a problem.
  - `explain.mjs`: `npm run explain -- <file> <name> "<text>"` writes `{file,name,explanation,hash}` into `explain/functions.json`, with the current hash from `scanApp`. Refuses an unknown function name.
  - `drift.mjs`: exports `checkDrift({ functions, explanations, ranByFlow }) -> { ok, problems[], rows[] }`. Problems: no explanation; hash mismatch; explanation for a removed function; function in `ranByFlow` is empty (ran in no flow). `rows` feeds the report table.

- [ ] **Step 1: Write failing drift tests** in `test/drift.test.mjs` with fixture inputs for each of the four problem kinds plus an all-green case.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement `functions.mjs` with `acorn`.** Use `ecmaVersion: "latest"`, `sourceType: "module"`, `locations: false`. Hash = SHA-256 of `source.slice(start, end)` as UTF-8. Record `startOffset` for coverage matching.
- [ ] **Step 4: Implement `drift.mjs` and `explain.mjs`.**
- [ ] **Step 5: Run** `node --test test/drift.test.mjs`. Expected: PASS.
- [ ] **Step 6: Write the explanations** for the Task 2 functions with `npm run explain` (the agent does this, in the same commit as the code change). Run `npm run drift`. Expected: exit `0`.
- [ ] **Step 7: Commit** `feat: function scanner, explanations, and drift check`.

---

### Task 5: Verify runner

**Files:**
- Create: `scripts/config.mjs`, `scripts/lib/coverage.mjs`, `scripts/lib/kane.mjs`, `scripts/lib/balance.mjs`, `scripts/verify.mjs`, `test/verify.test.mjs`, `test/fixtures/fake-kane.mjs`
- Modify: `package.json` (`verify` script)

**Interfaces:**
- Consumes: `scanApp`, `checkDrift`, `sha256File`, Task 1 field names and command line
- Produces:
  - `config.mjs`: `FLOWS = ["poll-create","poll-vote","poll-vote-once"]`, `CREDIT_FLOOR = 2000`, `FLOW_TIMEOUT_S = 300` (Task 1: slowest probe took 74.5 s wall), `TUNNEL_MODE`, `REPORTS_DIR`
  - `kane.mjs`: `runKane({ flowFile, url, timeoutS }) -> { exitCode, runEnd, verdict, events, creditsConsumed, packPath }`. Passes the flow file's text as the objective argument, spawned with an args array and no shell, because `kane-cli run` rejects `.md` paths. Step events are the lines with a `step` key and no `type`. `runEnd.status` is `passed` or `failed`. `verdict` appears only on a failed `run_end`. No `run_end` gives `runEnd: null`.
  - `coverage.mjs`: `readRun(coverageDir) -> Map<"file:startOffset", count>`. Missing or empty coverage throws.
  - `balance.mjs`: `getBalance() -> number`, parsed from the `Available credits: <n>` line of `kane-cli balance`.
  - `verify.mjs`: flow loop per the design's verify steps; exit codes as in Global Constraints; writes `reports/NNNN.md` via `report.mjs` (Task 6) and commits it as its own commit that names the tested SHA.

- [ ] **Step 1: Write failing tests** with `fake-kane.mjs` (a stub that writes configured NDJSON and exits with a set code). Cases: pass gives `pass`; exit 1 with verdict gives `fail`; stream ends without `run_end` gives `error`; dirty tree refuses with exit `2`; port taken gives exit `2`; missing coverage gives `error`; unapproved flow hash gives exit `2`.
- [ ] **Step 2: Run** `node --test test/verify.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement modules, then `verify.mjs`.** Run each flow sequentially: start the app on a free port with `DATA_FILE` in a fresh temp dir and `NODE_V8_COVERAGE` in a fresh per-flow folder; run Kane; send SIGTERM; wait for exit; read coverage; stop. Then drift, then report, then commit the report.
- [ ] **Step 4: Run** the verify tests. Expected: PASS.
- [ ] **Step 5: Run real verify** `npm run verify` on the committed app. Record exit code, credits used, and wall time in the report. Expected: exit `0` and a committed `reports/0001.md`.
- [ ] **Step 6: Commit** `feat: verify runner with Kane verdicts and coverage`.

---

### Task 6: Why It Broke report

**Files:**
- Create: `scripts/lib/report.mjs`, `test/report.test.mjs`

**Interfaces:**
- Consumes: flow results from Task 5, `scanApp` output, `explain/functions.json`
- Produces: `renderReport({ head, flows, drift, functions }) -> string` (Markdown). Each flow: verdict; for failures, `family`, `category`, `root_cause`, `suggestion`, `culprit_step`, `confidence`, fault assessment; the trace (every `app/` function that ran in the run, in file order, signature and explanation, source in `<details>`); `culprit_step` shown beside the trace, not mapped. Ends with the drift table.

- [ ] **Step 1: Write failing report tests** with a fixture failing flow and a fixture passing flow: the failure section includes `root_cause`; the trace lists only functions with count > 0; source sits inside `<details>`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement `renderReport`.**
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat: why it broke report renderer`.

---

### Task 7: Evidence redaction

**Files:**
- Create: `scripts/lib/redact.mjs`, `test/redact.test.mjs`
- Modify: `scripts/verify.mjs` (copy redacted evidence into `reports/evidence/NNNN/<flow>/`)

**Interfaces:**
- Consumes: Kane evidence pack path from `kane.mjs`. The `pack` key of the coverage event holds the path even when its status is `skipped`. The stderr line `kane-cli evidence serve <path>` prints the same path.
- Produces:
  - `redact(text) -> string`: replaces email addresses, IPv4 addresses, `/home/ubuntu`, the Kane profile name, and cookie or authorization header values
  - `scanSecrets(text) -> string[]`: returns matches left after redaction; a non-empty result blocks that file
- Cut order item 1: if time is short, skip evidence copies and keep the hash and link only.

- [ ] **Step 1: Write failing tests** with a fixture containing one of each sensitive pattern. Expected: `redact` removes all, `scanSecrets` returns `[]` after redaction and returns matches for an unredacted fixture.
- [ ] **Step 2: Implement and run tests.** Expected: PASS.
- [ ] **Step 3: Wire into verify.** Unzip the pack to a temp dir, redact text files, run `scanSecrets`, copy only clean files.
- [ ] **Step 4: Commit** `feat: redact and scan Kane evidence before commit`.

---

### Task 8: Fix race

**Files:**
- Create: `scripts/race.mjs`, `scripts/race-pick.mjs`, `scripts/race-close.mjs`, `scripts/lib/lock.mjs`, `scripts/lib/brief.mjs`, `scripts/lib/compare.mjs`, `test/race.test.mjs`
- Modify: `package.json` (`race`, `race:pick`, `race:close`)

**Interfaces:**
- Consumes: Task 5 `verify`, Task 6 report, Task 1 `droid exec` flags
- Produces:
  - `lock.mjs`: `acquireLock(raceId, head) -> boolean` (file `~/.why-it-broke/race.lock`, JSON `{raceId, head, state}`); `releaseLock()`; `readLock() -> object|null`
  - `brief.mjs`: `buildBrief({ report, verdicts, trace }) -> string` (written to `reports/races/NNNN/brief.md`)
  - `compare.mjs`: `renderComparison(attempts) -> string`. Names no winner.
  - `race.mjs`: refuses if HEAD is not red, or lock held. Creates worktrees `../why-it-broke-race-NNNN-<a|b|c>` on branches `race/NNNN-<letter>`. Starts three `droid exec --auto medium --cwd <worktree> -f <brief-file> -o stream-json` in parallel, one per worktree, with the brief. `--auto medium` allows local commits and blocks pushes (Task 1). Waits. Counts a racer with no commit as failed. Verifies attempts one at a time in their worktrees. Writes `comparison.md`. With no green attempt, releases the lock and stops.
  - `race-pick.mjs NNNN <letter> --reason "<text>"`: refuses a non-green attempt. Merges `--no-ff` in a temp worktree of main, runs verify there, fast-forwards main only on green, records result in `pick.md`, removes worktrees on success, keeps branches. Red leaves main alone and keeps the lock.
  - `race-close.mjs NNNN`: clears the lock when green attempts exist but no pick.

- [ ] **Step 1: Write failing race tests** with stub `droid` and stub verify (via env `WHY_IT_BROKE_VERIFY_CMD` and `WHY_IT_BROKE_DROID_CMD`, test seams only). Cases: second start refused while locked; no-commit racer is failed; no green gives lock released and main unchanged; pick of red attempt leaves main unchanged and keeps lock; pick of green fast-forwards main.
- [ ] **Step 2: Run** `node --test test/race.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** modules and entry points.
- [ ] **Step 4: Run** the race tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: fix race with worktrees, comparison, and owner pick`.

---

### Task 9: Stop hook

**Files:**
- Create: `scripts/stop-hook.mjs`, `.factory/hooks.json`, `test/stop-hook.test.mjs`

**Interfaces:**
- Consumes: hook stdin JSON (Task 1 format: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `message_id`), `git status`, `reports/` latest tested SHA, `lock.mjs`. `stop_hook_active` comes from an earlier doc read, so confirm it in Step 1 before the loop guard relies on it.
- Produces: exit `2` with a message asking for a commit (uncommitted changes under `app/` or `explain/`); exit `0` with a message when `stop_hook_active` is true; exit `0` after running verify on a new commit; on red that qualifies for a race, starts `race.mjs` detached and exits `0` with the message to the owner; other reds exit `0` with the reason.
- `.factory/hooks.json`: Stop hook, command `node ~/kane/scripts/stop-hook.mjs`, timeout above the longest verify run (default is 60 s).

- [ ] **Step 1: Write failing tests** for each branch by piping JSON to the script.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement the hook and hooks.json.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Live check.** Make a real app change in a scratch branch, end the turn, confirm the hook runs verify. Record the result. If the hook cannot run, use the AGENTS.md fallback (Task 10).
- [ ] **Step 6: Commit** `feat: stop hook runs verify after agent turns`.

---

### Task 10: Agent rules and README

**Files:**
- Create: `AGENTS.md`, `README.md`

**Interfaces:**
- Consumes: final command names and paths from Tasks 5 to 9
- Produces: AGENTS.md rules (builder, racers, everyone) as in the design; README with the one-command start, the three flows, a sample red report link, the race and pick flow, owner-only commands, prior-art credits (Proven, Proofline, GuardianKane, PatchLoop, Plumb, Furnish, Reenact, CodeGraph tools, and the author's iGraph), and a note that the drift check tests process, not truth. No credentials in either file.

- [ ] **Step 1: Write AGENTS.md** with the builder, racer, and everyone rules.
- [ ] **Step 2: Write README.md.**
- [ ] **Step 3: Check** `grep -rnP "\x{2014}" AGENTS.md README.md docs` returns nothing (the em dash code point, so the command itself has no em dash).
- [ ] **Step 4: Commit** `docs: agent rules and README`.

---

### Task 11: End-to-end run and demo checkpoint

**Files:** none new. Reports and commits are produced by the runs.

**Interfaces:**
- Consumes: all prior tasks
- Produces: green main, one real red run from a real agent change, one race with a pick

- [ ] **Step 1: Fresh start.** Clone the repo into a temp dir, run `npm install`, `npm start`, open `http://localhost:3000`, create and vote on a poll by hand. Expected: works.
- [ ] **Step 2: Full verify on main.** Run `npm run verify`. Expected: exit `0`, report committed, credits recorded.
- [ ] **Step 3: Real red.** Let the builder make a real change (no planted bug). If verify goes red from that change, the Stop hook starts a race only if the red qualifies (Fix race rules). Record what happened.
- [ ] **Step 4: Race and pick.** Let the race finish. Owner runs `npm run race:pick -- NNNN <letter> --reason "<text>"`. Expected: main moves only if the merge verifies green.
- [ ] **Step 5: Checkpoint (end of Tue 24 Nov).** Record whether a race ran end to end on a real red. If not, switch to one-at-a-time attempts and say so in the README.
- [ ] **Step 6: Report numbers.** Credits per verify, per race; wall time per verify; exit codes seen. Report only what was observed.

---

## Self-Review

Checks run against the spec while writing this plan:

- **Spec coverage:** App (Task 2), flows and approval (Task 3), verify with coverage and NDJSON verdicts (Task 5), Why It Broke report (Task 6), explanations and drift (Task 4), evidence redaction (Task 7), fix race with owner pick and no-green exit (Task 8), Stop hook (Task 9), AGENTS.md and README (Task 10), end-to-end and demo checkpoint (Task 11). The localhost-or-tunnel gate is in Task 1 and Task 5. The cut order is in Task 7 and Task 11.
- **Type consistency:** `runKane`, `scanApp`, `checkDrift`, `renderReport`, `acquireLock`, `renderComparison`, `redact`, and `scanSecrets` are each named once in their owning task and reused by that name.
- **Calls made in this plan, for the owner to confirm:** drift scope is `app/**/*.mjs` (browser files excluded); `acorn` is a dev dependency for scripts only; test seams `WHY_IT_BROKE_VERIFY_CMD` and `WHY_IT_BROKE_DROID_CMD` exist for tests only.
- **Proportion:** the plan lists interfaces and assertions, not function bodies.

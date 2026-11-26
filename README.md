# Why It Broke

Kane CLI tests a small poll app in a real browser after each change, the way a user would. Each run returns Kane's verdict with its evidence: a screenshot for each step, the network log, and a call on whether the app or the test is at fault.

When a run fails, Why It Broke turns it into a report. The report gives Kane's verdict and the app functions that ran on the failing path, each with a plain explanation. When Kane places a fault in the app, three coding agents each try a fix in their own git worktree, and Kane runs the same flows on every attempt. If exactly one fix passes, the runner merges it. If two or three pass, the owner picks one. Only a fix that passes Kane again can merge. The poll app is the subject under test. What the project shows is Kane's verdict and the fix loop that follows it.

Built for the [KaneCLI Online Hackathon](https://www.kaneclihack.sh/) by TestMu AI. Live showcase and committed reports: [https://etvjay.github.io/broke/](https://etvjay.github.io/broke/).

## Problem definition

AI coding agents write features and unit tests quickly, pass `npm test`, and still ship real browser bugs: double-click duplicate submissions, DOM/HTTP race conditions, and out-of-date code explanations. Unit tests rarely catch live browser interaction bugs, and when an end-to-end test fails without structured fault attribution, an agent told to make CI green can weaken or rewrite the test instead of fixing the application.

## Solution

**Why It Broke** turns [Kane CLI](https://github.com/LambdaTest/kane-cli) into an independent browser judge and merge gate around a small poll app:

1. **Owner-approved plain-English flows (`flows/`):** Every browser check is written in plain English and locked by a SHA-256 hash in `flows/approvals.json`. Builder and racer agents cannot edit or weaken flows.
2. **Real-browser verdict + V8 function trace (`npm run verify`):** On every commit, verify boots a fresh app server, runs all four Kane flows in Chromium, collects V8 coverage of every app function that executed on the flow, verifies source-hashed plain-English explanations (`npm run drift`), redacts secrets/emails/paths from Kane's evidence pack, and commits `reports/NNNN.md`, `reports/NNNN.json`, and `reports/evidence/NNNN/`.
3. **Fault-attributed 3-agent fix race (`npm run race`):** Only when Kane's verdict classifies the failure as an `application_issue` (not a test/flow fault or infrastructure error) does the runner spawn three isolated Factory Droid agents (`a`, `b`, `c`) in separate git worktrees, giving each racer the failing report, V8 trace, and Kane's verdict in `brief.md`.
4. **Kane-gated merge (`npm run race:pick`):** Kane verifies every racer's commit across all four flows and drift. If one passes, the runner merges it; if two or three pass, the owner compares them and picks one. The merged commit must pass one final full Kane verification pass before `main` advances.

## Why it broke: full case study (0009 -> race 0001 -> 0010)

### 1. The bug (what broke and why)

On commit `b35d27f`, all 166 unit tests passed, yet double-clicking **Create poll** created two identical polls in the list. The client form handler in `app/public/app.js` had no in-flight or button-disable guard, and `POST /api/polls` in `app/server.mjs` / `app/store.mjs` had no idempotency key, so both clicks of a single double-click reached the server `0.58 ms` apart and saved two separate polls.

### 2. Where Kane CLI helped and solved the issue

- **Caught what unit tests missed:** Running `poll-create-once.md` in a real browser in report [0009](reports/0009.md) reproduced the duplicate poll creation that unit tests never triggered.
- **Triaged root cause with 0.98 confidence:** Kane returned `family: application_issue`, `category: functional_defect`, `severity: major`, `confidence: 0.98`, `culprit_step: 0-6`, and explicitly cleared the test agent in `agent_fault_assessment` (*"The agent followed the requested double-click interaction... The product should prevent a rapid repeated activation from making duplicate polls"*).
- **Provided the exact diagnosis and suggested fix:** Kane flagged two signals (`step 0-6 [network_failure]: POST http://localhost:42417/api/polls -> 201` and `step 0-9 [objective_contradiction]`) and suggested: *"Disable or debounce Create poll as soon as it is pressed, and have the server reject duplicate rapid submissions so a double-click can create only one poll."*
- **Drove and judged the 3-agent fix race:** Kane's verdict and the 36-function V8 trace fed directly into [reports/races/0001/brief.md](reports/races/0001/brief.md). Three isolated Droid racers built three distinct fixes, and Kane verified all four flows on every attempt:
  - **Attempt `a` (`f74aeba`, +63/-13, 4/4 pass, drift pass — picked by owner):** Client button disable + `creating` in-flight guard + per-form `submissionId` idempotency key (`201` on new create, `200` on replay via `findSubmission`). No fragile time window.
  - **Attempt `b` (`51be746`, +43/-3, 4/4 pass, drift pass):** Client button disable + global 2-second duplicate question/options window (`recentDuplicate`).
  - **Attempt `c` (`107051a`, +58/-17, 4/4 pass, drift pass):** Client disable + `createInFlight` + per-voter 2-second duplicate window.
- **Proved the fix on `main`:** After picking attempt `a` ([pick.md](reports/races/0001/pick.md)), Kane re-verified the merge commit `cb8d7c4` across all four flows in report [0010](reports/0010.md) (`4/4` pass, drift pass, `73.05` credits) before `main` advanced.

### 3. Committed traces and network HAR proofs

**Before fix — Report [0009](reports/0009.md) (`poll-create-once.md`, FAIL, committed [0-network.har](reports/evidence/0009/poll-create-once/tests/open-the-start-page-of-the-poll-app-in-t-8a7bb2fe/logs/0-network.har)):**

```text
2026-11-26T11:50:30.362645+00:00  GET   /api/polls -> 200
2026-11-26T11:50:53.735581+00:00  POST  /api/polls -> 201   (click 1)
2026-11-26T11:50:53.736164+00:00  POST  /api/polls -> 201   (click 2, +0.58 ms)
2026-11-26T11:50:53.750384+00:00  GET   /api/polls -> 200
2026-11-26T11:50:53.755583+00:00  GET   /api/polls -> 200
```

**After fix — Report [0010](reports/0010.md) (`poll-create-once.md`, PASS, committed [0-network.har](reports/evidence/0010/poll-create-once/tests/open-the-start-page-of-the-poll-app-in-t-98563033/logs/0-network.har)):**

```text
2026-11-26T12:48:43.134250+00:00  GET   /api/polls -> 200
2026-11-26T12:49:02.689527+00:00  POST  /api/polls -> 201   (single create; repeat click blocked + submissionId idempotency)
2026-11-26T12:49:02.702282+00:00  GET   /api/polls -> 200
```

**Failing-path V8 function trace (36 functions recorded in [0009.md](reports/0009.md)):** `handleRequest` -> `serveRequest` -> `routeRequest` -> `addPollRoute` -> `readJsonBody` -> `runExclusive` -> `addPollTask` -> `loadPolls` -> `createPoll` -> `savePolls` -> `sendJson`. Full per-function explanations and source blocks are in [reports/0009.md](reports/0009.md) and rendered on the [live showcase page](https://etvjay.github.io/broke/#red-run).

**All committed proof artifacts:**
- Failing verdict & step evidence: [reports/0009.md](reports/0009.md), [reports/0009.json](reports/0009.json), [failure.yaml](reports/evidence/0009/poll-create-once/failure.yaml), [0-actions.ndjson](reports/evidence/0009/poll-create-once/tests/open-the-start-page-of-the-poll-app-in-t-8a7bb2fe/logs/0-actions.ndjson), [0-dag_diagram.md](reports/evidence/0009/poll-create-once/tests/open-the-start-page-of-the-poll-app-in-t-8a7bb2fe/v16-trajectory/0-dag_diagram.md)
- Race 0001 records: [brief.md](reports/races/0001/brief.md), [comparison.md](reports/races/0001/comparison.md), [attempts.json](reports/races/0001/attempts.json), [pick.md](reports/races/0001/pick.md), and attempt reports [a](reports/races/0001/a/report.md), [b](reports/races/0001/b/report.md), [c](reports/races/0001/c/report.md)
- Post-merge green proof: [reports/0010.md](reports/0010.md), [reports/0010.json](reports/0010.json), [reports/evidence/0010/](reports/evidence/0010/)

## Tests and verification layers

| Layer | Command | Scope |
| --- | --- | --- |
| Real-browser Kane CLI flows | `npm run verify` | 4 owner-approved flows in Chromium (`poll-create`, `poll-vote`, `poll-vote-once`, `poll-create-once`) locked by SHA-256 in `flows/approvals.json` |
| Unit & harness test suite | `npm test` | **166 passing tests** across 16 files in `test/` (`store`, `server`, `drift`, `explain`, `flows`, `functions`, `evidence`, `redact`, `report`, `verify`, `lock`, `race-support`, `race`, `stop-hook`, `app-process`, `site`) |
| Explanation & coverage drift | `npm run drift` | AST + SHA-256 verification of all 41 app functions in `app/server.mjs` and `app/store.mjs` against `explain/functions.json` (plus V8 flow coverage check during `verify`) |
| Redaction & static site check | `npm run site` | Byte-identical static build checked for zero secrets, zero emails, zero `/home/` paths, and zero `<script>` tags |

## Status

- Ten verify runs, 0001 to 0010, are committed: 0001 to 0008 and 0010 are green, and 0009 is a real red on the fourth flow, `poll-create-once`.
- In report [0009](reports/0009.md) (commit `b35d27f`), Kane caught a real bug: double-clicking Create poll created two identical polls instead of one. Kane's verdict was `application_issue` (`functional_defect`, `major`) at 0.98 confidence, with two `POST /api/polls -> 201` requests in the evidence.
- Race [0001](reports/races/0001/) ran three Factory Droid racers (`a`, `b`, `c`) sequentially from report 0009 in isolated worktrees. All three passed all four Kane flows and drift (`a`: per-form `submissionId` idempotency key + client guard; `b`: global 2-second duplicate window; `c`: per-voter 2-second duplicate window).
- The owner picked attempt `a` (`f74aeba`) via `npm run race:pick`. The merge (`cb8d7c4`) verified green across all four flows and drift in report [0010](reports/0010.md) (73.05 credits), and race 0001's records committed to main at `42410d6`.
- Both updated race rules are live on main: a sole green fix merges automatically through the pick path, and a race with no green fix commits its records folder to main.
- The race gate first checked for `app_bug`. Kane's verdicts use `application_issue`, so a real app fault would not have started a race. The gate now checks `application_issue` (commit `18cb453`). This was fixed before any red run.
- Committed evidence is text only: network logs, console logs, and failure files. Verify does not copy screenshots into the repo. Kane keeps them in its evidence packs.
- The static report page is live at [https://etvjay.github.io/broke/](https://etvjay.github.io/broke/), built from committed reports on main by GitHub Actions. Run the poll app locally with `npm start`, or read the raw reports on GitHub.
- The code is MIT licensed. See [LICENSE](LICENSE).

## What you need

- Node 24 or later, and git.
- [Kane CLI](https://github.com/LambdaTest/kane-cli) 0.10.4: `npm install -g @testmuai/kane-cli@0.10.4`.
- Chromium or Chrome, for Kane's desktop browser.
- `unzip`, which reads Kane's evidence packs.
- Factory Droid, with `droid` on your PATH. The Stop hook and the racers use it.
- A git identity for this repo, set with `git config user.name` and `git config user.email`. Verify commits each report under it.

## Start the app

```sh
npm install
npm start
```

Open http://localhost:3000. Set `PORT` to use another port. Run `npm install` first. It adds `acorn`, which the drift check uses to read the app's functions. The app itself has no dependencies.

## Sign in to Kane

Verify uses your Kane CLI login. Sign in with `kane-cli login --oauth`, which opens a browser. Or sign in with a username and access key: `kane-cli login --username <user> --access-key <key>`. Judges: the owner shares a judge login through the submission form. This repo holds no login, token, or key.

Check your credits with `kane-cli balance`. Verify stops below 2,000 credits. In the eight committed runs, one verify of all three flows cost 72 to 104 Kane credits, and each flow cost 21 to 38.

You do not need Kane to read the results. Every verify report is committed on main, and the static report page at [https://etvjay.github.io/broke/](https://etvjay.github.io/broke/) renders them from committed main. A failed race commits its records to main; a sole green attempt merges automatically onto main with its records; a race with two or three green attempts holds its records on branch `race/NNNN-report` until the owner's pick copies them onto main.

## The flows

Each flow is plain text in `flows/`. Kane runs the text in a real browser against a fresh copy of the app. All four flows are owner-approved and run in verify.

- `poll-create` makes the poll "Lunch spot?" with two options. It checks that a poll with one option is refused.
- `poll-vote` makes the poll "Favourite colour?" and votes Blue. It checks that the count reads Blue (1).
- `poll-vote-once` makes the poll "Best tea?" and votes Green. It checks that a second vote from the same browser is refused.
- `poll-create-once` double-clicks Create poll once for "Double click once?" and fails if two or more polls with that question appear.

## Verify

```sh
npm run verify
```

Verify runs the flows one at a time. For each flow it starts the app fresh, runs Kane, and records which app functions ran. Then it runs the drift check, writes `reports/NNNN.md` and `reports/NNNN.json`, copies each flow's redacted evidence into `reports/evidence/` when it can, and commits them. Each report names the commit it tested.

The three flows took 4.6 to 5.5 minutes in total in the committed runs. Only one verify writes a report at a time. A second verify stops at once and names the lock file (`.git/why-it-broke-verify.lock` in a normal clone). If no verify is running, delete that file. A lock left by a process that has exited is cleared by itself.

Verify exits 0 when every flow passes and drift passes. It exits 1 when a flow or drift fails, and 2 when a flow errors or verify refuses to run.

The drift check fails when:

- a function in `app/` has no explanation,
- an explanation is stale, because its function changed after it was written,
- an explanation names a function that no longer exists, or
- a function ran in no flow.

`npm run drift` runs the checks that need no Kane run. Verify adds the last one. The drift check tests the process, not the truth. It confirms that each explanation was written for the code as it is now. It does not confirm that the explanation is correct.

## Runs so far

[reports/](reports/) holds every committed run. A red run's report gives Kane's verdict on the failing flow, the functions on its failing path with their explanations, and the drift table.

| Report | Tested commit | What the run tested | Result | Kane credits |
| --- | --- | --- | --- | --- |
| 0001 | 6e196ba | The baseline app and the owner-approved flows | pass | 96.64 |
| 0002 | 910cc99 | The same app and flows, with the redaction rules fixed | pass | 103.79 |
| 0003 | d956c9e | Each browser sees its own vote | pass | 82.93 |
| 0004 | f2df2c2 | A poll whose options repeat is refused | pass | 75.92 |
| 0005 | 7cdb160 | The newest poll is listed first | pass | 100.71 |
| 0006 | 7c51865 | Options that differ only in spacing are refused | pass | 101.24 |
| 0007 | 048d6cc | A poll list that cannot load shows a notice | pass | 75.83 |
| 0008 | eced74a | Each poll shows its total votes | pass | 72.40 |
| 0009 | b35d27f | Fourth flow `poll-create-once` enabled against double-click create bug | fail | 126.19 |
| 0010 | cb8d7c4 | Merged race 0001 winner (attempt `a`, `submissionId` idempotency + client guard) | pass | 73.05 |

Reports 0003 to 0008 each test an app change that the builder agent made, with a failing test or browser check written first. None was planted to fail. In report 0009, enabling the owner-approved `poll-create-once` flow caught the real double-click bug in the app (`application_issue`, 0.98 confidence). Race 0001 ran three real Factory Droid racers (`a`, `b`, `c`) from that red report; all three passed all four Kane flows and drift, the owner picked attempt `a`, and report 0010 confirmed the merged fix green on main.

The Kane balance fell by 776.26 credits between the balance recorded after report 0001 and the one after report 0008. Kane's session records account for 695.39 of that: the 21 runs behind reports 0002 to 0008, plus three runs from one stray run that was never committed. The stray run cost 82.56 credits. That leaves 80.87 credits with no known cause.

Two one-step probe runs each lowered the balance by more than their session record shows. The gaps were 1.95 and 0.39 credits. That may be a small charge that the session records leave out. Two runs are too few to say how large it is or whether it applies to every run.

Git history keeps some data from the first run. Commit `b560bb5`, which commits report 0001, contains three LambdaTest share links, the account name, and the organization and user IDs. Commits `091d665` and `910cc99` removed them from the tracked files, but the history was kept, so each report's tested commit still exists. Kane share links expire seven days after they are made, so the three report 0001 links should expire around 29 November 2026.

## The Stop hook and the race

After an agent turn that changes `app/` or `explain/`, the Stop hook (`.factory/hooks.json`) runs verify. A green run ends the turn. A red run that a race can fix starts a race in the background. A race can fix an app fault that Kane's verdict places in the app, or a drift problem that the code or an explanation can fix. Other reds stop for the owner: a function that no flow ran, a fault Kane places in the flow itself, and Kane errors such as a crash, a timeout, a login problem, or low credits.

1. The runner creates the worktrees `race/NNNN-a`, `race/NNNN-b`, and `race/NNNN-c` from the red commit. It runs one Droid racer at a time, a, then b, then c. Each racer gets the failing report and Kane's verdict, and has 20 minutes. At 20 minutes the runner stops the racer: SIGTERM to its process group, then SIGKILL 10 seconds later. A racer stopped for time fails as racer timed out, and its commit is not verified. Processes a racer leaves behind are stopped when it exits.
2. Each racer changes only `app/` and `explain/`, and commits its fix.
3. As soon as a racer exits, the runner verifies its attempt with the same flows and drift check. The next racer starts after that verify ends.
4. The runner writes `comparison.md`. It lists each attempt's verdicts, drift result, and changed lines. It names no winner.
5. If exactly one attempt is green, the runner merges it through the pick path with no owner command (`pick.md` records `Picked by: runner (the only attempt that passed Kane's verify)`). If two or three attempts are green, the race waits for the owner to pick one: `npm run race:pick -- NNNN a --reason "<why>"` (`pick.md` records `Picked by: owner`). In both paths, the runner merges the attempt and verifies the merged code. If that verify is green, main gets the merge, Kane's report on it, and `pick.md`, and the lock clears. Otherwise main stays where it was, the race keeps its lock, and the merge, its report, and the record stay on branch `pick/NNNN-<letter>`.

If no attempt is green, nothing merges. The race commits its records folder (`reports/races/NNNN/`) to main as `race NNNN: no attempt is green` without changing any app, explanation, or flow file, and clears the race lock so a rerun can start from the same red code. A race with two or three green attempts keeps its records on branch `race/NNNN-report` while it waits for the pick. A race runs three attempt verifies, about 230 to 310 Kane credits in total. The pick runs one more verify, about 76 to 104. Droid racers bill Factory credits, a separate budget from Kane credits. One racer on a one-line test change used 54,841 Factory credits. A racer on a real fix is not measured yet.

If a race stops before it finishes, for example when the machine restarts, its lock goes stale. The next red clears the lock and starts a new race. A lock is stale when the process that holds it has exited. A process id can be reused, so after a restart a lock can look live. Then delete `~/.why-it-broke/race.lock` by hand. Ctrl-C, or a SIGTERM to the race, stops a running racer or attempt verify, and the race then releases its lock. To close a stopped race by hand, run `npm run race:close -- NNNN`.

## Owner commands

Only the owner runs these:

- `npm run flows:approve` records the hash of each flow file after the owner reads it. Verify refuses a flow whose text changed since its approval.
- `npm run race:pick -- NNNN <a|b|c> --reason "<text>"` merges one green attempt into main when two or three attempts are green.
- `npm run race:close -- NNNN` clears the lock on a race that has green attempts waiting for a pick, on a failed auto-merge verify, or on a race that stopped.
- `npm run site:featured -- NNNN [MMMM]` copies candidate screenshots for a red run (and optional matching green run) outside the repo under `~/.why-it-broke/featured/` for owner review before committing approved images under `reports/featured/`.

## Agent rules

[AGENTS.md](AGENTS.md) holds the rules for the builder agent, the racers, and everyone. Every agent in this repo follows them.

## Repo layout

```
app/        the poll app
flows/      the Kane flows and their approvals
explain/    one plain explanation per app function
reports/    committed verify reports, evidence, and race records
scripts/    verify, drift, explain, race, site, and the Stop hook
.github/    GitHub Actions workflow for the static report page
.factory/   the Stop hook config
docs/       the design spec and the build plan
```

## Prior art

Several Kane CLI projects overlap with parts of this one. Credit where it is due:

- [Proven](https://github.com/vijaygopalbalasa/proven) closes a ticket only after Kane sees its frozen test fail before a change and pass after it. This project does not claim receipts as new.
- [Proofline](https://github.com/egbujor-emmanuel/proofline) ties a code change to the requirements it can break, and runs the tests that cover them.
- [GuardianKane](https://github.com/18Abhinav07/adventures-with-kane) runs a Stop hook and shows a red-to-green dashboard.
- [PatchLoop](https://github.com/demonchant/kane-cli) runs one repair in an isolated worktree, and accepts it only after a passing Kane rerun.
- [Plumb](https://github.com/zkasuran/plumb) turns design rules into Kane flows, and sends each failed step back to the coding agent.
- [Furnish](https://github.com/Joystonm/furnish) is a home-design studio that an independent Kane browser agent tested.
- [Reenact](https://dev.to/memeshe/i-made-a-browser-prove-my-ais-bug-fix-3hhj) reproduces a GitHub bug report in a browser, then checks the fix. The link is the author's write-up.
- CodeGraph tools, such as [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) and [codegraph-ai/CodeGraph](https://github.com/codegraph-ai/CodeGraph), map which code calls which, for coding agents. This project shows which flows ran each function. It does not predict impact.
- [iGraph](https://github.com/etvjay/iGraph) is the author's earlier project for Build with DataHub. It maps data lineage, not code, and no code is reused here.

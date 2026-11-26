# Why It Broke

Kane CLI tests a small poll app in a real browser after each change, the way a user would. Each run returns Kane's verdict with its evidence: a screenshot for each step, the network log, and a call on whether the app or the test is at fault.

When a run fails, Why It Broke turns it into a report. The report gives Kane's verdict and the app functions that ran on the failing path, each with a plain explanation. When Kane places a fault in the app, three coding agents each try a fix in their own git worktree, and Kane runs the same flows on every attempt. If exactly one fix passes, the runner merges it. If two or three pass, the owner picks one. Only a fix that passes Kane again can merge. The poll app is the subject under test. What the project shows is Kane's verdict and the fix loop that follows it.

Built for the [KaneCLI Online Hackathon](https://www.kaneclihack.sh/) by TestMu AI.

## Status

- Eight verify runs, 0001 to 0008, are committed. All eight are green.
- The race has not run on a real red yet. It is built and tested with fake racers and a fake verify.
- Two race rules change before the first real race. A sole green fix will merge without an owner command, and a race with no green fix will commit its records to main. The spec's Fix race section has both rules. Until that change lands, the race sections below describe the current code.
- In a scratch run on 25 November, Kane caught a real bug. Double-clicking Create poll made two identical polls. Kane's verdict was `application_issue` at 0.98 confidence. The network log shows two POST requests, both 201. The scratch run is not a verify report, and its evidence pack is not in this repo. The bug is still in the app. The flow that checks for it, `poll-create-once`, waits for the owner's approval.
- The race gate first checked for `app_bug`. Kane's verdicts use `application_issue`, so a real app fault would not have started a race. The gate now checks `application_issue` (commit `18cb453`). This was fixed before any red run.
- Committed evidence is text only: network logs, console logs, and failure files. Verify does not copy screenshots into the repo. Kane keeps them in its evidence packs.
- There is no hosted site. Run the app with `npm start`, or read the reports on GitHub.
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

You do not need Kane to read the results. Every verify report is committed on main. Each race's records are committed on branch `race/NNNN-report`, and a pick copies them onto main.

## The three flows

Each flow is plain text in `flows/`. Kane runs the text in a real browser against a fresh copy of the app.

- `poll-create` makes the poll "Lunch spot?" with two options. It checks that a poll with one option is refused.
- `poll-vote` makes the poll "Favourite colour?" and votes Blue. It checks that the count reads Blue (1).
- `poll-vote-once` makes the poll "Best tea?" and votes Green. It checks that a second vote from the same browser is refused.

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

Reports 0003 to 0008 each test an app change that the builder agent made, with a failing test or browser check written first. None was planted to fail. Reports 0006 to 0008 were the last three tries the owner allowed, and all three passed. No run has gone red, so the race has not run on a real red, and no pick has run. The race is tested with fake racers and a fake verify. One Droid racer has run once, on a one-line test change, through the same process code. The 20-minute limit and a racer's cost on a real fix are untested.

The Kane balance fell by 776.26 credits between the balance recorded after report 0001 and the one after report 0008. Kane's session records account for 695.39 of that: the 21 runs behind reports 0002 to 0008, plus three runs from one stray run that was never committed. The stray run cost 82.56 credits. That leaves 80.87 credits with no known cause.

Two one-step probe runs each lowered the balance by more than their session record shows. The gaps were 1.95 and 0.39 credits. That may be a small charge that the session records leave out. Two runs are too few to say how large it is or whether it applies to every run.

Git history keeps some data from the first run. Commit `b560bb5`, which commits report 0001, contains three LambdaTest share links, the account name, and the organization and user IDs. Commits `091d665` and `910cc99` removed them from the tracked files, but the history was kept, so each report's tested commit still exists. Kane share links expire seven days after they are made, so the three report 0001 links should expire around 29 November 2026.

## The Stop hook and the race

After an agent turn that changes `app/` or `explain/`, the Stop hook (`.factory/hooks.json`) runs verify. A green run ends the turn. A red run that a race can fix starts a race in the background. A race can fix an app fault that Kane's verdict places in the app, or a drift problem that the code or an explanation can fix. Other reds stop for the owner: a function that no flow ran, a fault Kane places in the flow itself, and Kane errors such as a crash, a timeout, a login problem, or low credits.

1. The runner creates the worktrees `race/NNNN-a`, `race/NNNN-b`, and `race/NNNN-c` from the red commit. It runs one Droid racer at a time, a, then b, then c. Each racer gets the failing report and Kane's verdict, and has 20 minutes. At 20 minutes the runner stops the racer: SIGTERM to its process group, then SIGKILL 10 seconds later. A racer stopped for time fails as racer timed out, and its commit is not verified. Processes a racer leaves behind are stopped when it exits.
2. Each racer changes only `app/` and `explain/`, and commits its fix.
3. As soon as a racer exits, the runner verifies its attempt with the same flows and drift check. The next racer starts after that verify ends.
4. The runner writes `comparison.md`. It lists each attempt's verdicts, drift result, and changed lines. It names no winner.
5. The owner picks a green attempt: `npm run race:pick -- NNNN a --reason "<why>"`. The runner merges it and verifies the merged code. If that verify is green, main gets the merge, Kane's report on it, and a pick record with the verdict. Otherwise main stays where it was, and the merge, its report, and the record stay on branch `pick/NNNN-<letter>`.

If no attempt is green, nothing merges. The records go to branch `race/NNNN-report`, and the race lock clears so the owner can decide the next step. A green race puts its records on the same branch while it waits for the pick. A race runs three attempt verifies, about 230 to 310 Kane credits in total. The owner's pick runs one more verify, about 76 to 104. Droid racers bill Factory credits, a separate budget from Kane credits. One racer on a one-line test change used 54,841 Factory credits. A racer on a real fix is not measured yet.

If a race stops before it finishes, for example when the machine restarts, its lock goes stale. The next red clears the lock and starts a new race. A lock is stale when the process that holds it has exited. A process id can be reused, so after a restart a lock can look live. Then delete `~/.why-it-broke/race.lock` by hand. Ctrl-C, or a SIGTERM to the race, stops a running racer or attempt verify, and the race then releases its lock. To close a stopped race by hand, run `npm run race:close -- NNNN`.

## Owner commands

Only the owner runs these:

- `npm run flows:approve` records the hash of each flow file after the owner reads it. Verify refuses a flow whose text changed since its approval.
- `npm run race:pick -- NNNN <a|b|c> --reason "<text>"` merges one green attempt into main.
- `npm run race:close -- NNNN` clears the lock on a race that has green attempts but no pick, or on a race that stopped.

## Agent rules

[AGENTS.md](AGENTS.md) holds the rules for the builder agent, the racers, and everyone. Every agent in this repo follows them.

## Repo layout

```
app/        the poll app
flows/      the three Kane flows and their approvals
explain/    one plain explanation per app function
reports/    committed verify reports, evidence, and race records
scripts/    verify, drift, explain, race, and the Stop hook
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

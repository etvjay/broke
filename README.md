# Why It Broke

A poll app that Kane CLI tests. When a Kane run fails, the report says why. It gives Kane's verdict and the app functions that ran on the failing path, each with a plain explanation. When a coding agent can fix the fault, three agents each try a fix in their own git worktree. Kane verifies every attempt, and the owner picks the one to keep.

Built for the [KaneCLI Online Hackathon](https://www.kaneclihack.sh/) by TestMu AI.

## What you need

- Node 24 or later, and git.
- [Kane CLI](https://github.com/LambdaTest/kane-cli) 0.10.4: `npm install -g @testmuai/kane-cli@0.10.4`.
- Chromium or Chrome, for Kane's desktop browser.
- `unzip`, which reads Kane's evidence packs.
- Factory Droid, with `droid` on your PATH. The Stop hook and the racers use it.

## Start the app

```sh
npm install
npm start
```

Open http://localhost:3000. Set `PORT` to use another port. Run `npm install` first. It adds `acorn`, which the drift check uses to read the app's functions. The app itself has no dependencies.

## Sign in to Kane

Verify uses your Kane CLI login. Sign in with `kane-cli login --oauth`, which opens a browser. Or sign in with a username and access key: `kane-cli login --username <user> --access-key <key>`. Judges: the owner shares a judge login through the submission form. This repo holds no login, token, or key.

Check your credits with `kane-cli balance`. Verify stops below 2,000 credits. All three flows cost about 33 to 63 credits per verify.

You do not need Kane to read the results. Every report and race comparison is committed in this repo.

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

Verify exits 0 when every flow passes and drift passes. It exits 1 when a flow or drift fails, and 2 when a flow errors or verify refuses to run.

The drift check fails when:

- a function in `app/` has no explanation,
- an explanation is stale, because its function changed after it was written,
- an explanation names a function that no longer exists, or
- a function ran in no flow.

`npm run drift` runs the checks that need no Kane run. Verify adds the last one. The drift check tests the process, not the truth. It confirms that each explanation was written for the code as it is now. It does not confirm that the explanation is correct.

## Sample red run

[reports/](reports/) holds the committed runs. A red report gives Kane's verdict on the failing flow, the functions on its failing path with their explanations, and the drift table.

## The Stop hook and the race

After an agent turn that changes `app/` or `explain/`, the Stop hook (`.factory/hooks.json`) runs verify. A green run ends the turn. A red run that a race can fix starts a race in the background. A race can fix an app fault that Kane's verdict places in the app, or a drift problem that the code or an explanation can fix. Other reds stop for the owner: a function that no flow ran, a fault Kane places in the flow itself, and Kane errors such as a crash, a timeout, a login problem, or low credits.

1. The runner creates the worktrees `race/NNNN-a`, `race/NNNN-b`, and `race/NNNN-c` from the red commit. It starts one Droid racer in each, all at once. Each racer gets the failing report and Kane's verdict, and has 20 minutes.
2. Each racer changes only `app/` and `explain/`, and commits its fix.
3. The runner verifies each attempt in turn, with the same flows and drift check.
4. The runner writes `comparison.md`. It lists each attempt's verdicts, drift result, and changed lines. It names no winner.
5. The owner picks a green attempt: `npm run race:pick -- NNNN a --reason "<why>"`. The runner merges it, then verifies the merged code. If that verify is green, the merge and its report reach main together. Otherwise main stays where it was.

If no attempt is green, nothing merges. The records stay on branch `race/NNNN-report`, and the race lock clears so the owner can decide the next step. A race costs about three verifies' worth of Kane credits.

## Owner commands

Only the owner runs these:

- `npm run flows:approve` records the hash of each flow file after the owner reads it. Verify refuses a flow whose text changed since its approval.
- `npm run race:pick -- NNNN <a|b|c> --reason "<text>"` merges one green attempt into main.
- `npm run race:close -- NNNN` clears the lock on a race that has green attempts but no pick.

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

# Why It Broke: Report Page Design

**Date:** 2026-11-26
**Status:** Approved by the owner on 26 Nov, which chose to show failed races. Version 4 (this version) says how, including the race rule changes in "Failed races". The other agent builds from `docs/superpowers/plans/2026-11-26-report-page.md`. Nothing is built yet.

## Intent

A public page that explains one Kane failure from start to finish, and shows the fix loop closing. Judges and repo visitors should understand the whole loop in one pass. The poll app stays in the background. Kane's verdict and evidence carry the page.

The page also shows the three judging bars: the app works end to end, Kane caught something, and the agent and Kane talked to each other.

## Roles

- This design and its plan are written by the design agent. It does not build the page.
- The page builder is the other agent. It builds the generator, the copy step, the workflow, and the race change in "Failed races", then hosts the page.
- In this document, "builder" means the page builder. AGENTS.md uses "builder" for the agent that changes app code, which is a different role.

## Approaches

Layout, chosen: A.

- A. One story page: the loop, the red run, the race, then all runs. Read top to bottom from one URL. It is long, but the failure reads in order. **Chosen.**
- B. Index with a page per run: each run has its own link. Judges must click through, and the story splits across pages.
- C. Stats first: totals at the top, the failure story lower down. The numbers come before the proof.

Look, chosen: Report.

- Report: white page, dark text, green and red status chips, monospace for traces and source. It matches the Markdown reports already in the repo. **Chosen.**
- Terminal: dark, monospace throughout, like Kane's CLI output. Harder to read at length.
- Cards: light cards with colored bars and large numbers. It adds decoration the reports do not have.

## Owner decisions (26 Nov)

- Layout: one story page.
- Look: Report.
- Screenshots: the red run's failing step, and the same step in the green run after the pick. Two images in all, one per run. Other runs are text only. The owner checks each image before it is committed.
- Race: a race appears on the page once its records reach main. That happens after a pick, or when no attempt passed. A race still waiting for a pick does not appear.
- Failed races (no green attempt): shown. See "Failed races" for how.
- Hosting: GitHub Pages, built and deployed by the other agent. This amends the 22 Nov spec's non-goal "no hosted service" for this static page only.
- Approved for the other agent: changes under `scripts/`, `test/`, `.github/`, `.gitignore`, and `package.json`. GitHub Pages enabled with the GitHub Actions source, which makes the page public.

## Failed races (no green attempt)

The 22 Nov spec (Fix race, step 8) says that when no attempt is green, nothing merges and main stays at its red HEAD. Showing failed races changes that rule in two ways:

1. **Main moves by one records commit.** When no attempt is green, the race copies its folder to `reports/races/NNNN/` on the checked-out branch, which must be main. It commits the folder as `race NNNN: no attempt is green`, with the repo's co-author trailer. The commit adds only that folder. It changes no file under `app/`, `explain/`, or `flows/`, and merges no racer branch. Racer branches and worktrees stay local, as now. The owner pushes the commit, as with any commit.
2. **The next race can still start from the same red code.** A race starts from the latest red report when the code at HEAD matches the code at that report, outside `reports/races/`, and the report's tested commit is the commit before the report. The spec's rerun path still works: the owner runs `npm run race` again on the same red code. A code change after the red report makes the race refuse, as before.

Point 1 has two more effects:

- The brief's earlier attempts match on the red report's tested commit, not on HEAD, because HEAD now moves. `attempts.json` records that commit as `tested`.
- The next race number also counts the `reports/races/NNNN` folders on main. A fresh clone then cannot reuse a number. A race refuses to write a folder that already exists.

A race with a green attempt keeps its records on a local branch until the pick, as now.

Cost if wrong: main gains one commit per failed race. Anyone who expects main to equal the red commit will see extra history. The start rule is the riskiest change, so tests must show that a race refuses after a code change.

## Open for the owner

- A green race that the owner closes with `npm run race:close -- NNNN` stays off the page, because its records stay on its local branch. Default: off. Say so if it should show. It would follow the same rule as a failed race.

## Design calls (checked against the code)

- **Red run:** the newest report that has a failing flow. Older red runs stay in the all-runs table, with their verdicts and races.
- **Race for a red run:** the folder `reports/races/NNNN/` on main whose `comparison.md` says "The red report is MMMM.", where MMMM is the red run. NNNN is the race's own number, not a report number. If several races name the red run, the story uses the newest one.
- **Picked race:** the folder has `pick.md`. **Failed race:** it has none.
- **Green run after the pick:** the report on main whose tested commit is the pick's merge commit. That merge has two parents: main before the pick, and the picked attempt's commit. `pick.md` gives both as short SHAs ("Main was at ..." and "commit ..."). If no report matches, the page says so. It does not guess.
- **Attempt commits:** the picked attempt's commit is on main, so it links on GitHub. Other attempts' commits exist only on the owner's machine, so the page shows them as text.
- **Loop steps:** Change (the red run's tested commit), Kane verdict (the failing flow's family), Race (a race folder on main names this red run), Pick (`pick.md` is on main), Green main (the green run above). For a failed race, Pick says "Not picked: no attempt passed." and Green main says "Not reached." A step without data says "not yet."
- **Functions, explanations, and source:** the function list and explanations come from each flow's trace in the report JSON, which recorded them at test time. The source comes from the function's block in the report's Markdown, which also recorded it at test time. The generator never reads `explain/` or the working tree.
- **Failure title:** Kane's root `failure.yaml` has one row per failing step. A row includes the step's `title` only when the step record has one, and the page shows that title. Without one, the page shows the step name and the error message (or the expected and actual values) from the step's own `failure.yaml` under `tests/<test>/steps/`.
- **Generator input:** committed `main` only. The same commit gives byte-identical HTML.
- **Empty states:** "No red run yet. The first red run appears here, with Kane's verdict and the functions that ran." "No race has reached main yet. A race appears here once it picks an attempt or when no attempt passes." "No pick on main yet." "No green run after a pick yet."
- **Status chips:** PASS (green), FAIL (red), PENDING (gray). Each chip has a text label, so color is not the only cue.
- **Type and color:** system fonts only, one accent color, text contrast of at least 4.5 to 1, one column that works at phone width.
- **No JavaScript:** source blocks use `details` and `summary`.
- **Generator command:** `npm run site` runs `scripts/site.mjs` and writes `site/`. It makes no network calls and escapes all text.

## Goals

1. Show the red run: Kane's verdict, the functions that ran, and the featured screenshot.
2. Show the race: its attempts, their verdicts, the drift result, and either the pick with its reason or the fact that no attempt passed.
3. Show the green run after the pick, with its flow results and the featured screenshot of the same step.
4. Show every committed run in one table, each row linked to its report on GitHub.
5. Show the drift result for each run.
6. Say so plainly when a section has no data yet.
7. Stay static: generated HTML and CSS, no server, no database, no account, no tracking.

## Non-goals

- No live app, login, comments, analytics, or JavaScript framework.
- No screenshots beyond the featured ones.
- No claim beyond what the reports and race records show.

## Anti-goals

- Hiding a failed run, or showing only the green ones. Failed races show too.
- Claiming a catch that no committed red run shows.
- Presenting the 25 Nov scratch run as an official run.

## Layout, top to bottom

1. **Header.** "Why It Broke", then one line: "Kane CLI runs this poll app in a real browser. When a run fails, this page shows why, and how the fix loop closed." Links to the repo, the README, and the Kane CLI page.
2. **Latest status.** The newest report: its tested commit and its three flow results.
3. **The loop.** Five steps in order: Change, Kane verdict, Race, Pick, Green main. Each shows its state from the files.
4. **The red run.** The flow name and the failure title. For failing flows, Kane's verdict fields: family, category, root cause, suggestion, fault assessment (only when Kane gives one), confidence, and culprit step. Then the functions that ran, in file order, each with its explanation and its source in a collapsed block. Then the red run's featured screenshot.
5. **The race.** Shown once its records are on main. For each attempt: letter, commit, status and reason, verdict per flow, drift result, and lines changed. A picked race then shows the pick and its reason. A failed race says "No attempt passed. No code was merged." Before any race reaches main, this section shows its empty state.
6. **The green run after the pick.** The verify report on main, its flow results, and the green run's featured screenshot.
7. **All runs.** One row per report: number, tested commit, three flow results, Kane credits, race (none, no green attempt, or picked, each linked to the race folder on GitHub), and links to the report and its text evidence on GitHub.
8. **Footer.** MIT license, the README link, and a note that evidence is text except for the featured screenshots.

## Data sources

- `reports/NNNN.json`: number, testedCommit, outcome, flows (name, outcome, reason, verdict, steps, credits, seconds, trace), and drift (ok, skipped, problems). Each trace entry has the file, line, name, status, and explanation of one function.
- `reports/NNNN.md`: the source block under each function heading. The generator reads only these blocks.
- `reports/evidence/NNNN/<flow>/`: text evidence, including the root `failure.yaml` index and `run.yaml`, which holds the `run_id`. Each failing step has its own `failure.yaml` under `tests/<test>/steps/`. Screenshots are not committed.
- `reports/races/NNNN/`: `comparison.md`, `brief.md`, `attempts.json`, one folder per attempt (`a`, `b`, `c`) holding `report.md`, `summary.json`, and text evidence, and `pick.md` for a picked race. Racer transcripts and `verify.log` are not in the folder.
- The page builder reads the code that writes these files (`scripts/lib/race-support.mjs`, `scripts/race.mjs`, `scripts/race-pick.mjs`, `scripts/lib/compare.mjs`). It tests each field name against a fixture written by that code, because no real race has run yet.
- Verdict fields: family, category, root_cause, suggestion, agent_fault_assessment, confidence, and culprit_step, as `scripts/lib/report.mjs` writes them. Passing flows have an empty verdict, so the page shows verdict fields only for failing flows.

## Featured screenshots

- Verify skips images, so they never reach the repo. A separate copy step takes them from the sealed Kane packs on this machine.
- The red image is the first failing step of the failing flow, from its root `failure.yaml`. The green image is the step with the same `summary` in the green run after the pick.
- Packs are zip files at `~/.testmuai/kaneai/sessions/<session>/evidence/<run_id>.evidence`. Each step folder holds `screenshot.jpg`, and some also hold `annotated.png`. The copy step finds each pack by the `run_id` in the run's `run.yaml`. It matches steps by the `summary` in each `step.json`, never by step number, because numbers change after a fix.
- The copy step runs only when the owner asks: `npm run site:featured -- NNNN [MMMM]`. It writes candidates outside the repo, under `~/.why-it-broke/featured/`, and prints each match: the summary, the pack, and the file. A summary that matches no step, or more than one, copies nothing, and the copy step says so.
- The owner checks each candidate, then copies the approved images to `reports/featured/NNNN/red.<ext>` and `reports/featured/MMMM/green.<ext>`, and commits them. The page shows an image only when its file exists.

## Hosting

- Pages source: GitHub Actions.
- Workflow `.github/workflows/pages.yml`: on push to `main` and on manual start, check out the repo with full history, set up Node 24, run `npm run site`, upload `site/`, and deploy it.
- `site/` is git-ignored, because the workflow builds it.
- Expected URL: https://etvjay.github.io/broke/
- `docs/` is not served, so the launch drafts and the specs stay off the page.

## Files this task changes

- Race engine: `scripts/race.mjs`, `scripts/lib/race-support.mjs`, `test/race.test.mjs`, `test/race-support.test.mjs`.
- Generator and copy step: `scripts/site.mjs`, `scripts/site-featured.mjs`, `test/site.test.mjs`.
- `.github/workflows/pages.yml`.
- `package.json`: scripts `site` and `site:featured`.
- `.gitignore`: one line, `site/`.
- Not changed: `app/`, `explain/`, `flows/`, `docs/`, `README.md`, `AGENTS.md`, `.factory/`. The README link to the page needs the owner's approval once the page is live.

## Known limits

- The red story needs a real red run. That needs flow `poll-create-once` approved and an app failure that Kane catches. Until then the page shows its empty states.
- The 25 Nov scratch red run is not an official run, so the page does not show it.
- A race that stopped before it ended has incomplete records, so the page does not show it.

## Acceptance checks

1. `npm run site` builds `site/index.html` from the eight current reports, with all eight rows linked. With no red run yet, the story shows its empty states.
2. A fixture covers a red run with one failing step with a title and one without, a picked race, and a failed race with an attempt that has no commit. The red, race, and green sections fill in correctly. The failed race reads "No attempt passed", and screenshots appear only where featured.
3. Engine: a race with no green attempt commits its folder to main, changes no code, and releases the lock. A second race from the same red code starts. A code change after the red report makes the race refuse. An existing `reports/races/NNNN/` is never overwritten.
4. Running the generator twice on the same commit gives identical output.
5. The generated page contains no Kane login, token, email address, or home path. A test checks this.
6. Every link on the live page resolves.
7. `npm test` and `npm run drift` still pass.
8. The live page is checked in a desktop browser and at phone width. The checker records what it saw.

## Left to the page builder

- CSS values, spacing, and chip colors within the Report look.
- Copy beyond the header, the section titles, and the empty states.
- Exact parsers for the race files, after reading the code that writes them.

## Owner actions

- Done on 26 Nov: approve the design, choose to show failed races, approve the other-agent task, and approve GitHub Pages with the Actions source.
- Still open: approve flow `poll-create-once` with `npm run flows:approve`. The first red run depends on it.
- After the page is live: decide the README link and the "no hosted site" line.

# Report Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task, in one session and in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and host a static Why It Broke page from committed reports and race records, and let the records of a failed race reach main.

**Architecture:** A Node generator (`scripts/site.mjs`) reads committed files at HEAD and writes `site/`. A GitHub Actions workflow builds `site/` on each push to `main` and deploys it to GitHub Pages. A copy step (`scripts/site-featured.mjs`) writes candidate screenshots outside the repo for the owner to approve. The race engine (`scripts/race.mjs`) commits the records of a race with no green attempt to main. Its start rule accepts only records commits after the red report.

**Tech Stack:** Node 24 ESM with `node:test`. `npm test` runs `node --test test/*.test.mjs`. No new dependencies. Git. GitHub Actions. `unzip` at `/usr/bin/unzip`. python3 builds zip fixtures in tests, because no `zip` binary is installed.

**Spec:** `docs/superpowers/specs/2026-11-26-report-page-design.md` (version 4). This plan argues from the spec. Read both before you start.

## Global Constraints

- Change only `scripts/`, `test/`, `.github/`, `.gitignore`, and `package.json`. Commit files under `reports/featured/` only after the owner approves them. Do not change `app/`, `explain/`, `flows/`, `docs/`, `README.md`, `AGENTS.md`, or `.factory/`.
- Do not run `npm run verify`, `npm run flows:approve`, `npm run race:pick`, `npm run race:close`, or any Kane command. They spend credits or write reports. Race tests use the fakes in `test/fixtures/`.
- Keep Kane logins, tokens, access keys, email addresses, and home paths out of every committed file, test output, and generated page.
- The page uses no JavaScript. Source blocks use `details` and `summary`. Use system fonts and text contrast of at least 4.5 to 1.
- No em dashes or en dashes in page copy or new docs.
- Commit subjects are lowercase with a type prefix (`feat:`, `ci:`), as in `git log`. End each message with the trailer in `COAUTHOR` (`scripts/lib/git.mjs`).
- Task 1 must reach main before the owner runs a race on a real red. Otherwise a failed race's records stay on a local branch, and the page cannot show them.
- If the spec and the code disagree, or a change outside the allowed paths seems needed, stop and tell the owner.

## Review Focus

1. A records commit moves main. A race must still start from the same red code, and must refuse after a code change (Task 1).
2. An attempt with no commit and no flows must render with "not verified" in place of missing data (Task 2).
3. A failing step with no title, or with no step `failure.yaml`, must still show its own message (Task 2).
4. A summary that matches zero steps, or several, must copy nothing and say so (Task 3).
5. A race whose pick has no matching green report must show "No green run after a pick yet", never a guessed report (Task 2).

## Task 1: Records of a failed race reach main

**Files:**
- Modify: `scripts/race.mjs` (no-green path, `startingRed`, the `attempts.json` write, `earlierAttempts`), `scripts/lib/race-support.mjs` (`nextRaceNumber`)
- Test: `test/race.test.mjs` (the assertions near lines 212 to 246 read `race/0001-report`; change them to read main), `test/race-support.test.mjs`

**Interfaces:**
- Produces: `commitRecordsToMain({ root, number, dir }) -> string`, the new short SHA. Keep it in `scripts/race.mjs`. It throws unless HEAD is on `main`, and it throws if `reports/races/NNNN/` already exists. It copies with `copyRecords`, stages the folder, and commits `race NNNN: no attempt is green` with the COAUTHOR trailer.
- Produces: `startingRed(root, log) -> { number, head, tested, summary } | null`. `head` is HEAD. The rule: the latest report commit R must be an ancestor of HEAD. `git diff --name-only R HEAD -- ':(exclude)reports/races'` must print nothing. `summary.testedCommit` must equal the parent of R.
- Changes: `attempts.json` gets `tested` (the red report's tested commit) next to `base` (HEAD). `earlierAttempts(tested)` matches on `tested`, not `base`.
- Changes: `nextRaceNumber(root)` also counts the folders named `NNNN` under `reports/races/`.

**Steps:**
- [ ] **Step 1: Write failing tests.** In `test/race.test.mjs`: (a) a race with no green attempt adds one commit on main, `git diff --name-only HEAD~1 HEAD` lists only `reports/races/NNNN/` paths, the lock is released, and the exit code is 1. (b) A second race from the same red code starts. (c) A commit that changes `app/` after the red report makes the race refuse. (d) An existing `reports/races/NNNN/` makes the commit refuse. In `test/race-support.test.mjs`: (e) `nextRaceNumber` counts a folder that exists only under `reports/races/` on main.
- [ ] **Step 2: Run `npm test`.** Confirm that (a) to (e) fail, each for the reason its test states.
- [ ] **Step 3: Implement `commitRecordsToMain`.** Call it on the no-green path, and log `race NNNN: No attempt is green. Nothing merged. The records are committed to main at <sha>. The lock is released.` Keep `keepRecords` for the green path only, and update its comment.
- [ ] **Step 4: Implement the start rule, the `tested` field, `earlierAttempts(tested)`, and the repo count in `nextRaceNumber`.**
- [ ] **Step 5: Run `npm test`.** Every test must pass. Record the pass count.
- [ ] **Step 6: Commit** `feat: commit a failed race's records to main`.

## Task 2: Page data and HTML

**Files:**
- Create: `scripts/site.mjs`, `test/site.test.mjs`
- Modify: `package.json` (script `site`), `.gitignore` (add the line `site/`)

**Interfaces:**
- Produces: `loadSite({ root }) -> data`. It reads committed files at HEAD with `git show` or `git ls-tree`, and never the working tree. `data` holds `runs` (one entry per report: number, testedCommit, outcome, flows, drift, credits, and its race), `red` (the newest report with a failing flow, or null), `race` (the newest folder on main that names the red run, or null), and `green` (the report whose tested commit is the pick's merge commit, or null).
- Produces: `renderSite(data) -> string`. One HTML document with inline CSS and no script.
- The CLI writes `site/index.html` and nothing else.

**Steps:**
- [ ] **Step 1: Write failing tests.** Build a temporary git repo, as `test/race.test.mjs` does. Cover: (a) a red report with two failing steps, one with a title and one without a title; the one without shows the message from its own step `failure.yaml`. (b) A picked race with `pick.md`, and a green report whose tested commit is the merge. (c) A failed race with an attempt whose commit is null and whose flows are null. (d) A `<script>` tag in a step summary, which must be escaped. (e) The output has no token-shaped string, no email address, and no `/home/`. (f) Two runs on the same commit give identical bytes. (g) A picked race whose green report is missing: the page says "No green run after a pick yet." (h) A failing step with no step `failure.yaml`: the page shows the step name and says no message was recorded.
- [ ] **Step 2: Implement `loadSite`** with the selection rules in the design's "Design calls" section.
- [ ] **Step 3: Implement `renderSite`** with the sections in the design's "Layout, top to bottom", the empty states, and a text label on every chip. Link each report and each race folder to GitHub.
- [ ] **Step 4: Run `npm run site` on this repo.** `site/index.html` must list reports 0001 to 0008, each linked to its report on GitHub, and show the empty states for the red run and the race.
- [ ] **Step 5: Add `site/` to `.gitignore` and the `site` script to `package.json`.**
- [ ] **Step 6: Run `npm test` and `npm run drift`.** Both must pass.
- [ ] **Step 7: Commit** `feat: build the report page from committed records`.

## Task 3: Featured screenshot copy step

**Files:**
- Create: `scripts/site-featured.mjs`
- Test: `test/site.test.mjs`
- Modify: `package.json` (script `site:featured`)

**Interfaces:**
- CLI: `npm run site:featured -- NNNN [MMMM]`. NNNN is the red run. MMMM is the green run, optional.
- Reads: the first row of the failing flow's root `failure.yaml` under `reports/evidence/NNNN/<flow>/`. Its `path` names the step folder. Reads the `run_id` from each run's `run.yaml`.
- Finds: `~/.testmuai/kaneai/sessions/*/evidence/<run_id>.evidence`, a zip. Use `os.homedir()`, so a test can point HOME at a temp folder. Lists entries with `unzip -Z1` and extracts with `unzip -p`. If `unzip` is missing, stop with a clear message.
- Writes: candidates to `~/.why-it-broke/featured/NNNN/` and `~/.why-it-broke/featured/MMMM/`, each with a `matches.txt`. It never writes into the repo.

**Steps:**
- [ ] **Step 1: Write failing tests.** Build the zip in the test with python3's `zipfile` module. Cover one match, zero matches, and two matches. Each case checks what is copied and what `matches.txt` lists.
- [ ] **Step 2: Implement the match.** Match each step by the `summary` in its `step.json`. Never match by step number.
- [ ] **Step 3: Run `npm test`.** Every test must pass.
- [ ] **Step 4: Commit** `feat: copy candidate screenshots outside the repo`.

## Task 4: Pages workflow

**Files:**
- Create: `.github/workflows/pages.yml`

**Steps:**
- [ ] **Step 1: Write the workflow.** Triggers: `push` to `main`, and `workflow_dispatch`. Permissions: `contents: read`, `pages: write`, `id-token: write`. One concurrency group, `pages`. Steps: checkout with `fetch-depth: 0`; setup-node with Node 24; `npm ci`; `npm run site`; upload the `site` folder as the Pages artifact; deploy it. Use the current major version of each official action.
- [ ] **Step 2: Check that the YAML parses,** with `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/pages.yml'))"`.
- [ ] **Step 3: Commit** `ci: deploy the report page to GitHub Pages`.

## Task 5: Review, push, and go live

- [ ] **Step 1: Run the checks.** Run `npm test` and `npm run drift`. Run `npm run site` twice on the same commit and compare the two outputs with `cmp`. All must pass, and the outputs must match.
- [ ] **Step 2: Get a fresh review before the push.** A reviewer who did not write Tasks 1 to 4 reads `git diff origin/main..HEAD` against the spec and this plan. Fix each real defect it finds, then repeat Step 1.
- [ ] **Step 3: Enable Pages with GitHub Actions as the source,** as the owner approved. Run `gh api -X POST repos/etvjay/broke/pages -f build_type=workflow`. If the site already exists, run `gh api repos/etvjay/broke/pages` to check it, then set `build_type` to `workflow` with a PUT.
- [ ] **Step 4: Push to `main`.** Watch the Pages run with `gh run watch`. Open https://etvjay.github.io/broke/ and confirm it loads.
- [ ] **Step 5: Check that every link on the live page resolves.** Fetch each `href` and expect a 200 status.
- [ ] **Step 6: Search `site/` for token-shaped strings, email addresses, and `/home/`.** Expect no matches.
- [ ] **Step 7: Check the live page in a desktop browser and at phone width,** with agent-browser. Check each section and each empty state. Record what you saw.
- [ ] **Step 8: Report to the owner.** Give the page URL, the test counts, the checks above, and anything not done. Claim only the checks you ran.

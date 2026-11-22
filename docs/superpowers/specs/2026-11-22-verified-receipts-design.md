# Verified Receipts: Design (superseded)

> Superseded on 22 Nov 2026 by [Why It Broke: Design](2026-11-22-why-it-broke-design.md). Its receipt chain and verifier are dropped. Kept for the record.

**Date:** 2026-11-22
**Status:** Approved on 22 Nov 2026. Revised the same day after the plan review (evidence redaction and a HEAD check). The revisions are part of the plan approval. Auto mode confirmed. A real red run is a goal, not a requirement, and no bugs are planted. Nothing is built yet.
**Decided so far:** keep verified receipts, with Kane running in unison with every code change. The public repo goes under etvjay. Judges get recorded runs plus a separate judge login.
**Event:** KaneCLI Online Hackathon by TestMu AI ([kaneclihack.sh](https://www.kaneclihack.sh/)). Submissions close Thu 26 Nov 2026, 11:59 PM IST (10:29 AM PT).

## Intent

Build one small public web app with an AI coding agent. Kane CLI checks the app in a real browser while the agent codes, in unison with the work. Each failed check goes back to the agent with Kane's report and suggestion. The agent decides the fix, changes the app, and reruns. Every verify run, including failures, becomes a receipt committed to the repo. Judges can read the history and check that no committed receipt was changed or removed.

The judges score three bars first: the app works end to end, Kane caught or proved something, and the agent and Kane talked to each other. Then four equal scores: Ships, Verified, Closed loop, and Craft. This design targets all of them.

## What the research changed

- **Similar entries already exist.** Plumb runs an agent loop with Kane and checks again ([repo](https://github.com/zkasuran/plumb)). Furnish keeps a ledger of 20 Kane runs, 10 passing and 10 failing ([DEV post](https://dev.to/joyston_ccd43d53e268ec635/i-built-an-ai-home-design-studio-then-let-another-ai-agent-try-to-break-it-2df)). Reenact runs bug report, reproduction, fix, and rerun ([DEV post](https://dev.to/memeshe/i-made-a-browser-prove-my-ais-bug-fix-3hhj)). GuardianKane, an August winner, uses Stop hooks and a dashboard ([repo](https://github.com/18Abhinav07/adventures-with-kane)). The loop alone will not stand out.
- **Proposed differentiator:** receipts that are append-only in git history and checked by a verifier. As far as the research found, none of these write-ups describes that.
- **Kane runs headless here.** A smoke test on a public page used the desktop target with headless Chromium. A failed verdict exits 1, and the `run_end` event carries the status, the reason, and a summary.
- **The saved Kane config targets Android.** Every run passes `--target desktop`, so the saved config stays unchanged.

## Checks made before approval (22 Nov)

- Kane's `run_end` carries a `verdict` with `family`, `category`, `root_cause`, `suggestion`, `culprit_step`, and `confidence`. The smoke failure came back as `automation_bug`, a stale expected value rather than an app fault. The fix brief must say which side is at fault.
- The smoke flow (one objective, three actions) cost 13.06 credits and wrote a 184 KB evidence pack.
- The default desktop run should use Chrome on this machine. A localhost test is still to confirm.
- Factory hooks: exit code 2 on `Stop` feeds the reason back to the agent. The default hook timeout is 60 seconds, so the verify hook needs a longer one.
- `cloudflared` 2026.8.2 is installed as a fallback.
- The `coverage` event's `pack` field gives the evidence path, and `kane-cli balance` prints `Available credits: N`. Both were checked on 22 Nov.
- Privacy scan of the smoke evidence pack: it holds the email address (in `result.yaml`), the local user name and home paths (in the logs), the Kane profile name (in one log), and an IPv4 address (in the network HAR). A public repo must not publish these, so the runner redacts them before commit.

## Goals

1. A poll app (create a poll, vote, see results) that starts with one command.
2. Three Kane flows: create a poll, vote, and refuse a second vote from the same browser.
3. Auto mode: when the agent finishes a change to the app, Kane runs the flows, and any failure goes back to the agent with Kane's report and suggestion.
4. A receipt for every verify run, with per-flow verdicts, the failing steps, the tested commit, the hashes of the flow and evidence files, and a link to the previous receipt.
5. A verifier that fails if a committed receipt changes or disappears, if the chain breaks, or if a flow changed without approval.
6. A 3 to 5 minute demo showing one real red run, Kane's report and suggestion, the green rerun, and a tampered receipt that the verifier catches.

## Non-goals

- No hosted service, dashboard, accounts, or database.
- No login in the app and no third-party APIs. Judges must be able to run the app as it is.
- No mobile target.
- No planted bugs. Every failure must come from a real mistake made during the build.

## Anti-goals

- A history that hides failed runs or shows only green runs.
- The agent passing a flow by editing the flows, the receipts, or the data.
- A demo that works only on the author's machine.

## Constraints

- The repo must start on or after 12 Nov 2026. We start on 22 Nov in an empty folder, with no code from older projects.
- A public GitHub repo, a 3 to 5 minute YouTube demo, and at least two public posts. The user uploads and posts. I draft.
- The user must be registered on testmuai.com with the same email as the submission, and must have claimed the free credits.
- Credits: 10,200 before the smoke tests and 10,179.94 after them, about 20 credits for two runs (one cost 13.06). Three flows per verify is estimated at 60 credits.
- Git author name and email are not set on this machine. The user sets them before the first commit.
- Committed evidence is redacted before commit: no email address, local home path, IP address, or auth value reaches the public repo.
- On this VPS: Node 24, npm 11, Chromium, and Kane CLI 0.10.4, logged in as profile jay.

## Approaches considered

1. **Verified receipts (chosen).** Closes the loop the judges describe, and it is a real app. Downside: it overlaps with Plumb, Furnish, and Reenact, so it needs a sharper angle.
2. **Agent-readiness leaderboard.** Easy to demo. I found no close match, but I did not search for it specifically. Downside: the agent cannot act on the results, so the closed loop is weak. Outside sites can block bots or change, which can break the demo.
3. **README lie detector.** Simple and useful. Downside: the hackathon brief lists it as an example, so it is likely crowded, and the loop only reports.

The user picked option 1. Their answer "Unison." is read here as Kane running in unison with every code change, with Kane's report and suggestion passed to the agent automatically. That is auto mode below, and the user must confirm this reading.

## How it works

**App (my call: a poll app).** Node 24 with no dependencies: a `node:http` server in `app/server.mjs`, static files in `app/public/`, and a JSON store in `data/`, which is not committed. `npm start` serves on port 3000. Verify runs use fresh data and a random port.

**Localhost (confirm in build step 1).** The help text for `kane-cli run` shows a cloud browser only as an option (`--ws-endpoint`), so the default run should use Chrome on this machine. The first build step confirms this with a throwaway localhost page (about 15 credits). If the browser turns out to run on Kane's cloud, verify starts a `cloudflared` quick tunnel for each run, passes its URL with `--url`, and stops the tunnel when the run ends. `cloudflared` 2026.8.2 is already installed at `/usr/local/bin/cloudflared`.

**Flows (`flows/`).** Three plain-English objectives: `poll-create`, `poll-vote`, and `poll-vote-once`. Their hashes are stored in `flows/approvals.json`. The user approves the baseline flows once, before the first verify. The exact Kane command and file format are confirmed in the first build step.

**Verify runner (`scripts/verify.mjs`, `npm run verify`).**
- Refuses to run if the working tree is dirty. The tested commit must be committed first.
- Checks the Kane credit balance and stops below 2,000 credits.
- Starts the app with fresh data. Runs each flow with `kane-cli ... --target desktop --headless --agent --timeout <seconds>`.
- Reads each NDJSON stream. The `run_end` event gives the verdict and Kane's summary. If a run never reaches `run_end` (crash, timeout, login failure, no credits), its verdict is `error`, with the exit code and the last event.
- Writes one receipt for the whole run and, if any flow failed or errored, a fix brief. Updates `RECEIPTS.md`, stops the app, and exits 0 if all flows pass, 1 if any fail, and 2 if any error.

**Auto mode (in unison).**
- When the agent finishes a turn, a Stop hook checks whether anything under `app/` changed. If so, it runs `npm run verify`.
- If a flow fails, the hook blocks the stop and returns the fix brief to the agent. The agent keeps working on the app.
- The fix brief (`receipts/NNNN-brief.md`) lists each failed flow, the failing step, and Kane's `verdict` from `run_end`: `family`, `category`, `root_cause`, `suggestion`, `culprit_step`, and `confidence`. It also gives the evidence path, viewable with `kane-cli evidence serve`. The agent decides the fix. If `family` says the flow is at fault (for example `automation_bug`, a stale expected value), the agent does not edit the flow. It stops and reports to the user.
- After 5 failed attempts on one change, the hook lets the turn end. The failures stay in the receipts. The attempt counter lives in a local state file that is not committed.
- Factory's hook docs (docs.factory.com/harness/hooks.md) say that exit code 2 on a `Stop` hook feeds its reason back to the agent, which keeps working. The hook lives in `.factory/hooks.json` and uses `$FACTORY_PROJECT_DIR`.
- A small wrapper runs verify and maps its exit codes. Exit 0 lets the turn end. Any failure or error prints the brief path to stderr and exits 2.
- The hook timeout must exceed the longest verify run. The default is 60 seconds, and on `Stop` a timeout is only a non-blocking error, so the turn would end with no verdict. `onFailure` has no effect on `Stop`.
- The hook checks `stop_hook_active` from its input. The attempt cap also ends any loop.
- If the hook cannot be set up, `AGENTS.md` tells the agent to run verify and fix the app until it passes before it reports done.
- The smoke flow cost 13.06 credits. Three flows per verify are estimated at 60 credits, a conservative figure. About 130 such runs fit above the 2,000-credit floor.

**Receipts (`receipts/`).** One JSON file per verify run (`0001.json`, `0002.json`, ...). Each holds the index, the UTC time, the tested commit, the Kane CLI version, and for each flow: the SHA-256 of the flow file, the verdict (pass, fail, or error), the failing step and reason, and the evidence hash. It also holds the previous receipt's hash and its own hash. `RECEIPTS.md` is generated from the receipts and shows the current chain head. Each evidence pack is unzipped, redacted, and copied into `receipts/evidence/NNNN-<flow>/`, so GitHub shows the screenshots and logs without a download. The receipt lists each file with its SHA-256. The smoke pack unpacks to about 270 KB, so three flows add about 0.8 MB per verify run, roughly 32 MB over 40 runs.

**Redaction (before commit).** Every file except screenshots is scanned as text. Email addresses and IPv4 addresses are replaced, and so are local home paths, the local user name, the Kane profile name, and token or key values. In the HAR, cookie and authorization headers are removed. Screenshots are copied unchanged. The scan runs again after redaction. A match left over means that flow's evidence is not committed, and its verdict is `error`.

**Verifier (`scripts/receipts-verify.mjs`, `npm run receipts:verify`).**
- Recomputes each receipt's hash and checks its link to the previous receipt.
- Compares each committed receipt with its content in git history. Fails on any change or deletion.
- Reads each receipt's flow files from the tested commit and checks their hashes.
- Fails any flow change that has no matching approval record.
- Checks each evidence file's hash, and fails if a listed file is missing.
- Fails if the app at HEAD has no passing receipt, so an unverified change cannot hide behind older receipts.
- Exits 0 when intact. Otherwise it exits non-zero and names the first broken receipt.

**Flow approval (`npm run flows:approve`).** The user runs this to approve a flow change with a reason. It writes the new hash to `flows/approvals.json`. The agent must not run it, and `AGENTS.md` says so. If the agent edits a flow and skips the command, the verifier fails the run.

**What the verifier proves, and what it does not.** It proves that receipts are append-only in git history and that flow changes were approved. It cannot detect a rewritten public history by itself. It also cannot prove that the runner was left unchanged. `AGENTS.md` forbids agent edits to `scripts/` and `.factory/`, and git history shows any change. The chain head is printed in `RECEIPTS.md`, the submission, and the launch posts, so anyone can compare it later.

**Agent rules (`AGENTS.md`).**
- Commit each app change. Commit each receipt before the next change.
- Read the fix brief and fix the app. Do not edit `flows/`, `receipts/`, or `data/`, and do not run `flows:approve`.
- If a flow must change, stop and report to the user.
- Stop after 5 attempts on one change and report what still fails. Errors count as attempts.
- Never delete or rewrite a receipt.

**Repo layout.**
```
app/           server.mjs, public/
flows/         poll-create_test.md, poll-vote_test.md, poll-vote-once_test.md, approvals.json
receipts/      0001.json, 0001-brief.md, ..., evidence/
scripts/       verify.mjs, receipts-verify.mjs, flows-approve.mjs
.factory/      hooks.json for the Stop hook (format from the Factory hooks docs)
AGENTS.md      agent rules
RECEIPTS.md    generated chronology and chain head
README.md
docs/superpowers/specs/2026-11-22-verified-receipts-design.md
```

**Proof for judges.** At least one real red run from an actual agent mistake, its fix brief, its receipt, and the green rerun. The tamper check: edit a committed failed receipt to read as a pass, run `npm run receipts:verify`, and show the failure.

**Judge access.** Judges get two routes: recorded runs in the repo, which work without Kane, and a separate judge Kane login. The user creates the judge login with credits and shares it privately through the submission form. No credentials go in the repo or the README.

## Demo video (the user records and uploads)

- 0:00 to 0:20: the problem and the promise.
- 0:20 to 1:00: the agent builds the poll app with auto mode on.
- 1:00 to 2:00: a real red run, with Kane's report and suggestion in the brief.
- 2:00 to 3:00: the agent's fix and the green rerun.
- 3:00 to 4:00: the receipts, then the tamper check.
- 4:00 to 4:30: how to run it.

## Timeline (solo)

- Mon 23 Nov: repo, app, flows, baseline approval, first verify.
- Tue 24 Nov: auto mode (Stop hook and fix briefs), receipt chain, verifier.
- Wed 25 Nov: README, AGENTS.md, polish, recording, posts drafted. Submit that evening.
- Thu 26 Nov: buffer only. The hard deadline is 10:29 AM PT.

If time runs short, cut in this order: evidence copies, then the third flow, then the Stop hook. Keep the receipt chain, the verifier, and the tamper check.

## Launch posts (the user posts; I draft)

- Hacker News: the app must run without signup. Do not ask for upvotes.
- Reddit: check each subreddit's rules first.
- LinkedIn: no mass posting.

## Left to the builder

- Exact Kane command and flow file format, confirmed in the first build step.
- Hook configuration, confirmed against the Factory hooks docs.
- Evidence storage (copy or link), based on the measured pack size.
- Visual design, copy, and fix brief wording.

## My calls (the user can change these)

- Domain: a poll app. Solo build.
- Repo name `verified-receipts`. No repo with that name exists on the etvjay account (checked 22 Nov).
- Test runs upload to the default Test Manager folder (KaneAI Generated / Untitled).
- Auto mode runs once per agent turn, and only when `app/` changed. This keeps cost and wait time down.
- Anchor: git history, plus the chain head printed in the submission and posts.
- Flow changes need the user's approval command. The agent cannot approve.
- Commits: verify refuses dirty trees, and each receipt stores the tested commit.
- A run that never reaches a verdict writes an `error` receipt, and errors count toward the 5-attempt cap.
- One receipt per verify run, with per-flow verdicts.
- Credit floor: the runner stops below 2,000 credits.
- The Stop hook wrapper maps verify's exit codes, and its timeout exceeds the longest verify run.

## Decisions made (22 Nov)

- Approach: verified receipts, with Kane running in unison with every code change and passing Kane's report and suggestion to the agent (auto mode). This is my reading of the answer "Unison."
- Repo owner: etvjay.
- Judge access: recorded runs in the repo, plus a separate judge Kane login shared through the submission form.

## Open items

- The user approves this design and confirms the "Unison" reading (Kane runs in the loop on every app change).
- The user sets Git name and email on this machine before the first commit.
- The user creates the judge Kane login and shares it through the submission form, before submission.

## Risks

- AI-driven flows can be flaky. Mitigation: short, specific objectives, and every attempt recorded.
- Auto mode adds wait time and credits. Mitigation: it runs once per turn and only for app changes, and the runner stops below 2,000 credits.
- Hooks may not behave as documented. The docs match the design, and the first build step tests it. Fallback: the `AGENTS.md` rule.
- Kane's default run may use a cloud browser that cannot reach localhost. Mitigation: a cloudflared tunnel per run, if the localhost test fails.
- Overlap with similar entries. Mitigation: the receipt chain and an honest credit to prior art in the README.
- Git history can be rewritten. Mitigation: the published chain head, and the README states the limit.
- Evidence privacy. Mitigation: redaction before commit, a second scan, and fail-closed behavior, so no evidence is committed while a match remains.
- Time: four days, solo. The cut order is above.

# Launch post drafts

The owner posts these. The agent drafts them. Before posting, replace [REPO_URL] and [VIDEO_URL], and check each number against `reports/`.

## Post 1: short (X)

Kane CLI runs your app in a real browser, the way a user would. It returns a verdict with its evidence: a screenshot for each step, the network log, and a call on whether the app or the test is at fault.

For the KaneCLI hackathon I built Why It Broke. It uses Kane as the judge in a fix loop.

After each change, Kane runs plain-English flows. An app fault that Kane names can start a fix race. A failure in the test stops the loop until I decide. Three Factory Droid agents race to fix it, and only a fix that passes Kane again can merge.

In report 0009, Kane caught a real bug: double-clicking Create poll created two identical polls instead of one. Kane's verdict called it an `application_issue` at 0.98 confidence, with two `POST /api/polls -> 201` requests in the evidence.

That kicked off race 0001: three Factory Droid agents raced in separate worktrees and all three passed Kane's four-flow verify. I picked attempt a (per-form `submissionId` idempotency + client guard), and report 0010 verified the merge green on main.

Kane CLI: https://www.testmuai.com/kane-cli
Repo: https://github.com/etvjay/broke
Live reports: https://etvjay.github.io/broke/
Demo: [VIDEO_URL]

## Post 2: longer (X thread)

Post each numbered item as a reply to the one before it. Each post is under 280 characters.

*Draft. The owner has not approved this thread yet.*

1. Kane's verdict decides what happens after a failed change in Why It Broke. Here is the loop.

2. Each Kane run seals an evidence pack: a screenshot for each step, console and network logs, and a verdict. The verdict says whether the fault is in the app or the test, gives a confidence, and names a root cause.

3. An app fault that Kane names can start a fix race. A failure in the test stops the loop until I decide. Kane's own errors, such as a timeout or low credits, stop it too. Each racer gets Kane's verdict in its brief.

4. Three Factory Droid agents each try a fix in their own git worktree. The runner verifies each attempt with the same Kane flows and drift check. I pick one, and only a fix that passes Kane again can merge.

5. In report 0009, Kane caught a real bug: double-clicking Create poll created two identical polls. Kane's verdict: `application_issue` at 0.98 confidence, pointing to two `POST /api/polls -> 201` requests.

6. That red report started race 0001. Three Factory Droid racers tried different fixes in isolated worktrees: `submissionId` idempotency (a), global 2s dedupe (b), and per-voter 2s dedupe (c). All three passed all 4 Kane flows and drift.

7. I picked attempt a (`f74aeba`) via `npm run race:pick`. Kane re-verified the merge green across all 4 flows in report 0010 (73.05 credits), and the race records landed on main and the live report page.

8. Kane CLI: https://www.testmuai.com/kane-cli
Repo: https://github.com/etvjay/broke
Live reports: https://etvjay.github.io/broke/
Demo: [VIDEO_URL]

## About your app (submission form)

*Updated with report 0009, race 0001, and report 0010.*

Kane CLI is the judge in Why It Broke, a browser-verified fix loop for a small poll app. After each change, Kane runs plain-English flows in a real browser and returns a structured verdict with an evidence pack: step screenshots, console and network logs, and whether the fault is in the app or the test. When Kane flags an `application_issue`, three Factory Droid agents race to fix it in isolated git worktrees using Kane's verdict in their brief. Kane verifies every attempt across all flows and a function-explanation drift check; when multiple attempts pass, the owner picks the cleanest fix and only a fix that passes Kane again can merge. In committed report 0009, Kane caught a real double-click duplicate-poll bug (`application_issue`, 0.98 confidence). Race 0001 produced three distinct passing fixes (`a`, `b`, `c`); the owner picked attempt `a` (per-form `submissionId` idempotency key + client guard), and report 0010 verified the merge green across all four flows on main.

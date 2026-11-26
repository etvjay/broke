# Launch post drafts

The owner posts these. The agent drafts them. Before posting, replace [REPO_URL] and [VIDEO_URL], and check each number against `reports/`.

## Post 1: short (X)

Kane CLI runs your app in a real browser, the way a user would. It returns a verdict with its evidence: a screenshot for each step, the network log, and a call on whether the app or the test is at fault.

For the KaneCLI hackathon I built Why It Broke. It uses Kane as the judge in a fix loop.

After each change, Kane runs plain-English flows. An app fault that Kane names can start a fix race. A failure in the test stops the loop until I decide. Three Factory Droid agents race to fix it, and only a fix that passes Kane again can merge.

In a trial run, Kane caught a real bug: double-clicking Create poll made two identical polls. Kane's verdict said so at 0.98 confidence, and the network log shows two POST requests, both 201.

The race is built and tested. It has not run on a committed failure yet.

Kane CLI: https://www.testmuai.com/kane-cli
Repo: https://github.com/etvjay/broke

*Attach picture 05, then picture 04: Kane's evidence from the trial run. The 0.98 confidence and the two 201 requests come from that run's sealed evidence, which is not in reports/ yet.*

## Post 2: longer (X thread)

Post each numbered item as a reply to the one before it. Each post is under 280 characters.

*Draft. The owner has not approved this thread yet.*

1. Kane's verdict decides what happens after a failed change in Why It Broke. Here is the loop.

2. Each Kane run seals an evidence pack: a screenshot for each step, console and network logs, and a verdict. The verdict says whether the fault is in the app or the test, gives a confidence, and names a root cause.

3. An app fault that Kane names can start a fix race. A failure in the test stops the loop until I decide. Kane's own errors, such as a timeout or low credits, stop it too. Each racer gets Kane's verdict in its brief.

4. Three Factory Droid agents each try a fix in their own git worktree. The runner verifies each attempt with the same Kane flows and drift check. I pick one, and only a fix that passes Kane again can merge.

5. In a trial run, Kane caught a real bug. Double-clicking Create poll made two identical polls. Kane's root cause: the Create poll control accepted both clicks from one double-click. The sealed evidence has two POST requests, both 201.

6. What is real: eight committed verify runs, all green. Each ran Kane on all three flows, at 72 to 104 credits per run.

7. What is not yet: the race has not run on a committed failure. [After the race: replace this with the first committed red, Kane's verdict, the attempt I picked, and the green run.]

8. Kane CLI: https://www.testmuai.com/kane-cli
Repo: https://github.com/etvjay/broke
Demo: [VIDEO_URL]

## About your app (submission form)

*Draft. The owner has not approved this text yet.*

Kane CLI is the judge in Why It Broke, a fix loop for a small poll app. After each change, Kane runs plain-English flows in a real browser. Each run returns a verdict and an evidence pack: a screenshot for each step, console and network logs, and a call on whether the fault is in the app or the test. An app fault that Kane names can start a fix race. Three Factory Droid agents each try a fix in their own git worktree, and Kane's verdict is in each agent's brief. Kane verifies every attempt, and only a fix that passes Kane again can merge. Factory Droid built the app and supplies the racers. In a trial run, Kane caught a real bug: double-clicking Create poll made two identical polls. The race is built and tested. It has not yet run on a committed failure. [After the race: add one sentence on the first committed red and the green run.]

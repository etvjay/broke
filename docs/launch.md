# Launch post drafts

The owner posts these. The agent drafts them. Before posting, replace [REPO_URL] and [VIDEO_URL], and check each number against `reports/`.

## Post 1: short (X)

I built Why It Broke for the KaneCLI hackathon.

It is a small poll app. Kane CLI runs three browser flows after each change. When a flow fails, the report gives Kane's verdict and the app functions that ran during the flow, each with a plain explanation.

Every verify run is a committed report. Eight so far, all passed, at 72 to 104 Kane credits each.

The fix race is built and tested, but it has not run on a real red yet. When it does, I will say so.

Repo: [REPO_URL]
Demo: [VIDEO_URL]

## Post 2: longer (X thread)

Post each numbered item as a reply to the one before it. Each post is under 280 characters.

1. Most browser tests end with one red line. Kane CLI's verdict helps, but you still hunt for the code that matters. Why It Broke puts both on one page.
2. For each failing flow, the report shows Kane's verdict (family, root cause, suggestion), the app functions that ran during the flow in file order, and a plain explanation of each one. It links the redacted evidence too.
3. Each explanation stores a hash of its function's source. The drift check fails when a function changes without a new explanation, or when a function ran in no flow. It checks the process, not whether an explanation is right.
4. When Kane puts the fault in the app, a fix race can start. Three Factory Droid agents each try a fix in their own git worktree, one at a time. The same flows verify each attempt. I pick one, and only a green merge moves main.
5. What is real: eight verify runs, all green, each committed with its report, at 72 to 104 Kane credits each. What is not yet: the race has not run on a real red.
6. Repo: [REPO_URL] Demo: [VIDEO_URL]

*Replace the last sentence of item 5 after the race: the first real red, Kane's verdict, the attempt picked, and the green run.*

## About your app (submission form)

Why It Broke is a small poll app that Kane CLI tests, plus a report that explains each failure. After each change, Kane runs plain-English browser flows against the app in a headless desktop browser. When a flow fails, the report shows Kane's verdict, the app functions that ran during that flow, and a plain explanation of each one. When Kane puts the fault in the app, a fix race starts. Three Factory Droid agents each try a fix in their own git worktree, Kane verifies each attempt, and the owner picks one. Factory Droid built the app and supplies the racers. Every verify run is committed with its report.

*Add one sentence after the race: what the first real red showed.*

Run it: `npm install`, then `npm start` and open http://localhost:3000. Verify needs a Kane CLI login.

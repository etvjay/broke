# Launch post drafts

The owner posts these. The agent drafts them. Before posting, replace [REPO_URL] and [VIDEO_URL], and check each number against `reports/`.

## Post 1: short (X or LinkedIn)

I built Why It Broke for the KaneCLI hackathon.

It is a small poll app. Kane CLI runs three browser flows after each change. When a flow fails, the report gives Kane's verdict and the app functions that ran on the failing path, each with a plain explanation.

Every run is a committed report. Eight runs so far, all passed, at 72 to 104 Kane credits each.

The fix race is built and tested, but it has not run on a real red yet. When it does, I will say so.

Repo: [REPO_URL]
Demo: [VIDEO_URL]

## Post 2: longer (dev.to or LinkedIn)

Title: Why It Broke: a failed browser test that says why

Most browser tests end with a red line. Kane CLI gives a verdict, which helps, but the reader still has to find the code that matters.

Why It Broke puts the verdict and the code on one page. For each failing flow, the report shows:

- Kane's verdict: its family, root cause, and suggestion.
- The app functions that ran during the flow, in file order, each with a one to three sentence explanation.
- Links to the redacted evidence from the run.

Each explanation stores the hash of its function's source. A drift check fails when a function changes without a new explanation, or when a function ran in no flow. The check tests the process, not whether an explanation is right.

When Kane places a fault in the app, a fix race can start. Three Factory Droid agents each try a fix in their own git worktree, one at a time. The runner verifies each attempt with the same flows. I pick one, and only a green merge moves main.

What is real so far: eight verify runs, all green, each committed with its report. What is not yet: the race has not run on a real red. One Droid racer has run once, on a one-line change, and I have not measured what a racer costs on a real fix.

Repo: [REPO_URL]
Demo: [VIDEO_URL]

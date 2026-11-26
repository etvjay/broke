# Race 0001 comparison

The red report is 0009. Starts a race: app fault in poll-create-once.md.

Each attempt started from cc22ab7. This comparison names no winner. If one attempt is green, the runner merges it; if two or three are green, the owner picks one with npm run race:pick.

| Attempt | Branch | Commit | Status | Reason | Files | Lines | Explanations changed | Flows | Drift |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | race/0001-a | f74aeba | green | every flow passed and drift passed. | 4 | +63 -13 | 5 | 4 pass | passed |
| b | race/0001-b | 51be746 | green | every flow passed and drift passed. | 4 | +43 -3 | 2 | 4 pass | passed |
| c | race/0001-c | 107051a | green | every flow passed and drift passed. | 4 | +58 -17 | 5 | 4 pass | passed |

## Failing flows

None.

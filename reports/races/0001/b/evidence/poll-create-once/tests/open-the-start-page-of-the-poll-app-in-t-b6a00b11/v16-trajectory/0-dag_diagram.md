# DAG Action Graph

```mermaid
flowchart TD
    N0["navigate [/]<br/>step 1"]
    N1["type 'Double click...' on internal:role=textbox[..<br/>step 4"]
    N2["wait [/]<br/>step 5"]
    N3["type 'Yes
No' on internal:role=textbox[... [/]<br/>step 6"]
    N4["click on internal:role=button[n... [/]<br/>step 7"]
    N5["analyze 'poll_questio...' [/]<br/>step 9"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
    N3 --> N4
    N4 --> N5
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:40361/\|navigate\|\|none` | step 1 |
| N1 | `http://localhost:40361/\|type\|Double click once?\|internal:role=textbox[name="Question"i]` | step 4 |
| N2 | `http://localhost:40361/\|wait\|\|none` | step 5 |
| N3 | `http://localhost:40361/\|type\|Yes
No\|internal:role=textbox[name="Options, one per line"i]` | step 6 |
| N4 | `http://localhost:40361/\|click\|\|internal:role=button[name="Create poll"i]` | step 7 |
| N5 | `http://localhost:40361/\|analyze\|poll_question_count_check\|none` | step 9 |

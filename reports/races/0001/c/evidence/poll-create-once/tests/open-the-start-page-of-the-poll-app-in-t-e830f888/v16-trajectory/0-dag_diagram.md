# DAG Action Graph

```mermaid
flowchart TD
    N0["navigate [/]<br/>step 1"]
    N1["type 'Double click...' on internal:role=textbox[..<br/>step 2"]
    N2["type 'Yes
No' on internal:role=textbox[... [/]<br/>step 3"]
    N3["click on internal:role=button[n... [/]<br/>step 4"]
    N4["analyze 'double_click...' [/]<br/>step 6"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
    N3 --> N4
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:33821/\|navigate\|\|none` | step 1 |
| N1 | `http://localhost:33821/\|type\|Double click once?\|internal:role=textbox[name="Question"i]` | step 2 |
| N2 | `http://localhost:33821/\|type\|Yes
No\|internal:role=textbox[name="Options, one per line"i]` | step 3 |
| N3 | `http://localhost:33821/\|click\|\|internal:role=button[name="Create poll"i]` | step 4 |
| N4 | `http://localhost:33821/\|analyze\|double_click_once_poll_count_check\|none` | step 6 |

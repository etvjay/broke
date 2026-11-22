# DAG Action Graph

```mermaid
flowchart TD
    N0["type 'Only one?' on internal:role=textbox[... [/]<br/>step 2"]
    N1["wait [/]<br/>step 3"]
    N2["type 'Yes' on internal:role=textbox[... [/]<br/>step 5"]
    N3["click on internal:role=button[n... [/]<br/>step 7"]
    N4["analyze 'only_one_pol...' [/]<br/>step 8"]
    N0 --> N1
    N1 --> N2
    N2 --> N1
    N1 --> N3
    N3 --> N4
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:41821/\|type\|Only one?\|internal:role=textbox[name="Question"i]` | step 2 |
| N1 | `http://localhost:41821/\|wait\|\|none` | step 3 |
| N2 | `http://localhost:41821/\|type\|Yes\|internal:role=textbox[name="Options, one per line"i]` | step 5 |
| N3 | `http://localhost:41821/\|click\|\|internal:role=button[name="Create poll"i]` | step 7 |
| N4 | `http://localhost:41821/\|analyze\|only_one_poll_in_list\|none` | step 8 |

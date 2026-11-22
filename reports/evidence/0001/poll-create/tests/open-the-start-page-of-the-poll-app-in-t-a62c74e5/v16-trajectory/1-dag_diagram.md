# DAG Action Graph

```mermaid
flowchart TD
    N0["type 'Only one?' on internal:role=textbox[... [/]<br/>step 1"]
    N1["type 'Yes' on internal:role=textbox[... [/]<br/>step 2"]
    N2["click on internal:role=button[n... [/]<br/>step 3"]
    N3["analyze 'only_one_pol...' [/]<br/>step 4"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:33385/\|type\|Only one?\|internal:role=textbox[name="Question"i]` | step 1 |
| N1 | `http://localhost:33385/\|type\|Yes\|internal:role=textbox[name="Options, one per line"i]` | step 2 |
| N2 | `http://localhost:33385/\|click\|\|internal:role=button[name="Create poll"i]` | step 3 |
| N3 | `http://localhost:33385/\|analyze\|only_one_poll_in_list\|none` | step 4 |

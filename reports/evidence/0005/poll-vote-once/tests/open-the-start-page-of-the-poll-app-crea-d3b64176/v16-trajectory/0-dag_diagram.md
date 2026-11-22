# DAG Action Graph

```mermaid
flowchart TD
    N0["navigate [/]<br/>step 1"]
    N1["type 'Best tea?' on internal:role=textbox[... [/]<br/>step 4"]
    N2["wait [/]<br/>step 5"]
    N3["type 'Green
Black' on internal:role=textbox[... [/<br/>step 6"]
    N4["click on internal:role=button[n... [/]<br/>step 7"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
    N3 --> N4
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:43075/\|navigate\|\|none` | step 1 |
| N1 | `http://localhost:43075/\|type\|Best tea?\|internal:role=textbox[name="Question"i]` | step 4 |
| N2 | `http://localhost:43075/\|wait\|\|none` | step 5 |
| N3 | `http://localhost:43075/\|type\|Green
Black\|internal:role=textbox[name="Options, one per line"i]` | step 6 |
| N4 | `http://localhost:43075/\|click\|\|internal:role=button[name="Create poll"i]` | step 7 |

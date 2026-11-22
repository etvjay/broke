# DAG Action Graph

```mermaid
flowchart TD
    N0["navigate [/]<br/>step 1"]
    N1["type 'Lunch spot?' on internal:role=textbox[... [/<br/>step 4"]
    N2["wait [/]<br/>step 5"]
    N3["type 'Noodles
Tacos' on internal:role=textbox[... <br/>step 6"]
    N4["click on internal:role=button[n... [/]<br/>step 7"]
    N5["analyze 'tacos_zero_o...' [/]<br/>step 8"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
    N3 --> N4
    N4 --> N5
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:42699/\|navigate\|\|none` | step 1 |
| N1 | `http://localhost:42699/\|type\|Lunch spot?\|internal:role=textbox[name="Question"i]` | step 4 |
| N2 | `http://localhost:42699/\|wait\|\|none` | step 5 |
| N3 | `http://localhost:42699/\|type\|Noodles
Tacos\|internal:role=textbox[name="Options, one per line"i]` | step 6 |
| N4 | `http://localhost:42699/\|click\|\|internal:role=button[name="Create poll"i]` | step 7 |
| N5 | `http://localhost:42699/\|analyze\|tacos_zero_option_visible\|none` | step 8 |

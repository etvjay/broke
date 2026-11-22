# DAG Action Graph

```mermaid
flowchart TD
    N0["navigate [/]<br/>step 1"]
    N1["type 'Favourite co...' on internal:role=textbox[..<br/>step 4"]
    N2["wait [/]<br/>step 5"]
    N3["type 'Red
Blue' on internal:role=textbox[... [/]<br/>step 7"]
    N4["click on internal:role=button[n... [/]<br/>step 9"]
    N5["analyze 'blue_zero_op...' [/]<br/>step 10"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
    N3 --> N2
    N2 --> N4
    N4 --> N5
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:42825/\|navigate\|\|none` | step 1 |
| N1 | `http://localhost:42825/\|type\|Favourite colour?\|internal:role=textbox[name="Question"i]` | step 4 |
| N2 | `http://localhost:42825/\|wait\|\|none` | step 5 |
| N3 | `http://localhost:42825/\|type\|Red
Blue\|internal:role=textbox[name="Options, one per line"i]` | step 7 |
| N4 | `http://localhost:42825/\|click\|\|internal:role=button[name="Create poll"i]` | step 9 |
| N5 | `http://localhost:42825/\|analyze\|blue_zero_option_visible\|none` | step 10 |

# DAG Action Graph

```mermaid
flowchart TD
    N0["navigate [/]<br/>step 1"]
    N1["type 'Favourite co...' on internal:role=textbox[..<br/>step 3"]
    N2["wait [/]<br/>step 4"]
    N3["type 'Red
Blue' on internal:role=textbox[... [/]<br/>step 6"]
    N4["click on internal:role=button[n... [/]<br/>step 8"]
    N5["analyze 'blue_zero_op...' [/]<br/>step 9"]
    N6["click on div >> internal:has-te... [/]<br/>step 11"]
    N7["analyze 'blue_one_opt...' [/]<br/>step 12"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
    N3 --> N2
    N2 --> N4
    N4 --> N5
    N5 --> N6
    N6 --> N7
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:32963/\|navigate\|\|none` | step 1 |
| N1 | `http://localhost:32963/\|type\|Favourite colour?\|internal:role=textbox[name="Question"i]` | step 3 |
| N2 | `http://localhost:32963/\|wait\|\|none` | step 4 |
| N3 | `http://localhost:32963/\|type\|Red
Blue\|internal:role=textbox[name="Options, one per line"i]` | step 6 |
| N4 | `http://localhost:32963/\|click\|\|internal:role=button[name="Create poll"i]` | step 8 |
| N5 | `http://localhost:32963/\|analyze\|blue_zero_option_displayed\|none` | step 9 |
| N6 | `http://localhost:32963/\|click\|\|div >> internal:has-text="Blue (0)Vote"i >> internal:role=button\|ctx:Create poll` | step 11 |
| N7 | `http://localhost:32963/\|analyze\|blue_one_option_displayed\|none` | step 12 |

# DAG Action Graph

```mermaid
flowchart TD
    N0["navigate [/]<br/>step 1"]
    N1["type 'Lunch spot?' on internal:role=textbox[... [/<br/>step 2"]
    N2["type 'Noodles
Tacos' on internal:role=textbox[... <br/>step 3"]
    N3["click on internal:role=button[n... [/]<br/>step 4"]
    N4["analyze 'tacos_zero_o...' [/]<br/>step 5"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
    N3 --> N4
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:43523/\|navigate\|\|none` | step 1 |
| N1 | `http://localhost:43523/\|type\|Lunch spot?\|internal:role=textbox[name="Question"i]` | step 2 |
| N2 | `http://localhost:43523/\|type\|Noodles
Tacos\|internal:role=textbox[name="Options, one per line"i]` | step 3 |
| N3 | `http://localhost:43523/\|click\|\|internal:role=button[name="Create poll"i]` | step 4 |
| N4 | `http://localhost:43523/\|analyze\|tacos_zero_option_visible\|none` | step 5 |

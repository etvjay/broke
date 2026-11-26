# DAG Action Graph

```mermaid
flowchart TD
    N0["navigate [/]<br/>step 1"]
    N1["type 'Lunch spot?' on internal:role=textbox[... [/<br/>step 3"]
    N2["wait [/]<br/>step 4"]
    N3["type 'Noodles
Tacos' on internal:role=textbox[... <br/>step 5"]
    N4["click on internal:role=button[n... [/]<br/>step 6"]
    N5["analyze 'tacos_option...' [/]<br/>step 7"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
    N3 --> N4
    N4 --> N5
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:43187/\|navigate\|\|none` | step 1 |
| N1 | `http://localhost:43187/\|type\|Lunch spot?\|internal:role=textbox[name="Question"i]` | step 3 |
| N2 | `http://localhost:43187/\|wait\|\|none` | step 4 |
| N3 | `http://localhost:43187/\|type\|Noodles
Tacos\|internal:role=textbox[name="Options, one per line"i]` | step 5 |
| N4 | `http://localhost:43187/\|click\|\|internal:role=button[name="Create poll"i]` | step 6 |
| N5 | `http://localhost:43187/\|analyze\|tacos_option_visible\|none` | step 7 |

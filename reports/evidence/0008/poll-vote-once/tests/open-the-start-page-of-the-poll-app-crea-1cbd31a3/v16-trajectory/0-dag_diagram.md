# DAG Action Graph

```mermaid
flowchart TD
    N0["navigate [/]<br/>step 1"]
    N1["type 'Best tea?' on internal:role=textbox[... [/]<br/>step 2"]
    N2["type 'Green
Black' on internal:role=textbox[... [/<br/>step 3"]
    N3["click on internal:role=button[n... [/]<br/>step 4"]
    N4["click on div >> internal:has-te... [/]<br/>step 5"]
    N5["analyze 'green_vote_c...' [/]<br/>step 6"]
    N6["click on div >> internal:has-te... [/]<br/>step 9"]
    N7["analyze 'second_vote_...' [/]<br/>step 10"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
    N3 --> N4
    N4 --> N5
    N5 --> N6
    N6 --> N7
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:34907/\|navigate\|\|none` | step 1 |
| N1 | `http://localhost:34907/\|type\|Best tea?\|internal:role=textbox[name="Question"i]` | step 2 |
| N2 | `http://localhost:34907/\|type\|Green
Black\|internal:role=textbox[name="Options, one per line"i]` | step 3 |
| N3 | `http://localhost:34907/\|click\|\|internal:role=button[name="Create poll"i]` | step 4 |
| N4 | `http://localhost:34907/\|click\|\|div >> internal:has-text="Green (0)Vote"i >> internal:role=button\|ctx:Create poll` | step 5 |
| N5 | `http://localhost:34907/\|analyze\|green_vote_count_visible\|none` | step 6 |
| N6 | `http://localhost:34907/\|click\|\|div >> internal:has-text="Black (0)Vote"i >> internal:role=button` | step 9 |
| N7 | `http://localhost:34907/\|analyze\|second_vote_not_counted\|none` | step 10 |

# DAG Action Graph

```mermaid
flowchart TD
    N0["click on div >> internal:has-te... [/]<br/>step 1"]
    N1["analyze 'green_vote_c...' [/]<br/>step 2"]
    N2["click on div >> internal:has-te... [/]<br/>step 4"]
    N3["analyze 'second_vote_...' [/]<br/>step 5"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:43075/\|click\|\|div >> internal:has-text="Green (0)Vote"i >> internal:role=button\|ctx:Create poll` | step 1 |
| N1 | `http://localhost:43075/\|analyze\|green_vote_count_visible\|none` | step 2 |
| N2 | `http://localhost:43075/\|click\|\|div >> internal:has-text="Black (0)Vote"i >> internal:role=button` | step 4 |
| N3 | `http://localhost:43075/\|analyze\|second_vote_not_counted\|none` | step 5 |

# DAG Action Graph

```mermaid
flowchart TD
    N0["click on div >> internal:has-te... [/]<br/>step 1"]
    N1["analyze 'blue_vote_count' [/]<br/>step 2"]
    N0 --> N1
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:38033/\|click\|\|div >> internal:has-text="Blue (0)Vote"i >> internal:role=button\|ctx:Create poll` | step 1 |
| N1 | `http://localhost:38033/\|analyze\|blue_vote_count\|none` | step 2 |

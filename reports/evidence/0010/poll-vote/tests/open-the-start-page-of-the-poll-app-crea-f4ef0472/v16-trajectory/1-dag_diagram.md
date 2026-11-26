# DAG Action Graph

```mermaid
flowchart TD
    N0["analyze 'blue_zero_vo...' [/]<br/>step 1"]
    N1["click on div >> internal:has-te... [/]<br/>step 3"]
    N2["analyze 'blue_one_vot...' [/]<br/>step 4"]
    N0 --> N1
    N1 --> N2
```

## Node Legend

| ID | Signature | First Seen |
|-----|-----------|------------|
| N0 | `http://localhost:33389/\|analyze\|blue_zero_vote_count\|none` | step 1 |
| N1 | `http://localhost:33389/\|click\|\|div >> internal:has-text="Blue (0)Vote"i >> internal:role=button` | step 3 |
| N2 | `http://localhost:33389/\|analyze\|blue_one_vote_count\|none` | step 4 |

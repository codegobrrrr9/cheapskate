# Benchmark results

Fixture: fresh clone of https://github.com/codegobrrrr9/seatbelt. Prompt: "Add a new check W08 to skills/seatbelt/scripts/scan.js: flag any jwt.sign(...) call whose secret argument is a string literal instead of an environment variable (severity high, with a plain-English consequence and a fix like the other checks). Plant one example in examples/leaky-app/src/lib/jwt.js, add W08 to the PLANTED map in tests/scan.test.js, and make npm test pass. Tell me when it is done."

Score = tokens the model processed (input + cache writes + cache reads) and cost, for runs that finished with `npm test` passing. Lower is better.

| Condition | Runs | Done | Avg context processed | Avg output | Avg cost | Avg time | Avg turns |
|---|---|---|---|---|---|---|---|
| cheapskate | 1 | 1/1 | 702K | 7K | $0.37 | 1.7 min | 15 |
| baseline | 1 | 1/1 | 789K | 10K | $0.43 | 1.9 min | 17 |

## Per run

| Condition | Run | Done | Context | Output | Cost | Time | Turns | Max ctx | Narration turns | Test runs | Meter flags |
|---|---|---|---|---|---|---|---|---|---|---|---|
| cheapskate | 1 | yes | 702K | 7K | $0.37 | 1.7 min | 15 | 66K | 0 | 1 | C01 |
| baseline | 1 | yes | 789K | 10K | $0.43 | 1.9 min | 17 | 69K | 0 | 1 | C01 |

## Conditions

- **baseline**: the clone as-is. No CLAUDE.md, no skill.
- **cheapskate**: same clone plus `skills/cheapskate` at `.claude/skills/cheapskate` and `AGENTS.md` as `CLAUDE.md`. Exactly what the one-line install produces.

Reproduce: `node benchmarks/run.js --condition baseline --runs 3 --model sonnet && node benchmarks/run.js --condition cheapskate --runs 3 --model sonnet`.

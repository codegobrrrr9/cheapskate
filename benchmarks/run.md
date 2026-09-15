# Benchmark protocol

**Question:** does a coding agent spend fewer tokens on the same task with cheapskate installed,
while still finishing it?

**Fixture:** a fresh copy of [seatbelt](https://github.com/codegobrrrr9/seatbelt), a real repo of
about 60 files with a Node test suite. Cloned per run, `.git` removed, re-initialised so the agent
sees a clean one-commit repo.

**Task (identical prompt for both):**

> Add a new check W08 to skills/seatbelt/scripts/scan.js: flag any jwt.sign(...) call whose secret
> argument is a string literal instead of an environment variable (severity high, with a
> plain-English consequence and a fix like the other checks). Plant one example in
> examples/leaky-app/src/lib/jwt.js, add W08 to the PLANTED map in tests/scan.test.js, and make
> npm test pass. Tell me when it is done.

**Conditions**

- `baseline`: the clone as-is. No CLAUDE.md, no skill.
- `cheapskate`: same clone plus `skills/cheapskate/` at `.claude/skills/cheapskate/` and
  `AGENTS.md` copied to `CLAUDE.md`. Exactly what the one-line install produces.

**Runner:** `claude -p <prompt> --output-format json --dangerously-skip-permissions` in the temp
repo, 20 minute cap. After the run, `npm test` decides whether the task was done, and the meter
runs on the session transcript for the breakdown.

**Score:** tokens the model processed (input + cache writes + cache reads) and cost from the
agent's own usage report, plus output tokens, turns and time. Only runs that finished with tests
passing count.

**Caveats**

- One run per condition is a small sample. Add runs before drawing strong conclusions.
- The task is small. On a task the model already does tidily, the rules have little to cut.
  Savings grow with session length because the rules mostly prevent context growth.
- Costs are list price from the CLI's own report at the time of the run.

Run it:

```bash
node benchmarks/run.js --condition baseline --runs 1 --model sonnet
node benchmarks/run.js --condition cheapskate --runs 1 --model sonnet
```

Add `--fixture ../seatbelt` to use a local checkout instead of cloning. Results append to
`benchmarks/results.jsonl`; `results.md` is regenerated after each batch.

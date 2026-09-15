<div align="center">

# 🪙 cheapskate

**Stop your coding agent from burning your usage limit.**

Eleven frugality rules the agent follows while it works, and a meter that reads your Claude Code transcripts and shows exactly where the tokens went.

[![test](https://github.com/codegobrrrr9/cheapskate/actions/workflows/test.yml/badge.svg)](https://github.com/codegobrrrr9/cheapskate/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/codegobrrrr9/cheapskate)](LICENSE)
![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)

</div>

## Install

Paste this into your coding agent:

```
Install the cheapskate skill from https://github.com/codegobrrrr9/cheapskate, refer to the repo's AGENTS.md.
```

Then ask **"where did my tokens go?"** or run `/cheapskate` after any session.

No agent yet? Meter your last Claude Code session right now from any project directory:

```bash
npx --yes --allow-git=all github:codegobrrrr9/cheapskate
```

## The thing nobody tells you about agent usage

The session that built this repo's sibling project, measured by the meter:

```
Turns             111   (13 messages from you)
Output tokens        178K   20% of cost
Context re-sent     24.4M   80% of cost   avg 222K per turn, max 400K
```

The agent wrote 178K tokens. It *read* 24.4 million. Every turn re-sends the whole conversation,
so a 400-line file read on turn 10 of a 110-turn session is paid for 100 times. Caching makes each
re-send cheap, but it is the majority of what you are billed for, and it is what eats a Pro plan by
lunchtime.

Almost none of that is the model being smart. It is the model reading whole files to find one
function, reading them again after an edit, saying "let me look at" before every tool call, and
running the full test suite after every change. Nobody told it not to. cheapskate tells it not to,
and the meter shows you the receipt.

## What it does

**Rules, always on.** Grep before read. Read ranges, not files. Never re-read what is already in
context. Batch independent tool calls in one turn. Stop exploring once you can act. No narration
turns. Tail, don't cat. Run the one test, not the suite. Edit, don't rewrite. Do what was asked.
Start a fresh session at a task boundary instead of dragging 200K of context along. The full list
with the reasoning is in [`skills/cheapskate/SKILL.md`](skills/cheapskate/SKILL.md).

**The meter.** One Node file, zero dependencies. It reads the transcript Claude Code already
writes for every session and attributes the bill:

```
cheapskate  session sample  ·  todo-app  ·  2026-09-10  ·  claude-sonnet-5

Turns             14   (1 message from you)
Output tokens          5K   23% of cost
Context re-sent      408K   77% of cost   avg 29K per turn, max 52K
Est. cost           $0.23   at list price for claude-sonnet-5

Where the re-sent context came from   (tokens × turns it stayed in context, share)
  Read                            191K   47%   5 calls
  Bash                             48K   12%   3 calls
  (model output, incl. file writes)     29K    7%
  (system prompt, tools, skills)    136K   33%   estimated remainder

Files that cost the most
  /home/dev/todo-app/src/App.jsx                           89K   2 reads, 520 lines
  /home/dev/todo-app/src/store.js                          79K   2 reads, 380 lines

Waste
  C02  HIGH   4 whole-file reads of 300+ lines   (168K tokens)
       Fix: Grep for the symbol first, then read 40 to 80 lines around it with offset and limit.
  C05  HIGH   2 text-only turns that did not end a response   (62K tokens)
       Fix: Say one line of intent in the same turn as the tool call, or say nothing.
  C01  MEDIUM 2 files read more than once   (41K tokens)
  C04  MEDIUM 1 command run 3+ times (3 test runs)

Change one thing: Grep for the symbol first, then read 40 to 80 lines around it with offset and limit.
```

That is the synthetic sample in `tests/fixtures`. Run it on your own sessions:

```bash
node skills/cheapskate/scripts/meter.js              # newest session of the current project
node skills/cheapskate/scripts/meter.js --last 3     # the three newest
node skills/cheapskate/scripts/meter.js --all        # every session of this project, combined
node skills/cheapskate/scripts/meter.js --json       # for your own tooling
```

Eight waste checks: re-reads, whole-file reads, big command outputs, repeated commands, narration
turns, images, long-context turns, and rewrites that should have been edits. Each comes with the
tokens it cost and the fix. How the numbers are computed, and what the meter cannot see, is in
[`references/meter.md`](skills/cheapskate/references/meter.md).

## Does it work

The meter's arithmetic is unit-tested against synthetic transcripts (11 tests: request
de-duplication, per-model pricing with cache rates, every waste check, and the things that must not
fire). The rules are measured with an agent in the loop:

_Benchmark in progress. Same task on a real 60-file repo, same prompt, with and without the skill,
scored by the agent's own usage report. Results land in [`benchmarks/`](benchmarks/run.md) as they
are run._

## Install by agent

| Agent | How |
|-------|-----|
| **Claude Code** | `/plugin marketplace add codegobrrrr9/cheapskate` then `/plugin install cheapskate@cheapskate`. Or copy `skills/cheapskate/` to `~/.claude/skills/cheapskate/`. Adds `/cheapskate`. |
| **Codex** | Copy `skills/cheapskate/` to `~/.codex/skills/cheapskate/` and append the Rules from [`AGENTS.md`](AGENTS.md) to your project's `AGENTS.md`. |
| **Cursor** | Copy [`.cursor/rules/cheapskate.mdc`](.cursor/rules/cheapskate.mdc) into your project. |
| **Gemini CLI** | `gemini extensions install https://github.com/codegobrrrr9/cheapskate` |
| **GitHub Copilot** | Copy [`.github/copilot-instructions.md`](.github/copilot-instructions.md) into your repo. |
| **Any agent with a skills CLI** | `npx skills add codegobrrrr9/cheapskate` |
| **Anything else** | Append the Rules section of [`AGENTS.md`](AGENTS.md) to whatever file your agent reads. |

The rules work on every agent. The meter reads Claude Code transcripts only; other agents keep
their logs elsewhere, and a PR that teaches it another format is welcome.

## Tune it

Fork it and change the numbers. Three places:

- **The rules** in [`skills/cheapskate/SKILL.md`](skills/cheapskate/SKILL.md). The thresholds
  (200 lines, 3 reads, 100 lines of output, 100K context) are defaults, not laws.
- **The checks** in [`scripts/meter.js`](skills/cheapskate/scripts/meter.js). Each is a few lines;
  the thresholds are named constants at the top of each.
- **The prices** in the `PRICES` table at the top of the meter, if a model changes price or you are
  on a different provider.

## Honest limits

Tool result tokens are estimated at 4 characters each; the headline totals come from the API's own
usage fields and are exact. The dollar figure is list price, a common unit for comparing sessions,
not what a subscription plan charges. The meter cannot tell you whether a read was necessary, only
what it cost. And frugality is second to correctness: the rules say so, and so should you when it
matters.

## Credits

Same shape as [seatbelt](https://github.com/codegobrrrr9/seatbelt), and the skills that showed one
SKILL.md can change how an agent behaves: [ponytail](https://github.com/DietrichGebert/ponytail),
[i-have-adhd](https://github.com/ayghri/i-have-adhd).

## License

MIT. Star ⭐ if it bought you one more afternoon on your plan.

# Reading the meter

The meter reads Claude Code's own transcript for a session (`~/.claude/projects/<project>/<id>.jsonl`)
and answers one question: where did the tokens go, and which of it was avoidable.

## The one idea

An agent session is a loop. On every turn the whole conversation so far is sent to the model
again. Prompt caching makes the re-send cheap per token (about a tenth of the base input price)
but it is charged on every turn, and it is the majority of tokens in almost every session.

So a file read at turn 5 of a 100-turn session is not paid for once. It is paid for 95 times.
That is why the meter reports **tokens × turns it stayed in context** for every tool result and
every piece of model output, and calls that the item's share of the re-sent context.

## Headline numbers

- **Turns**: API calls. One per tool call round, roughly. "Messages from you" is how many times
  the human typed something; everything else is the agent talking to tools.
- **Output tokens**: what the model wrote, including the contents of files it wrote with Write
  and the strings it passed to Edit. Priced at the output rate, the expensive one.
- **Context re-sent**: input + cache writes + cache reads across all turns. This is the volume
  of tokens the model processed. Fresh input is what was new that turn; cache writes are new
  content being stored; cache reads are the re-sent history.
- **Est. cost**: list price for the model in the transcript, with the cache write (5-minute and
  1-hour) and cache read rates applied. Subscription plans are not billed this way; the dollar
  figure is a common unit for comparing sessions, not an invoice.
- **avg / max context**: how big the conversation was per turn. Past about 150K the model is
  re-reading a lot it no longer needs for the current step.

## Attribution table

Each row is a tool. Its number is the sum over every result of that tool of
`estimated tokens × turns after it`. The share column is that row's fraction of everything the
model re-read. Two synthetic rows:

- **model output, incl. file writes**: the agent's own words and the files it wrote, which also
  stay in the conversation.
- **system prompt, tools, skills**: whatever is left after attributing tool results and output.
  System prompt, tool definitions, CLAUDE.md, loaded skills, memory. Estimated as a remainder.

Tool result tokens are estimated at 4 characters per token. The model's tokenizer differs by
model (Opus 4.7 and later produce roughly 30% more tokens for the same text), so treat the
attribution as proportions, not exact counts. The headline token totals are exact; they come from
the API's usage fields.

## Waste checks

| Id | What | Why it costs |
|----|------|--------------|
| C01 | A file read more than once | The second read adds a second copy to context for every later turn. |
| C02 | Whole-file reads of 300+ lines with no range | Most of the file is not needed for the step; all of it is paid for on every later turn. |
| C03 | Command output over 8K characters | Test logs, build output, `cat` of a big file. Should have been `tail`, `head` or `grep`. |
| C04 | The same command run 3+ times | Usually the full test suite after every edit. Run the one test file. |
| C05 | Text-only turns that did not end a response | A turn that says "let me look at X" and calls no tool re-sends the whole context to add a sentence. |
| C06 | Images in tool results | Roughly 1,600 tokens each, re-sent on every later turn. |
| C07 | Turns with 150K+ tokens of context | Past a task boundary, a fresh session with a handoff note is far cheaper. |
| C08 | An existing file rewritten with Write instead of Edit | The whole file is paid as output, then as context on every later turn. |

Severity is by share of the session's re-sent context: high at 15%+, medium at 5%+, else low.

## Flags

```
node meter.js                      newest session of the current project
node meter.js --last 3             the 3 newest, one report each
node meter.js --all                every session of the project, combined
node meter.js --session <id>       one session by id (searched across projects)
node meter.js --project <path>     another project directory
node meter.js <file.jsonl>         a transcript file directly
--json                             machine-readable
--top N                            rows per table (default 8)
```

## What it cannot see

- Thinking tokens are inside output tokens; the meter does not split them out.
- Subagent transcripts that live in separate files are not merged. Sidechain lines in the same
  file are counted and shown on their own row.
- Whether a read was *necessary*. It reports what was paid for; you judge what was worth it.

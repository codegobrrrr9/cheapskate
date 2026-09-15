---
name: cheapskate
description: Stops the coding agent from burning the user's usage limit. Always-on frugality rules (grep before read, read ranges not whole files, never re-read what is already in context, batch tool calls, no narration, stop exploring once there is enough to act) plus a meter that reads Claude Code session transcripts and shows where the tokens went. Use for every coding task, and when the user says usage, limit, tokens, context, expensive, cheaper, /cheapskate, or asks why a session cost so much.
license: MIT
metadata:
  author: codegobrrrr9
  version: "0.1.0"
  homepage: https://github.com/codegobrrrr9/cheapskate
---

# cheapskate

The user pays for every token you read and every turn you take. Most of the bill is not what you
write. It is the whole conversation being re-sent on every turn. Every file you read stays in
context for the rest of the session and is paid for again on every call after it. Act like context
is rent, not a free download.

## Always-on rules

1. **Grep before read.** Find the symbol or line with Grep or Glob first, then read only the range
   around it. Never read a whole file to find one function.
2. **Read ranges, not files.** Use offset and limit. Reading more than 200 lines at once needs a
   reason you can say in one line. Never read a file over 1,000 lines whole.
3. **Never re-read what is in context.** If you read a file this session and have not edited it
   since, you already have it. If you edited it, you know what changed. Re-read only a range that
   another tool changed.
4. **Batch independent calls.** Reads, greps and shell commands that do not depend on each other go
   in one turn. Every extra turn re-sends the entire context.
5. **Stop exploring once you can act.** Set a budget before you start: for a small change, 3 reads
   before the first edit. If you are over budget and still reading, say what you are looking for in
   one line and do the most likely edit.
6. **Do not narrate.** No "let me look at", no restating the plan, no summary of what you just
   read. One line of intent when it helps the user follow, then the tool call. Text-only turns that
   add nothing cost a full context pass each.
7. **Tail, do not cat.** Logs, test output and build output get piped through tail, grep or head.
   Never dump more than 100 lines of command output into context.
8. **Run the one test, not the suite.** Run the test file that covers the change. Run the whole suite
   once, at the end, if the user asked for it or the change is wide.
9. **Edit, do not rewrite.** Use Edit for changes. Write is for new files. Rewriting a 300-line file
   to change 3 lines costs 300 lines of output and 300 more of context.
10. **Do what was asked.** No unrequested refactors, no extra tests, no docs nobody asked for. Offer
    them in one line at the end if they matter.
11. **Long session, fresh start.** When context passes about 100K tokens on a task with a clear
    boundary, write a five-line handoff (what is done, what is next, the files involved) and tell
    the user a new session will be cheaper from here.

These are not about being lazy. Read everything you need to be correct. Read nothing twice.

## When asked about usage, or `/cheapskate`

1. Run the meter on the current session from the project root:
   `node <path-to-this-skill>/scripts/meter.js`
   It finds the newest transcript for this project. `--session <id>`, `--project <path>`, `--all`,
   `--last N` and `--json` are available. Read `references/meter.md` if the output needs explaining.
2. Report in this shape. Verdict first, then the three biggest line items, then one thing to change.
   Cap at 5 findings. No preamble.

```
This session: 106 turns, 23.0M tokens processed, about $14.20 at Opus 5 rates.
Output was 159K of that. The other 99% was context re-sent on every turn.

1. Read: 1.58M chars of file content, 3 of them images (620K).
   Images are the single largest item. Describe the file instead of reading it when you can.
2. 11 whole-file reads, none with a range.
   Grep first, then read the 40 lines you need.
3. 31 text-only turns.
   Each one re-sent 200K+ tokens of context to add a sentence.

Change one thing: read ranges. That alone would have cut this session by roughly a third.
```

3. If the user asks you to cut usage on the current task, apply rules 1 to 11 harder and say
   which one you are applying, in one line.

## Overrides

- The user says correctness over cost, or asks for a full audit or a full test run. Do that; the
  rules yield to an explicit request.
- Reading a whole file is right when you are about to rewrite it, or it is under 200 lines.
- Never skip reading something you need to be correct. A wrong edit costs more than a read.

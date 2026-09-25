# cheapskate — instructions for coding agents

You are reading this because a user pasted something like:

> Install the cheapskate skill from https://github.com/codegobrrrr9/cheapskate, refer to the repo's AGENTS.md.

Do the install for the agent you are, confirm in one line, and then follow the rules below for the
rest of the session. Do not explain what cheapskate is unless asked.

## Install

`<repo>` is a clone of this repository, or the raw files fetched from
`https://raw.githubusercontent.com/codegobrrrr9/cheapskate/main/`.

| Agent | Do this |
|-------|---------|
| Claude Code | Run `/plugin marketplace add codegobrrrr9/cheapskate` then `/plugin install cheapskate@cheapskate`. If plugins are unavailable, copy `<repo>/skills/cheapskate/` to `~/.claude/skills/cheapskate/` (all projects) or `.claude/skills/cheapskate/` (this project only). |
| Codex | Copy `<repo>/skills/cheapskate/` to `~/.codex/skills/cheapskate/`, or run `npx skills add codegobrrrr9/cheapskate`. Append the **Rules** section below to the project's `AGENTS.md`. |
| Cursor | Copy `<repo>/.cursor/rules/cheapskate.mdc` to `.cursor/rules/cheapskate.mdc` in the project. |
| Gemini CLI | Run `gemini extensions install https://github.com/codegobrrrr9/cheapskate`. |
| GitHub Copilot | Copy `<repo>/.github/copilot-instructions.md` into the project's `.github/` (merge if one exists). |
| Windsurf, Cline, Roo, Kilo, Amp, OpenCode, Zed, anything else | Append the **Rules** section below to whatever instruction file the agent reads. |

Any agent: `npx skills add codegobrrrr9/cheapskate` installs the skill directory for every agent the
`skills` CLI supports.

The meter (`skills/cheapskate/scripts/meter.js`) reads Claude Code transcripts. On other agents the
rules still apply; the meter does not.

After installing, say: `cheapskate on. Ask "where did my tokens go" or /cheapskate for the meter.`

## Rules

The user pays for every token you read and every turn you take. Most of the bill is the whole
conversation being re-sent on every turn, so everything you read is paid for again on every call
after it. Follow these without being asked:

1. **Grep before read.** Find the symbol first, then read the range around it.
2. **Read ranges, not files.** Use offset and limit. More than 200 lines at once needs a reason.
   Never read a file over 1,000 lines whole.
3. **Never re-read what is in context.** Read once. After an edit, re-read only the changed range.
4. **Batch independent calls** in one turn. Every extra turn re-sends the entire context.
5. **Stop exploring once you can act.** Once you know what changes and why, edit. More reading is cost without information.
6. **Narrate decisions, not steps.** A line when you pick an approach or change course; no play-by-play, no text-only turns that add nothing.
7. **Tail, do not cat.** Never dump more than 100 lines of command output into context.
8. **Run the one test, not the suite.** Whole suite once, at the end, if asked.
9. **Edit, do not rewrite.** Write is for new files.
10. **Do what was asked.** No unrequested refactors, tests or docs. Offer them in one line.
11. **Long session, fresh start.** Past about 100K context at a task boundary, write a five-line
    handoff and suggest a new session.

Read everything you need to be correct. Read nothing twice.

## When the user asks about usage, or `/cheapskate`

Run `node <path-to>/meter.js` from the project root (it finds the newest transcript for this
project; `--last N`, `--all`, `--session <id>`, `--json` are available). Then report: verdict first,
the three biggest line items, one thing to change. No preamble.

## Overrides

- The user says correctness over cost, or asks for a full audit or full test run: do that.
- Reading a whole file is right when you are about to rewrite it, or it is under 200 lines.
- Never skip a read you need to be correct. A wrong edit costs more than a read.

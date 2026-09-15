---
description: Where did my tokens go? Runs the cheapskate meter on this project's newest Claude Code session and reports the biggest line items and one thing to change.
allowed-tools: Bash(node:*), Read
---

Run the cheapskate meter on the current project.

1. Run `node ${CLAUDE_PLUGIN_ROOT}/skills/cheapskate/scripts/meter.js $ARGUMENTS` from the project root
   (if that path does not exist, find `meter.js` under the installed cheapskate skill directory).
   Pass through any arguments the user gave, for example `--last 3` or `--all`.
2. Report using the format in the cheapskate skill: one headline line (turns, tokens processed,
   estimated cost), one line on how much was output versus re-sent context, then at most 5
   findings, each as what, why it cost, and the fix. End with "Change one thing:" and the single
   highest-value change. No preamble.
3. If the meter reports no transcripts, say where it looked and that it needs to run from a
   directory that has had Claude Code sessions.

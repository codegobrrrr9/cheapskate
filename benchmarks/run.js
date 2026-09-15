#!/usr/bin/env node
// Benchmark: does a coding agent spend fewer tokens on the same task with cheapskate installed?
//
// Fixture: a fresh clone of github.com/codegobrrrr9/seatbelt (a real ~60-file repo with tests).
// Task: add one scanner check with a planted example and a test, and make `npm test` pass.
// Both conditions get the identical prompt. The agent's own usage report (from `claude -p
// --output-format json`) is the score; the transcript is then run through the meter for the
// breakdown. A run only counts as done if `npm test` passes afterwards.
//
//   node benchmarks/run.js --condition baseline --runs 1 --model sonnet
//   node benchmarks/run.js --condition cheapskate --runs 1 --model sonnet
//   node benchmarks/run.js --report
//
// Requires the `claude` CLI on PATH and git. Each run costs real usage.

import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { analyze, findTranscripts } from '../skills/cheapskate/scripts/meter.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const SKILL = join(ROOT, 'skills', 'cheapskate');
const RESULTS = join(here, 'results.jsonl');
const FIXTURE_REPO = 'https://github.com/codegobrrrr9/seatbelt';
const PROMPT = 'Add a new check W08 to skills/seatbelt/scripts/scan.js: flag any jwt.sign(...) call whose secret argument is a string literal instead of an environment variable (severity high, with a plain-English consequence and a fix like the other checks). Plant one example in examples/leaky-app/src/lib/jwt.js, add W08 to the PLANTED map in tests/scan.test.js, and make npm test pass. Tell me when it is done.';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const condition = opt('--condition', 'baseline');
const runs = Number(opt('--runs', '1'));
const model = opt('--model', '');
const fixtureLocal = opt('--fixture', '');

function setup(cond) {
  const dir = mkdtempSync(join(tmpdir(), 'scanner-'));
  if (fixtureLocal) cpSync(fixtureLocal, dir, { recursive: true, filter: (s) => !/[\\/]\.git([\\/]|$)|[\\/]node_modules([\\/]|$)|[\\/]\.claude([\\/]|$)|CLAUDE\.md$/.test(s) });
  else {
    const r = spawnSync('git', ['clone', '-q', '--depth', '1', FIXTURE_REPO, dir], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('clone failed: ' + r.stderr);
    rmSync(join(dir, '.git'), { recursive: true, force: true });
  }
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=bench@example.com', '-c', 'user.name=bench', 'commit', '-qm', 'initial'], { cwd: dir });
  if (cond === 'cheapskate') {
    mkdirSync(join(dir, '.claude', 'skills'), { recursive: true });
    cpSync(SKILL, join(dir, '.claude', 'skills', 'cheapskate'), { recursive: true });
    writeFileSync(join(dir, 'CLAUDE.md'), readFileSync(join(ROOT, 'AGENTS.md'), 'utf8').replace(/<path-to>\/meter\.js/g, '.claude/skills/cheapskate/scripts/meter.js'));
  }
  return dir;
}

function runAgent(dir) {
  const env = { ...process.env };
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
  const win = process.platform === 'win32';
  const cli = ['-p', win ? `"${PROMPT}"` : PROMPT, '--output-format', 'json', '--dangerously-skip-permissions'];
  if (model) cli.push('--model', model);
  const started = Date.now();
  const r = spawnSync('claude', cli, { cwd: dir, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000, shell: win });
  let out = null; try { out = JSON.parse(r.stdout); } catch { /* keep raw */ }
  return { ms: Date.now() - started, out, stdout: r.stdout?.slice(-3000), status: r.status };
}

function testsPass(dir) {
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32', timeout: 5 * 60 * 1000 });
  return { pass: r.status === 0, tail: (r.stdout || '').split('\n').filter(l => /^ℹ (pass|fail)/.test(l)).join(' ') };
}

if (args.includes('--report')) { report(); process.exit(0); }

for (let i = 0; i < runs; i++) {
  const dir = setup(condition);
  process.stdout.write(`[${condition} ${i + 1}/${runs}] ${dir} ... `);
  const agent = runAgent(dir);
  const t = testsPass(dir);
  const u = agent.out?.usage ?? {};
  let meter = null;
  try { const f = findTranscripts({ project: dir, last: 1 }); if (f.length) meter = analyze(f); } catch { /* optional */ }
  const row = {
    condition, run: i + 1, at: new Date().toISOString(), done: t.pass, tests: t.tail,
    input: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0,
    context: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    cost_usd: agent.out?.total_cost_usd ?? null, turns: agent.out?.num_turns ?? null, ms: agent.ms,
    model: agent.out?.modelUsage ? Object.keys(agent.out.modelUsage).join('+') : (model || 'default'),
    meter: meter ? { turns: meter.turns, avgContext: meter.tokens.avgContext, maxContext: meter.tokens.maxContext, narration: meter.narration.turns, rereads: meter.findings.find(f => f.id === 'C01')?.title || 'none', wholeReads: meter.findings.find(f => f.id === 'C02')?.title || 'none', testRuns: meter.testRuns, findings: meter.findings.map(f => f.id) } : null,
    final: (agent.out?.result ?? agent.stdout ?? '').slice(0, 1200), status: agent.status,
  };
  appendFileSync(RESULTS, JSON.stringify(row) + '\n');
  console.log(`${t.pass ? 'done' : 'NOT done'}  context ${fmt(row.context)}  output ${fmt(row.output)}  $${(row.cost_usd ?? 0).toFixed(2)}  ${(agent.ms / 60000).toFixed(1)} min  ${row.turns} turns`);
  rmSync(dir, { recursive: true, force: true });
}
report();

function fmt(n) { n = Math.round(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n); }
function report() {
  if (!existsSync(RESULTS)) return;
  const rows = readFileSync(RESULTS, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const by = {}; for (const r of rows) (by[r.condition] ??= []).push(r);
  const avg = (xs, k) => xs.length ? xs.reduce((a, r) => a + (r[k] ?? 0), 0) / xs.length : 0;
  const L = ['# Benchmark results', '', `Fixture: fresh clone of ${FIXTURE_REPO}. Prompt: "${PROMPT}"`, '',
    'Score = tokens the model processed (input + cache writes + cache reads) and cost, for runs that finished with `npm test` passing. Lower is better.', '',
    '| Condition | Runs | Done | Avg context processed | Avg output | Avg cost | Avg time | Avg turns |', '|---|---|---|---|---|---|---|---|'];
  for (const [c, xs] of Object.entries(by)) L.push(`| ${c} | ${xs.length} | ${xs.filter(r => r.done).length}/${xs.length} | ${fmt(avg(xs, 'context'))} | ${fmt(avg(xs, 'output'))} | $${avg(xs, 'cost_usd').toFixed(2)} | ${(avg(xs, 'ms') / 60000).toFixed(1)} min | ${avg(xs, 'turns').toFixed(0)} |`);
  L.push('', '## Per run', '', '| Condition | Run | Done | Context | Output | Cost | Time | Turns | Max ctx | Narration turns | Test runs | Meter flags |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.condition} | ${r.run} | ${r.done ? 'yes' : 'no'} | ${fmt(r.context)} | ${fmt(r.output)} | $${(r.cost_usd ?? 0).toFixed(2)} | ${(r.ms / 60000).toFixed(1)} min | ${r.turns} | ${r.meter ? fmt(r.meter.maxContext) : '?'} | ${r.meter?.narration ?? '?'} | ${r.meter?.testRuns ?? '?'} | ${r.meter?.findings.join(' ') || 'none'} |`);
  L.push('', '## Conditions', '', '- **baseline**: the clone as-is. No CLAUDE.md, no skill.', '- **cheapskate**: same clone plus `skills/cheapskate` at `.claude/skills/cheapskate` and `AGENTS.md` as `CLAUDE.md`. Exactly what the one-line install produces.', '',
    'Reproduce: `node benchmarks/run.js --condition baseline --runs 3 --model sonnet && node benchmarks/run.js --condition cheapskate --runs 3 --model sonnet`.');
  writeFileSync(join(here, 'results.md'), L.join('\n') + '\n');
}

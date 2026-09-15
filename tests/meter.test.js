import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, format, priceFor, projectSlug, PRICES } from '../skills/cheapskate/scripts/meter.js';

// ---- tiny transcript builder -------------------------------------------------------------
let n = 0;
const ts = () => new Date(1700000000000 + (n++) * 1000).toISOString();
const usage = (u) => ({ input_tokens: u.in ?? 0, cache_creation_input_tokens: u.cc ?? 0, cache_read_input_tokens: u.cr ?? 0, output_tokens: u.out ?? 0,
  cache_creation: { ephemeral_5m_input_tokens: u.cc5m ?? (u.cc ?? 0), ephemeral_1h_input_tokens: u.cc1h ?? 0 } });
function human(text) { return { type: 'user', timestamp: ts(), cwd: 'C:\\proj\\demo', message: { role: 'user', content: text } }; }
function assistantLines(reqId, model, u, blocks) {
  // Claude Code writes one line per content block, each repeating the same usage. Reproduce that.
  return blocks.map(b => ({ type: 'assistant', timestamp: ts(), requestId: reqId, message: { id: 'msg_' + reqId, model, usage: usage(u), content: [b] } }));
}
const text = (t) => ({ type: 'text', text: t });
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
function result(id, content) { return { type: 'user', timestamp: ts(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } }; }
const lines = (count, width = 40) => Array.from({ length: count }, (_, i) => ('line ' + i).padEnd(width, '.')).join('\n');

function writeTranscript(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'cheapskate-'));
  const f = join(dir, 'abc12345-session.jsonl');
  writeFileSync(f, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return { f, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function sampleSession() {
  const M = 'claude-sonnet-5';
  return [
    human('add a feature'),
    ...assistantLines('r1', M, { in: 100, cc: 5000, cr: 0, out: 50 }, [text('Looking at a.js'), tool('t1', 'Read', { file_path: 'C:\\proj\\demo\\a.js' })]),
    result('t1', lines(400)),                                        // whole-file read, 400 lines
    ...assistantLines('r2', M, { in: 10, cc: 4000, cr: 5100, out: 30 }, [text('Now let me look at b.')]),   // narration
    ...assistantLines('r3', M, { in: 10, cc: 100, cr: 9100, out: 40 }, [tool('t2', 'Read', { file_path: 'C:\\proj\\demo\\a.js' })]), // re-read
    result('t2', lines(400)),
    ...assistantLines('r4', M, { in: 10, cc: 4000, cr: 9200, out: 60 }, [tool('t3', 'Bash', { command: 'npm test' })]),
    result('t3', lines(300)),                                        // 12,300 chars of test output
    ...assistantLines('r5', M, { in: 10, cc: 3000, cr: 13200, out: 60 }, [tool('t4', 'Bash', { command: 'npm test' })]),
    result('t4', 'ok'),
    ...assistantLines('r6', M, { in: 10, cc: 10, cr: 16200, out: 60 }, [tool('t5', 'Bash', { command: 'npm test' })]),
    result('t5', 'ok'),
    ...assistantLines('r7', M, { in: 10, cc: 10, cr: 16210, out: 2000 }, [tool('t6', 'Write', { file_path: 'C:\\proj\\demo\\a.js', content: lines(200) })]),
    result('t6', 'File written'),
    ...assistantLines('r8', M, { in: 10, cc: 2000, cr: 16220, out: 40 }, [tool('t7', 'Read', { file_path: 'C:\\proj\\demo\\shot.png' })]),
    result('t7', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x'.repeat(50000) } }]),
    ...assistantLines('r9', M, { in: 10, cc: 100, cr: 18220, out: 80 }, [text('Done. The feature is in.')]),  // final answer, not narration
  ];
}

// ---- tests ----------------------------------------------------------------------------------

test('dedupes usage across the multiple transcript lines of one request', () => {
  const { f, cleanup } = writeTranscript(sampleSession());
  const r = analyze([f]);
  cleanup();
  assert.equal(r.turns, 9);
  assert.equal(r.humanMessages, 1);
  // r1 appears as two lines with the same usage; counted once
  assert.equal(r.tokens.output, 50 + 30 + 40 + 60 + 60 + 60 + 2000 + 40 + 80);
  assert.equal(r.tokens.input, 100 + 10 * 8);
});

test('cost uses per-model list price with cache write and cache read rates', () => {
  const { f, cleanup } = writeTranscript(sampleSession());
  const r = analyze([f]);
  cleanup();
  const [pi, pw5, , prd, po] = PRICES['claude-sonnet-5'];
  const expected = (r.tokens.input * pi + r.tokens.cacheWrite * pw5 + r.tokens.cacheRead * prd + r.tokens.output * po) / 1e6;
  assert.ok(Math.abs(r.cost.total - expected) < 1e-9, `${r.cost.total} vs ${expected}`);
  assert.equal(r.cost.unknownModel, false);
});

test('context processed = input + cache write + cache read, per turn', () => {
  const { f, cleanup } = writeTranscript(sampleSession());
  const r = analyze([f]);
  cleanup();
  assert.equal(r.tokens.contextProcessed, r.tokens.input + r.tokens.cacheWrite + r.tokens.cacheRead);
  assert.equal(r.tokens.maxContext, 10 + 100 + 18220);
  assert.equal(r.ctxSeries.length, 9);
});

test('finds every planted waste pattern', () => {
  const { f, cleanup } = writeTranscript(sampleSession());
  const r = analyze([f]);
  cleanup();
  const ids = r.findings.map(x => x.id);
  assert.ok(ids.includes('C01'), 'C01 re-read: ' + ids);        // a.js read twice
  assert.ok(ids.includes('C02'), 'C02 whole-file read 300+');   // 400-line read, no range
  assert.ok(ids.includes('C03'), 'C03 big command output');      // 12K chars of npm test
  assert.ok(ids.includes('C04'), 'C04 repeated command');        // npm test ×3
  assert.ok(ids.includes('C05'), 'C05 narration');               // "Now let me look at b."
  assert.ok(ids.includes('C06'), 'C06 image');                   // shot.png
  assert.ok(ids.includes('C08'), 'C08 rewrite with Write');      // a.js rewritten after being read
  assert.equal(r.narration.turns, 1);
  assert.equal(r.testRuns, 3);
  assert.equal(r.images, 1);
});

test('final text answer is not counted as narration', () => {
  const { f, cleanup } = writeTranscript(sampleSession());
  const r = analyze([f]);
  cleanup();
  assert.equal(r.narration.turns, 1); // only r2; r9 ends the response
});

test('attribution: a tool result is charged for every later turn', () => {
  const { f, cleanup } = writeTranscript(sampleSession());
  const r = analyze([f]);
  cleanup();
  const read = r.attribution.tools.find(t => t.name === 'Read');
  // first a.js read: 400 lines * 41 chars / 4 ≈ 4100 tokens, stays for 8 later turns
  assert.ok(read.ctxTurns > 4100 * 8, `read ctxTurns ${read.ctxTurns}`);
  assert.equal(read.calls, 3);
  assert.equal(read.images, 1);
  const aFile = r.attribution.files.find(x => x.file.endsWith('a.js'));
  assert.equal(aFile.reads, 2);
  assert.ok(r.attribution.baseCtxTurns >= 0);
});

test('a frugal session yields no findings and a calm verdict', () => {
  const M = 'claude-sonnet-5';
  const { f, cleanup } = writeTranscript([
    human('fix the typo in README'),
    ...assistantLines('q1', M, { in: 50, cc: 3000, out: 40 }, [tool('g1', 'Grep', { pattern: 'teh' })]),
    result('g1', 'README.md:12: teh'),
    ...assistantLines('q2', M, { in: 10, cc: 50, cr: 3050, out: 60 }, [tool('e1', 'Edit', { file_path: 'README.md', old_string: 'teh', new_string: 'the' })]),
    result('e1', 'ok'),
    ...assistantLines('q3', M, { in: 10, cc: 20, cr: 3100, out: 20 }, [text('Fixed.')]),
  ]);
  const r = analyze([f]);
  cleanup();
  assert.deepEqual(r.findings, []);
  assert.match(format(r), /already frugal/);
});

test('system reminders and tool results are not counted as human messages', () => {
  const M = 'claude-sonnet-5';
  const { f, cleanup } = writeTranscript([
    human('hi'),
    { type: 'user', timestamp: ts(), message: { role: 'user', content: '<system-reminder>ignore me</system-reminder>' } },
    { type: 'user', timestamp: ts(), isMeta: true, message: { role: 'user', content: 'meta' } },
    ...assistantLines('q1', M, { in: 5, out: 5 }, [text('hello')]),
  ]);
  const r = analyze([f]);
  cleanup();
  assert.equal(r.humanMessages, 1);
});

test('unknown model is priced as Opus 5 and flagged', () => {
  const { rates, known } = priceFor('claude-future-9');
  assert.equal(known, false);
  assert.deepEqual(rates, PRICES['claude-opus-5']);
  assert.equal(priceFor('claude-opus-5[1m]').known, true);
  assert.deepEqual(priceFor('claude-fable-5-1').rates, [10, 12.5, 20, 0.25, 50]);
});

test('project slug matches Claude Code directory naming', () => {
  assert.equal(projectSlug('C:\\Users\\me\\Desktop\\cowork'), 'C--Users-me-Desktop-cowork');
});

test('format prints the headline numbers and the one thing to change', () => {
  const { f, cleanup } = writeTranscript(sampleSession());
  const out = format(analyze([f]));
  cleanup();
  assert.match(out, /^cheapskate  session abc12345/);
  assert.match(out, /Turns\s+9/);
  assert.match(out, /Context re-sent/);
  assert.match(out, /Est\. cost\s+\$/);
  assert.match(out, /Change one thing:/);
  assert.match(out, /estimated at 4 chars per token/);
});

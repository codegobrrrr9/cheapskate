#!/usr/bin/env node
// cheapskate meter — where did the tokens go?
// Reads Claude Code session transcripts (~/.claude/projects/<project>/<session>.jsonl) and
// attributes the bill to what caused it. Zero dependencies.
//
//   node meter.js                      newest session of the current project
//   node meter.js --last 3             the 3 newest sessions, one report each
//   node meter.js --all                every session of the current project, combined
//   node meter.js --session <id>       one session by id (searched across all projects)
//   node meter.js --project <path>     a different project directory
//   node meter.js <file.jsonl>         a transcript file directly
//   --json     machine-readable        --top N    rows per table (default 8)
//
// Token counts for tool results are estimated at 4 characters per token and labelled so.
// Cost uses list prices per model, with cache write and cache read rates applied.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// $ per million tokens: [input, cache write 5m, cache write 1h, cache read, output]
export const PRICES = {
  'claude-fable-5-1': [10, 12.5, 20, 0.25, 50],
  'claude-mythos-5-1': [10, 12.5, 20, 0.25, 50],
  'claude-fable-5': [10, 12.5, 20, 1, 50],
  'claude-opus-5': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-8': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-7': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-6': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-5': [5, 6.25, 10, 0.5, 25],
  'claude-sonnet-5': [2, 2.5, 4, 0.2, 10],
  'claude-sonnet-4-6': [3, 3.75, 6, 0.3, 15],
  'claude-sonnet-4-5': [3, 3.75, 6, 0.3, 15],
  'claude-haiku-4-5': [1, 1.25, 2, 0.1, 5],
};
const CHARS_PER_TOKEN = 4;
const IMAGE_TOKENS = 1600; // typical screenshot-sized image; the API bills by pixels, this is an estimate

export function priceFor(model) {
  const m = String(model || '').replace(/\[.*?\]$/, '');
  if (PRICES[m]) return { rates: PRICES[m], known: true };
  const key = Object.keys(PRICES).find(k => m.startsWith(k));
  if (key) return { rates: PRICES[key], known: true };
  return { rates: PRICES['claude-opus-5'], known: false };
}

export function projectSlug(dir) {
  return resolve(dir).replace(/[^A-Za-z0-9]/g, '-');
}
export function projectsRoot() { return join(homedir(), '.claude', 'projects'); }

export function findTranscripts({ project = process.cwd(), session, last = 1, all = false } = {}) {
  const root = projectsRoot();
  if (session) {
    if (!existsSync(root)) return [];
    for (const p of readdirSync(root)) {
      const dir = join(root, p);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      const hit = readdirSync(dir).find(f => f.endsWith('.jsonl') && f.startsWith(session));
      if (hit) return [join(dir, hit)];
    }
    return [];
  }
  const dir = join(root, projectSlug(project));
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f))
    .map(f => ({ f, m: statSync(f).mtimeMs, s: statSync(f).size })).filter(x => x.s > 0)
    .sort((a, b) => b.m - a.m).map(x => x.f);
  return all ? files : files.slice(0, last);
}

function contentText(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return c ? JSON.stringify(c) : '';
  let s = '';
  for (const b of c) { if (b.type === 'text') s += b.text || ''; else if (b.type !== 'image') s += JSON.stringify(b); }
  return s;
}
function countImages(c) { return Array.isArray(c) ? c.filter(b => b.type === 'image').length : 0; }
function lineCount(s) { let n = 1; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++; return n; }
function isHuman(o) {
  if (o.type !== 'user' || o.isMeta || o.isSidechain) return false;
  const c = o.message?.content;
  if (typeof c === 'string') return !/^<(system-reminder|task-notification|local-command|command-name|ide_)/.test(c.trim());
  if (!Array.isArray(c)) return false;
  if (c.some(b => b.type === 'tool_result')) return false;
  const t = c.filter(b => b.type === 'text').map(b => b.text || '').join('');
  return t.length > 0 && !/^<(system-reminder|task-notification)/.test(t.trim());
}
const TEST_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bpytest\b|\bjest\b|\bvitest\b|\bgo test\b|\bcargo test\b|node --test|\bphpunit\b|\brspec\b|\bmvn test\b|\bgradle test\b/;

export function analyze(files, opts = {}) {
  const requests = []; // in order: {id, model, ts, usage, hasTool, text, tools:[names]}
  const byReq = new Map();
  const toolById = new Map(); // tool_use_id -> {name, input, reqIndex}
  const results = []; // {name, input, chars, lines, images, reqIndex}
  let humans = 0, sidechainOut = 0, sidechainCtx = 0, firstTs = null, lastTs = null, cwd = null, version = null, slug = null;
  const models = {};

  for (const file of files) {
    let raw; try { raw = readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.cwd && !cwd) cwd = o.cwd;
      if (o.version && !version) version = o.version;
      if (o.timestamp) { if (!firstTs) firstTs = o.timestamp; lastTs = o.timestamp; }
      if (o.type === 'assistant' && o.message) {
        const key = o.requestId || o.message.id || o.uuid;
        let r = byReq.get(key);
        if (!r) {
          const u = o.message.usage || {};
          r = { id: key, model: o.message.model || 'unknown', ts: o.timestamp, sidechain: !!o.isSidechain,
            in: u.input_tokens || 0, cc: u.cache_creation_input_tokens || 0, cr: u.cache_read_input_tokens || 0, out: u.output_tokens || 0,
            cc1h: u.cache_creation?.ephemeral_1h_input_tokens || 0, cc5m: u.cache_creation?.ephemeral_5m_input_tokens ?? null,
            hasTool: false, textChars: 0, tools: [], index: requests.length };
          if (r.cc5m === null) r.cc5m = r.cc - r.cc1h;
          byReq.set(key, r); requests.push(r);
          models[r.model] = (models[r.model] || 0) + 1;
        }
        for (const b of o.message.content || []) {
          if (b.type === 'tool_use') { r.hasTool = true; r.tools.push(b.name); toolById.set(b.id, { name: b.name, input: b.input || {}, reqIndex: r.index }); }
          else if (b.type === 'text') r.textChars += (b.text || '').length;
        }
      } else if (o.type === 'user') {
        if (isHuman(o)) { humans++; requests.push({ human: true, index: requests.length, ts: o.timestamp }); continue; }
        const c = o.message?.content;
        if (!Array.isArray(c)) continue;
        for (const b of c) {
          if (b.type !== 'tool_result') continue;
          const t = toolById.get(b.tool_use_id) || { name: 'unknown', input: {}, reqIndex: -1 };
          const text = contentText(b.content);
          results.push({ name: t.name, input: t.input, chars: text.length, lines: lineCount(text), images: countImages(b.content), reqIndex: t.reqIndex, isError: !!b.is_error, sidechain: !!o.isSidechain });
        }
      }
    }
  }

  // Only API requests count as turns; humans are markers in the sequence.
  const turns = requests.filter(r => !r.human);
  const N = turns.length;
  const turnPos = new Map(turns.map((r, i) => [r.index, i])); // request index -> turn number

  const tot = { in: 0, cc: 0, cr: 0, out: 0, ctx: 0, cost: 0, costIn: 0, costCw: 0, costCr: 0, costOut: 0, maxCtx: 0, unknownModel: false };
  const ctxSeries = [];
  for (const r of turns) {
    const ctx = r.in + r.cc + r.cr;
    r.ctx = ctx; ctxSeries.push(ctx);
    tot.in += r.in; tot.cc += r.cc; tot.cr += r.cr; tot.out += r.out; tot.ctx += ctx; if (ctx > tot.maxCtx) tot.maxCtx = ctx;
    const { rates, known } = priceFor(r.model); if (!known) tot.unknownModel = true;
    const [pi, pw5, pw1, prd, po] = rates;
    const cIn = r.in * pi / 1e6, cCw = (r.cc5m * pw5 + r.cc1h * pw1) / 1e6, cCr = r.cr * prd / 1e6, cOut = r.out * po / 1e6;
    r.cost = cIn + cCw + cCr + cOut;
    tot.costIn += cIn; tot.costCw += cCw; tot.costCr += cCr; tot.costOut += cOut; tot.cost += r.cost;
    if (r.sidechain) { sidechainOut += r.out; sidechainCtx += ctx; }
  }

  // Attribution: a tool result produced at turn i is re-sent on every later turn.
  // context-turns = est tokens * (N - i - 1). Same for the model's own output text.
  const est = (chars, images) => Math.round(chars / CHARS_PER_TOKEN) + images * IMAGE_TOKENS;
  const byTool = {};
  const byFile = {};
  const readsByFile = {};
  const wholeReads = [];
  const bigOutputs = [];
  const cmdCounts = {};
  let images = 0, imageTokens = 0, imageCtxTurns = 0;
  let attributedCtxTurns = 0;
  const seenPaths = new Set();
  const rewrites = [];
  for (const res of results) {
    const tokens = est(res.chars, res.images);
    const pos = turnPos.get(res.reqIndex);
    const later = pos === undefined ? 0 : Math.max(0, N - pos - 1);
    const ctxTurns = tokens * later;
    attributedCtxTurns += ctxTurns;
    const t = (byTool[res.name] ||= { calls: 0, tokens: 0, ctxTurns: 0, images: 0 });
    t.calls++; t.tokens += tokens; t.ctxTurns += ctxTurns; t.images += res.images;
    images += res.images; imageTokens += res.images * IMAGE_TOKENS; imageCtxTurns += res.images * IMAGE_TOKENS * later;
    if ((res.name === 'Write' || res.name === 'Edit' || res.name === 'Read') && res.input.file_path) {
      const p = String(res.input.file_path);
      if (res.name === 'Write') {
        const content = String(res.input.content || '');
        if (seenPaths.has(p) && lineCount(content) >= 150) rewrites.push({ file: p, lines: lineCount(content), tokens: Math.round(content.length / CHARS_PER_TOKEN) });
      }
      seenPaths.add(p);
    }
    if (res.name === 'Read' && res.input.file_path) {
      const p = String(res.input.file_path);
      const f = (byFile[p] ||= { reads: 0, tokens: 0, ctxTurns: 0, lines: 0, images: 0 });
      f.reads++; f.tokens += tokens; f.ctxTurns += ctxTurns; f.lines = Math.max(f.lines, res.lines); f.images += res.images;
      (readsByFile[p] ||= []).push({ tokens, ranged: !!(res.input.offset || res.input.limit), lines: res.lines, ctxTurns });
      if (!res.input.offset && !res.input.limit && res.lines >= 300) wholeReads.push({ file: p, lines: res.lines, tokens, ctxTurns });
    }
    if ((res.name === 'Bash' || res.name === 'PowerShell') && res.input.command) {
      const cmd = String(res.input.command).trim();
      const short = cmd.split('\n')[0].slice(0, 90);
      cmdCounts[cmd] = (cmdCounts[cmd] || 0) + 1;
      if (res.chars >= 8000) bigOutputs.push({ cmd: short, chars: res.chars, tokens, ctxTurns });
    }
  }
  // model output text also rides along
  let outputCtxTurns = 0;
  for (const r of turns) { const pos = turnPos.get(r.index); outputCtxTurns += r.out * Math.max(0, N - pos - 1); }

  const rereads = Object.entries(readsByFile).filter(([, xs]) => xs.length > 1)
    .map(([file, xs]) => ({ file, reads: xs.length, wastedTokens: xs.slice(1).reduce((a, x) => a + x.tokens, 0), wastedCtxTurns: xs.slice(1).reduce((a, x) => a + x.ctxTurns, 0) }))
    .sort((a, b) => b.wastedCtxTurns - a.wastedCtxTurns);
  const repeatedCmds = Object.entries(cmdCounts).filter(([, n]) => n >= 3).map(([cmd, n]) => ({ cmd: cmd.split('\n')[0].slice(0, 90), n, test: TEST_CMD.test(cmd) })).sort((a, b) => b.n - a.n);
  const testRuns = Object.entries(cmdCounts).filter(([c]) => TEST_CMD.test(c)).reduce((a, [, n]) => a + n, 0);

  // narration: text-only turn not followed by a human message
  const narration = [];
  for (let i = 0; i < requests.length; i++) {
    const r = requests[i]; if (r.human || r.hasTool) continue;
    const next = requests[i + 1];
    if (next && !next.human) narration.push(r);
  }
  const narrationCtx = narration.reduce((a, r) => a + r.ctx, 0);
  const longTurns = turns.filter(r => r.ctx >= 150000);
  const longCr = longTurns.reduce((a, r) => a + r.cr, 0);

  const findings = [];
  const share = (x) => tot.ctx ? x / tot.ctx : 0;
  if (rereads.length) {
    const w = rereads.reduce((a, x) => a + x.wastedCtxTurns, 0);
    findings.push({ id: 'C01', sev: sevFor(share(w)), title: `${rereads.length} file${rereads.length > 1 ? 's' : ''} read more than once`, tokens: w,
      plain: `Re-reading adds the file to context again, and it is paid for on every turn after. Top: ${rereads.slice(0, 3).map(x => `${basename(x.file)} ×${x.reads}`).join(', ')}.`,
      fix: 'A file you read and did not edit is still in context. Reference it. After an edit, re-read only the changed range.' });
  }
  if (wholeReads.length) {
    const w = wholeReads.reduce((a, x) => a + x.ctxTurns, 0);
    findings.push({ id: 'C02', sev: sevFor(share(w)), title: `${wholeReads.length} whole-file read${wholeReads.length > 1 ? 's' : ''} of 300+ lines`, tokens: w,
      plain: `Top: ${wholeReads.sort((a, b) => b.ctxTurns - a.ctxTurns).slice(0, 3).map(x => `${basename(x.file)} (${x.lines} lines)`).join(', ')}.`,
      fix: 'Grep for the symbol first, then read 40 to 80 lines around it with offset and limit.' });
  }
  if (narration.length) {
    findings.push({ id: 'C05', sev: sevFor(share(narrationCtx)), title: `${narration.length} text-only turn${narration.length > 1 ? 's' : ''} that did not end a response`, tokens: narrationCtx,
      plain: `Each one re-sent the whole context (${fmt(narrationCtx)} tokens total) to add a sentence before the next tool call.`,
      fix: 'Say one line of intent in the same turn as the tool call, or say nothing. Narration turns are pure context tax.' });
  }
  if (bigOutputs.length) {
    const w = bigOutputs.reduce((a, x) => a + x.ctxTurns, 0);
    findings.push({ id: 'C03', sev: sevFor(share(w)), title: `${bigOutputs.length} command output${bigOutputs.length > 1 ? 's' : ''} over 8K characters`, tokens: w,
      plain: `Top: ${bigOutputs.sort((a, b) => b.ctxTurns - a.ctxTurns).slice(0, 2).map(x => `"${x.cmd}" (${fmt(x.tokens)} tokens)`).join(', ')}.`,
      fix: 'Pipe through tail, head or grep. Nobody needs 400 lines of test output in context for the rest of the session.' });
  }
  if (images) {
    const w = imageCtxTurns;
    findings.push({ id: 'C06', sev: sevFor(share(w)), title: `${images} image${images > 1 ? 's' : ''} in tool results`, tokens: Math.round(w),
      plain: `About ${fmt(IMAGE_TOKENS)} tokens each, re-sent on every later turn.`,
      fix: 'Read an image once, note what you saw in a line, and do not read it again. Prefer text tools (read_page, get_page_text) over screenshots.' });
  }
  if (repeatedCmds.length) {
    const t = repeatedCmds.filter(x => x.test);
    findings.push({ id: 'C04', sev: 'medium', title: `${repeatedCmds.length} command${repeatedCmds.length > 1 ? 's' : ''} run 3+ times${testRuns ? ` (${testRuns} test runs)` : ''}`, tokens: 0,
      plain: `Top: ${repeatedCmds.slice(0, 2).map(x => `"${x.cmd}" ×${x.n}`).join(', ')}.`,
      fix: t.length ? 'Run the one test file that covers the change. Run the whole suite once at the end.' : 'If the output did not change, the second run bought nothing.' });
  }
  if (rewrites.length) {
    const w = rewrites.reduce((a, x) => a + x.tokens, 0);
    findings.push({ id: 'C08', sev: sevFor(share(w * 4)), title: `${rewrites.length} existing file${rewrites.length > 1 ? 's' : ''} rewritten with Write instead of Edit`, tokens: w,
      plain: `Top: ${rewrites.sort((a, b) => b.tokens - a.tokens).slice(0, 3).map(x => `${basename(x.file)} (${x.lines} lines)`).join(', ')}. Each rewrite is paid as output and then as context on every later turn.`,
      fix: 'Use Edit for changes to files that already exist. Write is for new files.' });
  }
  if (longTurns.length) {
    findings.push({ id: 'C07', sev: sevFor(longTurns.length / Math.max(1, N)), title: `${longTurns.length} of ${N} turns ran with 150K+ tokens of context`, tokens: longCr,
      plain: `Those turns re-read ${fmt(longCr)} cached tokens. Past this point most of what is in context is no longer needed for the current step.`,
      fix: 'At a task boundary, write a five-line handoff and start a new session. The same work costs a fraction from a fresh context.' });
  }
  findings.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.sev] - ({ high: 0, medium: 1, low: 2 })[b.sev] || b.tokens - a.tokens);

  const topN = opts.top || 8;
  const tools = Object.entries(byTool).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.ctxTurns - a.ctxTurns);
  const filesTop = Object.entries(byFile).map(([file, v]) => ({ file, ...v })).sort((a, b) => b.ctxTurns - a.ctxTurns).slice(0, topN);
  const changeOne = findings[0] ? findings[0].fix : 'Nothing stands out. This session was already frugal.';

  return {
    files: files.map(f => basename(f)), sessionIds: files.map(f => basename(f).replace('.jsonl', '')), project: cwd, version, slug,
    span: { first: firstTs, last: lastTs }, models,
    turns: N, humanMessages: humans,
    tokens: { input: tot.in, cacheWrite: tot.cc, cacheRead: tot.cr, output: tot.out, contextProcessed: tot.ctx, avgContext: N ? Math.round(tot.ctx / N) : 0, maxContext: tot.maxCtx },
    cost: { total: tot.cost, input: tot.costIn, cacheWrite: tot.costCw, cacheRead: tot.costCr, output: tot.costOut, unknownModel: tot.unknownModel },
    subagents: { outputTokens: sidechainOut, contextTokens: sidechainCtx },
    attribution: { toolResultsCtxTurns: attributedCtxTurns, outputCtxTurns, baseCtxTurns: Math.max(0, tot.ctx - attributedCtxTurns - outputCtxTurns), tools: tools.slice(0, topN), files: filesTop },
    narration: { turns: narration.length, contextTokens: narrationCtx },
    testRuns, images, findings, changeOne, ctxSeries,
    estimateNote: `Tool result tokens are estimated at ${CHARS_PER_TOKEN} chars per token; images at ${IMAGE_TOKENS} each.`,
  };
}

function sevFor(shareOfCtx) { return shareOfCtx >= 0.15 ? 'high' : shareOfCtx >= 0.05 ? 'medium' : 'low'; }
export function fmt(n) { n = Math.round(n || 0); if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return Math.round(n / 1e3) + 'K'; return String(n); }
const money = (x) => '$' + (x >= 100 ? x.toFixed(0) : x.toFixed(2));
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '0%';

export function format(r) {
  const out = [];
  const model = Object.entries(r.models).sort((a, b) => b[1] - a[1]).map(([m]) => m).join(', ') || 'unknown';
  const when = r.span.first ? `${r.span.first.slice(0, 10)}${r.span.last && r.span.last.slice(0, 10) !== r.span.first.slice(0, 10) ? ' → ' + r.span.last.slice(0, 10) : ''}` : '';
  out.push(`cheapskate  ${r.sessionIds.length === 1 ? 'session ' + r.sessionIds[0].slice(0, 8) : r.sessionIds.length + ' sessions'}  ·  ${r.project ? basename(r.project) : ''}  ·  ${when}  ·  ${model}`);
  out.push('');
  const t = r.tokens, c = r.cost;
  out.push(`Turns             ${r.turns}   (${r.humanMessages} message${r.humanMessages === 1 ? '' : 's'} from you)`);
  out.push(`Output tokens     ${fmt(t.output).padStart(7)}   ${pct(c.output, c.total)} of cost`);
  out.push(`Context re-sent   ${fmt(t.contextProcessed).padStart(7)}   ${pct(c.input + c.cacheWrite + c.cacheRead, c.total)} of cost   avg ${fmt(t.avgContext)} per turn, max ${fmt(t.maxContext)}`);
  out.push(`  fresh input     ${fmt(t.input).padStart(7)}   cache writes ${fmt(t.cacheWrite)}   cache reads ${fmt(t.cacheRead)}`);
  out.push(`Est. cost         ${money(c.total).padStart(7)}   at list price for ${model}${c.unknownModel ? ' (unknown model, priced as Opus 5)' : ''}`);
  if (r.subagents.outputTokens) out.push(`Subagents         ${fmt(r.subagents.contextTokens)} context, ${fmt(r.subagents.outputTokens)} output`);
  out.push('');
  out.push('Where the re-sent context came from   (tokens × turns it stayed in context, share)');
  const total = r.attribution.toolResultsCtxTurns + r.attribution.outputCtxTurns + r.attribution.baseCtxTurns || 1;
  for (const x of r.attribution.tools) out.push(`  ${x.name.padEnd(28)} ${fmt(x.ctxTurns).padStart(7)}  ${pct(x.ctxTurns, total).padStart(4)}   ${x.calls} call${x.calls > 1 ? 's' : ''}${x.images ? `, ${x.images} image${x.images > 1 ? 's' : ''}` : ''}`);
  out.push(`  ${'(model output, incl. file writes)'.padEnd(28)} ${fmt(r.attribution.outputCtxTurns).padStart(7)}  ${pct(r.attribution.outputCtxTurns, total).padStart(4)}`);
  out.push(`  ${'(system prompt, tools, skills)'.padEnd(28)} ${fmt(r.attribution.baseCtxTurns).padStart(7)}  ${pct(r.attribution.baseCtxTurns, total).padStart(4)}   estimated remainder`);
  if (r.attribution.files.length) {
    out.push('');
    out.push('Files that cost the most');
    for (const f of r.attribution.files) out.push(`  ${shortPath(f.file).padEnd(52)} ${fmt(f.ctxTurns).padStart(7)}   ${f.reads} read${f.reads > 1 ? 's' : ''}, ${f.lines} lines${f.images ? ', image' : ''}`);
  }
  out.push('');
  if (r.findings.length) {
    out.push('Waste');
    for (const f of r.findings.slice(0, 5)) {
      out.push(`  ${f.id}  ${f.sev.toUpperCase().padEnd(6)} ${f.title}${f.tokens ? `   (${fmt(f.tokens)} tokens)` : ''}`);
      out.push(`       ${f.plain}`);
      out.push(`       Fix: ${f.fix}`);
    }
    if (r.findings.length > 5) out.push(`  and ${r.findings.length - 5} more`);
    out.push('');
  }
  out.push(`Change one thing: ${r.changeOne}`);
  out.push('');
  out.push(r.estimateNote);
  return out.join('\n');
}
function shortPath(p) { p = String(p).replace(/\\/g, '/'); return p.length > 50 ? '…' + p.slice(-49) : p; }

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const json = args.includes('--json'), all = args.includes('--all');
  const last = Number(flag('--last') || 1), top = Number(flag('--top') || 8);
  const positional = args.filter((a, i) => !a.startsWith('--') && !['--last', '--top', '--session', '--project'].includes(args[i - 1]));
  let files = [];
  if (positional[0] && positional[0].endsWith('.jsonl')) files = [resolve(positional[0])];
  else files = findTranscripts({ project: flag('--project') || positional[0] || process.cwd(), session: flag('--session'), last, all });
  if (!files.length) {
    console.error(`cheapskate: no transcripts found. Looked under ${join(projectsRoot(), projectSlug(flag('--project') || positional[0] || process.cwd()))}`);
    console.error('Run from a project directory that has had Claude Code sessions, or pass a .jsonl file.');
    process.exit(2);
  }
  if (all) {
    const r = analyze(files, { top });
    console.log(json ? JSON.stringify(r, null, 2) : format(r));
  } else {
    const reports = files.map(f => analyze([f], { top }));
    console.log(json ? JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2) : reports.map(format).join('\n\n' + '─'.repeat(70) + '\n\n'));
  }
}

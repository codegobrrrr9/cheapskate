// Generates tests/fixtures/sample.jsonl: a synthetic Claude Code transcript with the shape of a
// typical wasteful session (whole-file reads, a re-read, narration, repeated test runs, a rewrite).
// No real data. Run: node tests/fixtures/make-sample.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let n = 0;
const ts = () => new Date(1789000000000 + (n++) * 7000).toISOString();
const M = 'claude-sonnet-5';
const usage = (u) => ({ input_tokens: u.in ?? 0, cache_creation_input_tokens: u.cc ?? 0, cache_read_input_tokens: u.cr ?? 0, output_tokens: u.out ?? 0,
  cache_creation: { ephemeral_5m_input_tokens: u.cc ?? 0, ephemeral_1h_input_tokens: 0 } });
const human = (text) => ({ type: 'user', timestamp: ts(), cwd: '/home/dev/todo-app', version: '2.1.266', message: { role: 'user', content: text } });
const asst = (id, u, blocks) => blocks.map(b => ({ type: 'assistant', timestamp: ts(), requestId: id, cwd: '/home/dev/todo-app', message: { id: 'msg_' + id, model: M, usage: usage(u), content: [b] } }));
const text = (t) => ({ type: 'text', text: t });
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const result = (id, content) => ({ type: 'user', timestamp: ts(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const lines = (count, width = 48) => Array.from({ length: count }, (_, i) => `  const line${i} = compute(${i});`.padEnd(width)).join('\n');

let ctx = 9000;
const step = (add) => { const cr = ctx; ctx += add; return { in: 12, cc: add, cr, out: 0 }; };
const E = [];
E.push(human('Add a "mark all done" button to the todo list'));
E.push(...asst('r01', { ...step(0), out: 90 }, [text('I will start by looking at the app structure.'), tool('t01', 'Glob', { pattern: '**/*.{js,jsx}' })]));
E.push(result('t01', Array.from({ length: 42 }, (_, i) => `/home/dev/todo-app/src/f${i}.js`).join('\n')));
E.push(...asst('r02', { ...step(1200), out: 70 }, [tool('t02', 'Read', { file_path: '/home/dev/todo-app/src/App.jsx' })]));
E.push(result('t02', lines(520)));
E.push(...asst('r03', { ...step(6500), out: 60 }, [tool('t03', 'Read', { file_path: '/home/dev/todo-app/src/store.js' })]));
E.push(result('t03', lines(380)));
E.push(...asst('r04', { ...step(4800), out: 140 }, [text('Now I understand the structure. Let me look at the TodoList component next to see how items are rendered.')]));
E.push(...asst('r05', { ...step(200), out: 60 }, [tool('t04', 'Read', { file_path: '/home/dev/todo-app/src/components/TodoList.jsx' })]));
E.push(result('t04', lines(210)));
E.push(...asst('r06', { ...step(2700), out: 900 }, [tool('t05', 'Edit', { file_path: '/home/dev/todo-app/src/components/TodoList.jsx', old_string: 'const line3', new_string: 'const line3 // mark all' })]));
E.push(result('t05', 'The file has been updated.'));
E.push(...asst('r07', { ...step(300), out: 70 }, [tool('t06', 'Bash', { command: 'npm test' })]));
E.push(result('t06', lines(260, 60)));
E.push(...asst('r08', { ...step(4000), out: 60 }, [tool('t07', 'Read', { file_path: '/home/dev/todo-app/src/store.js' })]));
E.push(result('t07', lines(380)));
E.push(...asst('r09', { ...step(4800), out: 3200 }, [tool('t08', 'Write', { file_path: '/home/dev/todo-app/src/store.js', content: lines(390) })]));
E.push(result('t08', 'File written'));
E.push(...asst('r10', { ...step(3300), out: 70 }, [tool('t09', 'Bash', { command: 'npm test' })]));
E.push(result('t09', lines(260, 60)));
E.push(...asst('r11', { ...step(4000), out: 110 }, [text('Tests pass. Let me double-check App.jsx once more before finishing.')]));
E.push(...asst('r12', { ...step(200), out: 60 }, [tool('t10', 'Read', { file_path: '/home/dev/todo-app/src/App.jsx' })]));
E.push(result('t10', lines(520)));
E.push(...asst('r13', { ...step(6500), out: 70 }, [tool('t11', 'Bash', { command: 'npm test' })]));
E.push(result('t11', lines(260, 60)));
E.push(...asst('r14', { ...step(4000), out: 260 }, [text('Done. Added a "Mark all done" button in TodoList.jsx and a markAllDone action in store.js. All 14 tests pass.')]));

const out = join(dirname(fileURLToPath(import.meta.url)), 'sample.jsonl');
writeFileSync(out, E.map(e => JSON.stringify(e)).join('\n') + '\n');
console.log('wrote', out, E.length, 'lines');

// xss:check (task 3.3): every case in fixtures/xss/cases.json through the real renderer. A case fails if any
// forbidden pattern survives in the output or a must_contain string is missing. Exit 1 naming the first failure.
// --fixtures <dir> points at a copy (the gate proof).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMarkdown, renderText } from '../src/render';

type Case = { id: string; field: string; class: 'markdown' | 'text'; input: string; forbidden: string[]; must_contain: string[]; note: string };
const i = process.argv.indexOf('--fixtures');
const dir = i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : 'fixtures';
const spec = JSON.parse(readFileSync(join(dir, 'xss', 'cases.json'), 'utf8')) as { live_patterns: Record<string, string>; cases: Case[] };
const patterns = Object.fromEntries(Object.entries(spec.live_patterns).map(([k, v]) => [k, new RegExp(v, 'i')]));

let failed = 0;
let slowest = { id: '', ms: 0 };
for (const c of spec.cases) {
  const t = performance.now();
  const out = c.class === 'markdown' ? renderMarkdown(c.input) : renderText(c.input);
  const ms = performance.now() - t;
  if (ms > slowest.ms) slowest = { id: c.id, ms };
  const live = c.forbidden.filter((k) => patterns[k]!.test(out));
  const missing = c.must_contain.filter((s) => !out.includes(s));
  if (live.length || missing.length || ms > 2000) {
    failed++;
    console.error(`xss:check: FAIL ${c.id} (${c.field}, ${c.note})${live.length ? ` live: ${live.join(', ')}` : ''}${missing.length ? ` missing: ${missing.map((m) => JSON.stringify(m.slice(0, 40))).join(', ')}` : ''}${ms > 2000 ? ` slow: ${ms.toFixed(0)} ms` : ''}`);
    console.error(`  output: ${out.slice(0, 200).replace(/\n/g, '\\n')}`);
  }
}
if (failed) {
  console.error(`xss:check: ${failed} of ${spec.cases.length} cases failed`);
  process.exit(1);
}
console.log(`xss:check: OK — ${spec.cases.length} cases inert through src/render (slowest ${slowest.id} ${slowest.ms.toFixed(1)} ms)`);

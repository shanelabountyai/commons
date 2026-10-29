// engine:eval (task 1.9): the four engines over fixtures/, every expected file diffed, exit 1 naming the first
// difference (file, row, field, expected, actual). Options: --fixtures <dir> to point at a copy (the gate proof in
// 1.11 and the "Before Phase 2" gravity check use it), --rules <dir> for an alternative rules/ directory.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate } from '../src/eval';
import { expectedRows, loadFixtures } from '../src/fixtures/load';
import { parseLimitRules, parseRankingRules } from '../src/rules';

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
};
const fixturesDir = arg('--fixtures', 'fixtures');
const rulesDir = arg('--rules', 'rules');
const ranking = parseRankingRules(JSON.parse(readFileSync(join(rulesDir, 'ranking.json'), 'utf8')));
const limits = parseLimitRules(JSON.parse(readFileSync(join(rulesDir, 'limits.json'), 'utf8')));
const fx = loadFixtures(fixturesDir);
const report = evaluate(fx, ranking, limits, (name) => expectedRows(name, fixturesDir));

console.log(`engine:eval — ${report.nodes} nodes, ${report.visiblePosts} visible posts, now ${report.now}, fixtures ${fixturesDir}, rules ${rulesDir}`);
console.log('vote outcomes: ' + Object.entries(report.outcomes).map(([k, v]) => `${k} ${v}`).join(', '));
for (const t of report.threads) console.log(`thread ${t.post_id.padEnd(8)} ${t.comments_total} comments, ${t.top_level_shown} top-level shown, ${t.pages} pages`);
for (const l of report.limits) console.log(`limits ${l.script.padEnd(22)} ${String(l.attempts).padStart(3)} attempts, ${String(l.allowed).padStart(3)} allowed, ${String(l.refused).padStart(3)} refused, first retryAfter ${l.firstRetryAfter ?? '-'}`);
let failed = false;
for (const f of report.files) {
  const ok = !f.firstDiff && f.matched === f.rows;
  console.log(`${ok ? 'ok  ' : 'DIFF'} ${f.file.padEnd(36)} ${f.matched}/${f.rows} rows` + (f.firstDiff ? `  first: row ${f.firstDiff.row} ${f.firstDiff.field}: expected ${f.firstDiff.expected}, actual ${f.firstDiff.actual}` : ''));
  failed ||= !ok;
}
if (failed) {
  const d = report.files.find((f) => f.firstDiff)!.firstDiff!;
  console.error(`engine:eval: FAIL — ${d.file} row ${d.row} ${d.field}: expected ${d.expected}, actual ${d.actual}`);
  process.exit(1);
}
console.log(`engine:eval: OK — ${report.files.length} files, ${report.files.reduce((n, f) => n + f.rows, 0)} rows, 0 differences`);

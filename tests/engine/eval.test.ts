// The oracle agreement as a vitest, so `npm test` alone proves Phase 1 (task 1.9). engine:eval prints the table.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate } from '@/eval';
import { expectedRows, loadFixtures } from '@/fixtures/load';
import { parseLimitRules, parseRankingRules } from '@/rules';

describe('engines agree with the Python reference on every expected file', () => {
  const report = evaluate(loadFixtures(), parseRankingRules(JSON.parse(readFileSync('rules/ranking.json', 'utf8'))), parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8'))), (n) => expectedRows(n));
  it('12 files, every row matched', () => {
    expect(report.files).toHaveLength(12);
    for (const f of report.files) {
      expect(f.firstDiff, f.file).toBeUndefined();
      expect(f.matched, f.file).toBe(f.rows);
    }
  });
  it('the named cases are where the brief says', () => {
    expect(report.outcomes).toMatchObject({ SELF_VOTE: 5, GATED_DOWNVOTE: 12, UNKNOWN_NODE: 0 });
    expect(report.limits.find((l) => l.script === 'spam-young-votes')).toMatchObject({ allowed: 20, refused: 80, firstRetryAfter: 50 });
    expect(report.limits.filter((l) => l.script.startsWith('normal-')).every((l) => l.refused === 0)).toBe(true);
  });
});

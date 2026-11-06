// PRD 5.2 (D-75): the pure vote-signal detector against the oracle's scenario fixture. Written before
// src/votes/signals.ts (rule 7); the expected rows come from tools/signallib.py via reference_rank --write-expected.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expectedRows } from '@/fixtures/load';
import { parseLimitRules } from '@/rules';
import { detectSignals, type SignalScenario } from '@/votes/signals';

const rules = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const scenarios = (JSON.parse(readFileSync('fixtures/signals/scenarios.json', 'utf8')) as { scenarios: SignalScenario[] }).scenarios;
const expected = expectedRows('signals/expected_signals.csv');

describe('vote signals (5.2) against fixtures/signals', () => {
  it('rules carry ring and aged_brigade as data', () => {
    expect(rules.signals.ring).toEqual({ min_voters: 6, window_seconds: 600 });
    expect(rules.signals.aged_brigade).toEqual({ min_voters: 5, window_seconds: 600, max_account_age_days: 7 });
  });
  for (const sc of scenarios) {
    it(`${sc.id}: ${sc.note}`, () => {
      const got = detectSignals(sc, rules).map((s) => ({ scenario: sc.id, kind: s.kind, node: s.node, voters: String(s.voters), window_start: String(s.window_start) }));
      expect(got).toEqual(expected.filter((r) => r.scenario === sc.id));
    });
  }
  it('every scenario in the expected file exists in the input', () => {
    const ids = new Set(scenarios.map((s) => s.id));
    expect(expected.every((r) => ids.has(r.scenario!))).toBe(true);
    expect(expected).toHaveLength(6);
  });
});

describe('false positives on the community (5.2 acceptance)', () => {
  it('10,607 ordinary votes raise only the planted BRIGADE on P-BRIGADE (7) — no RING, no AGED_BRIGADE', async () => {
    const { evaluate } = await import('@/eval');
    const { loadFixtures } = await import('@/fixtures/load');
    const { parseRankingRules } = await import('@/rules');
    const report = evaluate(loadFixtures(), parseRankingRules(JSON.parse(readFileSync('rules/ranking.json', 'utf8'))), rules, (n) => expectedRows(n));
    expect(report.communitySignals.map((s) => [s.kind, s.node, s.voters])).toEqual([['BRIGADE', 'P-BRIGADE', 7]]);
  });
});

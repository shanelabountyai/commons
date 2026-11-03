// PRD 5.4 B: the pure report-swarm detector against the oracle's scenario fixture. Written before
// src/limits/report-swarm.ts (rule 7); the expected rows come from tools/modlib.py via reference_rank --write-expected.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expectedRows } from '@/fixtures/load';
import { detectReportSwarms, type SwarmScenario } from '@/limits/report-swarm';
import { parseModerationRules } from '@/rules';

const mod = parseModerationRules(JSON.parse(readFileSync('rules/moderation.json', 'utf8')));
const scenarios = (JSON.parse(readFileSync('fixtures/moderation/scenarios.json', 'utf8')) as { scenarios: SwarmScenario[] }).scenarios;
const expected = expectedRows('moderation/expected_report_signals.csv');

describe('report swarms (5.4 B) against fixtures/moderation', () => {
  it('rules carry report_swarm and lock_refuses as data', () => {
    expect(mod.report_swarm).toEqual({ min_reporters: 4, window_seconds: 86_400, max_reporter_age_days: 7 });
    expect(mod.lock_refuses).toEqual(['reply', 'vote', 'edit', 'upload']);
  });
  for (const sc of scenarios) {
    it(`${sc.id}: ${sc.note}`, () => {
      const got = detectReportSwarms(sc, mod).map((s) => ({ scenario: sc.id, author: s.author, reporters: String(s.reporters), window_start: String(s.window_start) }));
      expect(got).toEqual(expected.filter((r) => r.scenario === sc.id));
    });
  }
  it('every scenario in the expected file exists in the input; 8 scenarios, 2 signals', () => {
    const ids = new Set(scenarios.map((s) => s.id));
    expect(expected.every((r) => ids.has(r.scenario!))).toBe(true);
    expect(scenarios).toHaveLength(8);
    expect(expected).toHaveLength(2);
  });
});

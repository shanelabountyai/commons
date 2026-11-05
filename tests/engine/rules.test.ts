import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLimitRules, parseRankingRules, windowFor } from '@/rules';

const ranking = () => JSON.parse(readFileSync('rules/ranking.json', 'utf8'));
const limits = () => JSON.parse(readFileSync('rules/limits.json', 'utf8'));

describe('rules loader (task 1.4)', () => {
  it('loads both committed files', () => {
    const r = parseRankingRules(ranking());
    expect(r.hot.gravity_seconds).toBe(45000);
    expect(r.best.z).toBeCloseTo(1.959963984540054, 12);
    const l = parseLimitRules(limits());
    expect(l.windows).toHaveLength(7);
    expect(windowFor(l, 'comment')).toMatchObject({ per_seconds: 60, max: 6, young_max: 2 });
    expect(windowFor(l, 'comment', 'profile+post')).toMatchObject({ per_seconds: 3600, max: 10, young_max: 3 }); // PRD 6.4 (D-93)
    expect(l.max_depth_written).toBe(32);
    expect(l.signals.brigade).toEqual({ min_voters: 5, window_seconds: 600 }); // 4.1.3: D-31's constants are data
  });

  it('4.1.3: refuses a brigade signal rule with zero voters or an unknown key', () => {
    const bad = JSON.parse(JSON.stringify(limits())) as { signals: { brigade: Record<string, unknown> } };
    bad.signals.brigade.min_voters = 0;
    expect(() => parseLimitRules(bad)).toThrow(/signals\.brigade\.min_voters/);
    const extra = JSON.parse(JSON.stringify(limits())) as { signals: { brigade: Record<string, unknown> } };
    extra.signals.brigade.auto_remove = true;
    expect(() => parseLimitRules(extra)).toThrow(/signals\.brigade/);
  });
  it('refuses a negative gravity by name', () => {
    const r = ranking();
    r.hot.gravity_seconds = -1;
    expect(() => parseRankingRules(r)).toThrow(/RULES_INVALID: hot\.gravity_seconds/);
  });
  it('refuses a missing window by name', () => {
    const l = limits();
    l.windows = l.windows.filter((w: { action: string }) => w.action !== 'report');
    expect(() => parseLimitRules(l)).toThrow(/RULES_INVALID: windows: every action needs a window/);
  });
  it('refuses an unknown action by name', () => {
    const l = limits();
    l.windows.push({ action: 'poke', per_seconds: 60, max: 1, young_max: 1 });
    expect(() => parseLimitRules(l)).toThrow(/RULES_INVALID: windows\.7\.action/);
  });
  it('PRD 6.4: refuses a second window for the same (action, scope), and a profile+post scope on anything but comment', () => {
    const dup = limits();
    dup.windows.push({ action: 'comment', scope: 'profile+post', per_seconds: 60, max: 1, young_max: 1 });
    expect(() => parseLimitRules(dup)).toThrow(/RULES_INVALID: windows: duplicate action and scope/);
    const vote = limits();
    vote.windows.push({ action: 'vote', scope: 'profile+post', per_seconds: 60, max: 1, young_max: 1 });
    expect(() => parseLimitRules(vote)).toThrow(/RULES_INVALID: windows\.7\.scope/);
  });
  it('refuses an unknown key (closed schema) and young_max above max', () => {
    const r = ranking();
    r.hot.decay = 2;
    expect(() => parseRankingRules(r)).toThrow(/RULES_INVALID: hot/);
    const l = limits();
    l.windows[0].young_max = l.windows[0].max + 1;
    expect(() => parseLimitRules(l)).toThrow(/RULES_INVALID: windows\.0\.young_max/);
  });
});

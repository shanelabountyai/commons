// Report swarms (PRD 5.4 B, D-31). Pure: reports and accounts in, signals out; `now` is each report's time.
// Written from docs/prd/5.4-mod-queue-v2.md, not from tools/modlib.py. A signal is for a human — nothing here
// hides a report or acts on anyone (D-31). Lives in the limits engine because it is the age gate (L-1's cousin)
// applied to the `report` action across one target author, not a vote rule.
//   qualifying report = one whose reporter is younger than max_reporter_age_days at the report's time
// On each qualifying report at t on a node by author A, the distinct qualifying reporters of A's nodes in
// (t − window_seconds, t] are counted; at ≥ min_reporters, a signal for A whose window_start is inside the window
// has its count updated, else a new one opens with window_start = the first qualifying report in the window.
// One reporter on many nodes is one reporter: rules/limits.json's `report` window covers that case.
import type { ModerationRules } from '@/rules';

export type SwarmScenario = {
  id: string;
  note: string;
  accounts: { id: string; created_at: number }[];
  nodes: { id: string; author: string }[];
  reports: { row: number; reporter: string; node_id: string; reported_at: number }[];
};
export type SwarmSignal = { author: string; reporters: number; window_start: number };
export type SwarmRule = ModerationRules['report_swarm'];

const DAY = 86_400;

/** Is a reporter who joined at `joined` younger than the rule allows at instant `at`? Strict: exactly max days old is not younger. */
export const youngReporter = (joined: number, at: number, rule: SwarmRule): boolean => at - joined < rule.max_reporter_age_days * DAY;

/** The window rule at the instant of one qualifying report: the distinct reporters and the window's first report, or null below threshold. */
export function swarmWindow(qualifying: readonly { reporter: string; at: number }[], at: number, rule: SwarmRule): { reporters: string[]; windowStart: number; since: number } | null {
  const since = at - rule.window_seconds;
  const inWindow = qualifying.filter((q) => q.at > since && q.at <= at);
  const reporters = [...new Set(inWindow.map((q) => q.reporter))];
  if (reporters.length < rule.min_reporters) return null;
  return { reporters, windowStart: Math.min(...inWindow.map((q) => q.at)), since };
}

/** All swarm signals a scenario's reports raise, in (author, window_start) order. */
export function detectReportSwarms(sc: SwarmScenario, rules: ModerationRules): SwarmSignal[] {
  const rule = rules.report_swarm;
  const joined = new Map(sc.accounts.map((a) => [a.id, a.created_at]));
  const authorOf = new Map(sc.nodes.map((n) => [n.id, n.author]));
  const ordered = [...sc.reports].sort((a, b) => a.reported_at - b.reported_at || a.row - b.row);
  const seen = new Map<string, { reporter: string; at: number }[]>(); // author → qualifying reports
  const signals: SwarmSignal[] = [];
  for (const r of ordered) {
    if (!youngReporter(joined.get(r.reporter)!, r.reported_at, rule)) continue;
    const author = authorOf.get(r.node_id)!;
    const list = seen.get(author) ?? [];
    list.push({ reporter: r.reporter, at: r.reported_at });
    seen.set(author, list);
    const w = swarmWindow(list, r.reported_at, rule);
    if (!w) continue;
    const open = signals.find((s) => s.author === author && s.window_start > w.since);
    if (open) open.reporters = w.reporters.length;
    else signals.push({ author, reporters: w.reporters.length, window_start: w.windowStart });
  }
  return signals.sort((a, b) => (a.author < b.author ? -1 : a.author > b.author ? 1 : a.window_start - b.window_start));
}

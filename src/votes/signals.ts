// Vote signals (PRD 5.2, D-31, D-75). Pure: events and accounts in, signals out; `now` is each event's cast time.
// Written from docs/prd/5.2-vote-signals-as-data.md, not from tools/signallib.py. Signals are for a human — nothing
// here changes a count (D-31). Three kinds share one window rule:
//   BRIGADE       qualifying event = a GATED_DOWNVOTE                                   (D-31)
//   RING          qualifying event = an APPLIED +1 by a voter young (L-1) at cast time
//   AGED_BRIGADE  qualifying event = an APPLIED −1 by a voter younger than max_account_age_days at cast time
// On each qualifying event at t, the distinct voters with qualifying events of that kind on that node in
// (t − window_seconds, t] are counted; at ≥ min_voters, a signal of the same kind and node whose window_start is
// inside the window has its count updated, else a new one opens with window_start = the first event in the window.
import { isYoung, type Account } from '@/limits';
import type { LimitRules } from '@/rules';
import { reduceVotes, type Outcome, type VoteEventIn } from '.';

export type SignalKind = 'BRIGADE' | 'RING' | 'AGED_BRIGADE';
export const SIGNAL_KINDS: readonly SignalKind[] = ['BRIGADE', 'RING', 'AGED_BRIGADE'];
export type Signal = { kind: SignalKind; node: string; voters: number; window_start: number };
export type SignalScenario = {
  id: string;
  note: string;
  accounts: { id: string; created_at: number; contributions?: number[] }[];
  nodes: { id: string; author: string }[];
  events: { row: number; voter: string; node_id: string; value: 1 | -1; cast_at: number }[];
};

const DAY = 86_400;
const ruleFor = (kind: SignalKind, rules: LimitRules) => (kind === 'BRIGADE' ? rules.signals.brigade : kind === 'RING' ? rules.signals.ring : rules.signals.aged_brigade);

/** Does one vote event count toward a signal of this kind? */
export function qualifies(kind: SignalKind, outcome: Outcome, value: 1 | -1, account: Account, at: number, rules: LimitRules): boolean {
  if (kind === 'BRIGADE') return outcome === 'GATED_DOWNVOTE';
  if (kind === 'RING') return outcome === 'APPLIED' && value === 1 && isYoung(account, at, rules);
  return outcome === 'APPLIED' && value === -1 && at - account.created_at < rules.signals.aged_brigade.max_account_age_days * DAY;
}

/** The window rule for one kind at the instant of a qualifying event: the distinct voters and the window's first event, or null below threshold. */
export function windowAt(kind: SignalKind, qualifying: readonly { voter: string; at: number }[], at: number, rules: LimitRules): { voters: number; windowStart: number; since: number } | null {
  const r = ruleFor(kind, rules);
  const since = at - r.window_seconds;
  const inWindow = qualifying.filter((q) => q.at > since && q.at <= at);
  const voters = new Set(inWindow.map((q) => q.voter)).size;
  if (voters < r.min_voters) return null;
  return { voters, windowStart: Math.min(...inWindow.map((q) => q.at)), since };
}

/** All signals a scenario's events raise, in (node, kind, window_start) order. */
export function detectSignals(sc: SignalScenario, rules: LimitRules): Signal[] {
  const created = new Map(sc.accounts.map((a) => [a.id, a.created_at]));
  const contribs = new Map(sc.accounts.map((a) => [a.id, [...(a.contributions ?? [])].sort((x, y) => x - y)]));
  const accountAt = (voter: string, at: number): Account => ({ created_at: created.get(voter)!, contributions: (contribs.get(voter) ?? []).filter((t) => t < at).length });
  const nodes = new Map(sc.nodes.map((n) => [n.id, n.author]));
  const events: VoteEventIn[] = sc.events.map((e) => ({ row: e.row, voter: e.voter, node_id: e.node_id, value: e.value, cast_at: e.cast_at }));
  const { outcomes } = reduceVotes(nodes, events, accountAt, rules);
  const ordered = [...events].sort((a, b) => a.cast_at - b.cast_at || a.row - b.row);
  const seen = new Map<string, { voter: string; at: number }[]>(); // `${kind}\u0000${node}`
  const signals: Signal[] = [];
  for (const e of ordered) {
    const outcome = outcomes.get(e.row)!;
    for (const kind of SIGNAL_KINDS) {
      if (!qualifies(kind, outcome, e.value, accountAt(e.voter, e.cast_at), e.cast_at, rules)) continue;
      const k = `${kind}\u0000${e.node_id}`;
      const list = seen.get(k) ?? [];
      list.push({ voter: e.voter, at: e.cast_at });
      seen.set(k, list);
      const w = windowAt(kind, list, e.cast_at, rules);
      if (!w) continue;
      const open = signals.find((s) => s.kind === kind && s.node === e.node_id && s.window_start > w.since);
      if (open) open.voters = w.voters;
      else signals.push({ kind, node: e.node_id, voters: w.voters, window_start: w.windowStart });
    }
  }
  return signals.sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.window_start - b.window_start));
}

// Vote-event reducer (brief §2b V-1..V-5; D-12, D-15). Pure: events in, current votes and counts out. Vote rows are
// truth and counts are the cache this reducer defines (CLAUDE.md non-negotiable 3). Written from the brief, not
// from tools/votelib.py.
import { downvoteAllowed, type Account } from '@/limits';
import type { LimitRules } from '@/rules';

export type VoteValue = 1 | -1;
export type VoteEventIn = { row: number; voter: string; node_id: string; value: VoteValue; cast_at: number };
export type Outcome = 'APPLIED' | 'TOGGLED_OFF' | 'SWITCHED' | 'SELF_VOTE' | 'GATED_DOWNVOTE' | 'UNKNOWN_NODE';
export type Counts = { ups: number; downs: number };
export type NodeAuthors = ReadonlyMap<string, string>;
/** Who the voter was at cast time: account age from created_at, contributions as of cast_at (L-5). */
export type AccountAt = (voter: string, at: number) => Account;

export function reduceVotes(nodes: NodeAuthors, events: readonly VoteEventIn[], accountAt: AccountAt, rules: LimitRules): { counts: Map<string, Counts>; outcomes: Map<number, Outcome> } {
  const current = new Map<string, VoteValue | 0>(); // `${voter}\u0000${node}`
  const key = (voter: string, node: string) => `${voter}\u0000${node}`;
  for (const [node, author] of nodes) current.set(key(author, node), 1); // V-1: the author's fixed +1
  const ordered = [...events].sort((a, b) => a.cast_at - b.cast_at || a.row - b.row);
  const outcomes = new Map<number, Outcome>();
  for (const e of ordered) {
    const author = nodes.get(e.node_id);
    if (author === undefined) {
      outcomes.set(e.row, 'UNKNOWN_NODE');
      continue;
    }
    if (author === e.voter) {
      outcomes.set(e.row, 'SELF_VOTE');
      continue;
    }
    if (e.value === -1 && !downvoteAllowed(accountAt(e.voter, e.cast_at), e.cast_at, rules)) {
      outcomes.set(e.row, 'GATED_DOWNVOTE');
      continue;
    }
    const k = key(e.voter, e.node_id);
    const cur = current.get(k) ?? 0;
    if (cur === e.value) {
      current.set(k, 0);
      outcomes.set(e.row, 'TOGGLED_OFF');
    } else {
      current.set(k, e.value);
      outcomes.set(e.row, cur === 0 ? 'APPLIED' : 'SWITCHED');
    }
  }
  const counts = new Map<string, Counts>();
  for (const node of nodes.keys()) counts.set(node, { ups: 0, downs: 0 });
  for (const [k, v] of current) {
    if (v === 0) continue;
    const node = k.slice(k.indexOf('\u0000') + 1);
    const c = counts.get(node)!;
    if (v === 1) c.ups++;
    else c.downs++;
  }
  return { counts, outcomes };
}

// The vote path (task 2.5): V-1..V-4 applied live against the current Vote row, counts updated, a VoteEvent written
// with the outcome, all in the caller's transaction; the D-31 brigade detector runs on a GATED_DOWNVOTE. The pure
// gate from src/limits decides eligibility; this file only fetches its inputs. votesVerify recomputes the caches
// two ways (non-negotiable 3).
import { downvoteAllowed } from '@/limits';
import type { LimitRules } from '@/rules';
import type { Outcome } from '@/votes';
import { contributionsAt, ForumRefused, lockKey, nodeInfo, toDate, toEpoch, type NodeRef, type Tx } from './db';

export type CastInput = { orgId: string; voterId: string; node: NodeRef; value: 1 | -1; castAt: number; note?: string };
export type CastResult = { outcome: Exclude<Outcome, 'UNKNOWN_NODE'>; signal: boolean };


export async function castVote(tx: Tx, input: CastInput, rules: LimitRules): Promise<CastResult> {
  const info = await nodeInfo(tx, input.node);
  if (!info || info.orgId !== input.orgId) throw new ForumRefused('UNKNOWN_NODE', `${input.node.kind} ${input.node.id}`);
  const at = toDate(input.castAt);
  const event = { orgId: input.orgId, voterId: input.voterId, nodeKind: input.node.kind, nodeId: input.node.id, value: input.value, castAt: at, note: input.note ?? '' };
  const record = async (outcome: CastResult['outcome']) => {
    await tx.voteEvent.create({ data: { ...event, outcome } });
  };
  if (info.authorId === input.voterId) {
    await record('SELF_VOTE'); // V-1
    return { outcome: 'SELF_VOTE', signal: false };
  }
  if (input.value === -1) {
    const voter = await tx.profile.findUniqueOrThrow({ where: { id: input.voterId }, select: { joinedAt: true } });
    const account = { created_at: toEpoch(voter.joinedAt), contributions: await contributionsAt(tx, input.voterId, at) };
    if (!downvoteAllowed(account, input.castAt, rules)) {
      await record('GATED_DOWNVOTE'); // V-2
      return { outcome: 'GATED_DOWNVOTE', signal: await brigadeCheck(tx, input, at, rules) };
    }
  }
  await lockKey(tx, `vote:${input.node.kind}:${input.node.id}`); // counts and the current row move together
  const key = { voterId_nodeKind_nodeId: { voterId: input.voterId, nodeKind: input.node.kind, nodeId: input.node.id } };
  const current = await tx.vote.findUnique({ where: key, select: { id: true, value: true } });
  let outcome: CastResult['outcome'];
  let dUps = 0;
  let dDowns = 0;
  if (current && current.value === input.value) {
    await tx.vote.delete({ where: { id: current.id } }); // V-3
    outcome = 'TOGGLED_OFF';
    if (input.value === 1) dUps = -1;
    else dDowns = -1;
  } else if (current) {
    await tx.vote.update({ where: { id: current.id }, data: { value: input.value, castAt: at } }); // V-4
    outcome = 'SWITCHED';
    dUps = input.value === 1 ? 1 : -1;
    dDowns = -dUps;
  } else {
    await tx.vote.create({ data: { orgId: input.orgId, voterId: input.voterId, nodeKind: input.node.kind, nodeId: input.node.id, value: input.value, castAt: at } });
    outcome = 'APPLIED';
    if (input.value === 1) dUps = 1;
    else dDowns = 1;
  }
  const data = { ups: { increment: dUps }, downs: { increment: dDowns } };
  if (input.node.kind === 'POST') await tx.post.update({ where: { id: input.node.id }, data });
  else await tx.comment.update({ where: { id: input.node.id }, data });
  await record(outcome);
  return { outcome, signal: false };
}

/** D-31: on a gated downvote, ≥ rules.signals.brigade.min_voters gated downvoters on this node inside the window → one signal per window (constants in rules/limits.json, 4.1.3). */
async function brigadeCheck(tx: Tx, input: CastInput, at: Date, rules: LimitRules): Promise<boolean> {
  const since = toDate(input.castAt - rules.signals.brigade.window_seconds);
  const gated = await tx.voteEvent.findMany({
    where: { nodeKind: input.node.kind, nodeId: input.node.id, outcome: 'GATED_DOWNVOTE', castAt: { gt: since, lte: at } },
    select: { voterId: true, castAt: true },
    orderBy: { castAt: 'asc' },
  });
  const voters = new Set(gated.map((g) => g.voterId));
  if (voters.size < rules.signals.brigade.min_voters) return false;
  const windowStart = gated[0]!.castAt;
  const existing = await tx.brigadeSignal.findFirst({ where: { nodeKind: input.node.kind, nodeId: input.node.id, windowStart: { gt: since } } });
  if (existing) {
    await tx.brigadeSignal.update({ where: { id: existing.id }, data: { voterCount: voters.size } });
    return false;
  }
  await tx.brigadeSignal.create({ data: { orgId: input.orgId, nodeKind: input.node.kind, nodeId: input.node.id, windowStart, voterCount: voters.size } });
  return true;
}

export type VerifyRow = { nodeKind: 'POST' | 'COMMENT'; publicId: string; cached: [number, number]; fromVotes: [number, number]; fromEvents: [number, number] };

/** Recomputes every node's counts from Vote rows and from the event log; returns the rows that disagree with the cache. */
export async function votesVerify(tx: Tx, orgId: string): Promise<{ nodes: number; mismatches: VerifyRow[] }> {
  const posts = await tx.post.findMany({ where: { orgId }, select: { id: true, publicId: true, authorId: true, ups: true, downs: true } });
  const comments = await tx.comment.findMany({ where: { orgId }, select: { id: true, publicId: true, authorId: true, ups: true, downs: true } });
  const votes = await tx.vote.groupBy({ by: ['nodeKind', 'nodeId', 'value'], where: { orgId }, _count: { _all: true } });
  const fromVotes = new Map<string, [number, number]>();
  for (const v of votes) {
    const k = `${v.nodeKind}:${v.nodeId}`;
    const c = fromVotes.get(k) ?? [0, 0];
    if (v.value === 1) c[0] += v._count._all;
    else c[1] += v._count._all;
    fromVotes.set(k, c);
  }
  // replay the log: author +1, then APPLIED/SWITCHED/TOGGLED_OFF in (castAt, id) order
  const events = await tx.voteEvent.findMany({ where: { orgId, outcome: { in: ['APPLIED', 'SWITCHED', 'TOGGLED_OFF'] } }, select: { voterId: true, nodeKind: true, nodeId: true, value: true, castAt: true, id: true }, orderBy: [{ castAt: 'asc' }, { id: 'asc' }] });
  const cur = new Map<string, number>();
  for (const p of posts) cur.set(`${p.authorId}|POST:${p.id}`, 1);
  for (const c of comments) cur.set(`${c.authorId}|COMMENT:${c.id}`, 1);
  for (const e of events) {
    const k = `${e.voterId}|${e.nodeKind}:${e.nodeId}`;
    cur.set(k, (cur.get(k) ?? 0) === e.value ? 0 : e.value);
  }
  const fromEvents = new Map<string, [number, number]>();
  for (const [k, v] of cur) {
    if (!v) continue;
    const node = k.slice(k.indexOf('|') + 1);
    const c = fromEvents.get(node) ?? [0, 0];
    if (v === 1) c[0]++;
    else c[1]++;
    fromEvents.set(node, c);
  }
  const mismatches: VerifyRow[] = [];
  const check = (kind: 'POST' | 'COMMENT', id: string, publicId: string, ups: number, downs: number) => {
    const k = `${kind}:${id}`;
    const a = fromVotes.get(k) ?? [0, 0];
    const b = fromEvents.get(k) ?? [0, 0];
    if (a[0] !== ups || a[1] !== downs || b[0] !== ups || b[1] !== downs) mismatches.push({ nodeKind: kind, publicId, cached: [ups, downs], fromVotes: a, fromEvents: b });
  };
  for (const p of posts) check('POST', p.id, p.publicId, p.ups, p.downs);
  for (const c of comments) check('COMMENT', c.id, c.publicId, c.ups, c.downs);
  return { nodes: posts.length + comments.length, mismatches };
}

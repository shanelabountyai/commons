// The vote path (task 2.5): V-1..V-4 applied live against the current Vote row, counts updated, a VoteEvent written
// with the outcome, all in the caller's transaction; the D-31 brigade detector runs on a GATED_DOWNVOTE. The pure
// gate from src/limits decides eligibility; this file only fetches its inputs. votesVerify recomputes the caches
// two ways (non-negotiable 3).
import { downvoteAllowed } from '@/limits';
import { qualifies, windowAt, type SignalKind } from '@/votes/signals';
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
      return { outcome: 'GATED_DOWNVOTE', signal: await signalCheck(tx, 'BRIGADE', input, at, rules) };
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
  // 5.2 (D-75): an applied upvote may complete a RING, an applied downvote an AGED_BRIGADE; signals never change counts
  let signal = false;
  if (outcome === 'APPLIED') signal = await signalCheck(tx, input.value === 1 ? 'RING' : 'AGED_BRIGADE', input, at, rules);
  return { outcome, signal };
}

/** D-31 and 5.2: one window rule for every signal kind (src/votes/signals.ts). Checked when a qualifying event is
 * cast; ≥ min_voters distinct qualifying voters on this node in the window → one signal per window, a later event
 * in the same window updates its count. Returns true when a new signal row opens. */
async function signalCheck(tx: Tx, kind: SignalKind, input: CastInput, at: Date, rules: LimitRules): Promise<boolean> {
  const accountAt = async (voterId: string, joinedAt: Date, castAt: Date) => ({ created_at: toEpoch(joinedAt), contributions: await contributionsAt(tx, voterId, castAt) });
  const me = await tx.profile.findUniqueOrThrow({ where: { id: input.voterId }, select: { joinedAt: true } });
  const outcome = kind === 'BRIGADE' ? 'GATED_DOWNVOTE' : 'APPLIED';
  if (!qualifies(kind, outcome, input.value, await accountAt(input.voterId, me.joinedAt, at), input.castAt, rules)) return false;
  const window = kind === 'BRIGADE' ? rules.signals.brigade : kind === 'RING' ? rules.signals.ring : rules.signals.aged_brigade;
  const since = toDate(input.castAt - window.window_seconds);
  const events = await tx.voteEvent.findMany({
    where: { nodeKind: input.node.kind, nodeId: input.node.id, outcome, ...(kind === 'BRIGADE' ? {} : { value: input.value }), castAt: { gt: since, lte: at } },
    select: { voterId: true, castAt: true, value: true, voter: { select: { joinedAt: true } } },
    orderBy: { castAt: 'asc' },
  });
  const qualifying: { voter: string; at: number }[] = [];
  for (const e of events) {
    if (kind === 'BRIGADE' || qualifies(kind, outcome, e.value as 1 | -1, await accountAt(e.voterId, e.voter.joinedAt, e.castAt), toEpoch(e.castAt), rules)) qualifying.push({ voter: e.voterId, at: toEpoch(e.castAt) });
  }
  const w = windowAt(kind, qualifying, input.castAt, rules);
  if (!w) return false;
  const existing = await tx.brigadeSignal.findFirst({ where: { kind, nodeKind: input.node.kind, nodeId: input.node.id, windowStart: { gt: since } } });
  if (existing) {
    await tx.brigadeSignal.update({ where: { id: existing.id }, data: { voterCount: w.voters } });
    return false;
  }
  await tx.brigadeSignal.create({ data: { orgId: input.orgId, kind, nodeKind: input.node.kind, nodeId: input.node.id, windowStart: toDate(w.windowStart), voterCount: w.voters } });
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

// engine:eval:db (task 2.9): Phase 1's evaluation from the database. Empties the forum tables of the test database,
// loads the fixture through the real writers (tree writer, vote path), recomputes ranks at NOW, then diffs what is
// STORED against the same 12 expected files: orderings from RankSnapshot, counts from the caches, outcomes from
// VoteEvent, paths and renders from the stored Comment rows. Also: votes:verify clean, exactly one BrigadeSignal
// (D-31), commentCount = comments per post. Exit 1 naming the first difference. Runs against .env.test's database.
import { readFileSync } from 'node:fs';
import { db } from '@/core/db';
import type { CsvRow } from '@/fixtures/csv';
import { expectedRows, loadFixtures, NOW } from '@/fixtures/load';
import { toEpoch } from '@/forum/db';
import { loadForum } from '@/forum/load';
import { recomputeRanks } from '@/forum/rank';
import { votesVerify } from '@/forum/votes';
import { replay } from '@/limits';
import { parseLimitRules, parseRankingRules } from '@/rules';
import { assignPaths, pageCount, permalink, renderThread, type TreeNode } from '@/tree';

const ranking = parseRankingRules(JSON.parse(readFileSync('rules/ranking.json', 'utf8')));
const limits = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const fx = loadFixtures();
const SLUG = 'homelab-eval';

// fresh org
await db.$executeRawUnsafe(`TRUNCATE "RankSnapshot", "EditHistory", "BrigadeSignal", "VoteEvent", "Vote", "Comment", "Post", "Board", "Profile" CASCADE`);
await db.org.deleteMany({ where: { slug: SLUG } });
const org = await db.org.create({ data: { slug: SLUG, name: SLUG } });
const t0 = Date.now();
const report = await db.$transaction((tx) => loadForum(tx, org.id, fx, limits), { timeout: 900_000, maxWait: 10_000 });
const loadSeconds = (Date.now() - t0) / 1000;
await db.$transaction((tx) => recomputeRanks(tx, org.id, NOW, ranking), { timeout: 120_000 });

type Row = Record<string, string | number>;
let failed = false;
const results: string[] = [];
function compare(file: string, actual: Row[], tolerance?: { field: string; eps: number }) {
  const exp: CsvRow[] = expectedRows(file);
  let matched = 0;
  let first: string | undefined;
  for (let i = 0; i < Math.max(exp.length, actual.length); i++) {
    const e = exp[i];
    const a = actual[i];
    if (!e || !a) {
      first ??= `row ${i + 2}: ${e ? 'missing in db' : 'extra in db'}`;
      continue;
    }
    let ok = true;
    for (const f of Object.keys(e)) {
      const ev = e[f]!;
      const av = String(a[f] ?? '');
      const close = tolerance && f === tolerance.field ? Math.abs(Number(ev) - Number(av)) <= tolerance.eps : ev === av;
      if (!close) {
        ok = false;
        first ??= `row ${i + 2} ${f}: expected ${ev}, actual ${av}`;
        break;
      }
    }
    if (ok) matched++;
  }
  const ok = matched === exp.length && !first;
  failed ||= !ok;
  results.push(`${ok ? 'ok  ' : 'DIFF'} ${file.padEnd(36)} ${matched}/${exp.length}${first ? '  first: ' + first : ''}`);
}

// stored rows
const posts = await db.post.findMany({ where: { orgId: org.id }, select: { id: true, publicId: true, createdAt: true, status: true, ups: true, downs: true, commentCount: true } });
const comments = await db.comment.findMany({ where: { orgId: org.id }, select: { id: true, publicId: true, postId: true, parentId: true, path: true, depth: true, createdAt: true, status: true, ups: true, downs: true } });
const snaps = await db.rankSnapshot.findMany({ where: { orgId: org.id } });
const snapOf = new Map(snaps.map((s) => [`${s.nodeKind}:${s.nodeId}`, s]));
const postPublic = new Map(posts.map((p) => [p.id, p.publicId]));
const commentPublic = new Map(comments.map((c) => [c.id, c.publicId]));
const tie = (a: { createdAt: Date; publicId: string }, b: { createdAt: Date; publicId: string }) => b.createdAt.getTime() - a.createdAt.getTime() || (a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0);

// orderings from RankSnapshot
const visible = posts.filter((p) => p.status === 'visible').map((p) => ({ ...p, snap: snapOf.get(`POST:${p.id}`)! }));
compare('expected_post_order_hot.csv', [...visible].sort((a, b) => b.snap.hot - a.snap.hot || tie(a, b)).map((p, i) => ({ rank: i + 1, post_id: p.publicId, score: p.snap.hot.toFixed(7) })), { field: 'score', eps: 1e-7 });
for (const [w, secs] of [['day', 86_400], ['week', 604_800], ['all', null]] as const) {
  const inw = visible.filter((p) => toEpoch(p.createdAt) <= NOW && (secs === null || toEpoch(p.createdAt) >= NOW - secs));
  compare(`expected_post_order_top_${w}.csv`, inw.sort((a, b) => b.snap.net - a.snap.net || tie(a, b)).map((p, i) => ({ rank: i + 1, post_id: p.publicId, score: p.snap.net })));
}
compare('expected_post_order_new.csv', [...visible].sort(tie).map((p, i) => ({ rank: i + 1, post_id: p.publicId, score: toEpoch(p.createdAt) })));
// comment best per parent group, same threads as the reference
const byPost = new Map<string, typeof comments>();
for (const c of comments) byPost.set(postPublic.get(c.postId)!, [...(byPost.get(postPublic.get(c.postId)!) ?? []), c]);
const generic = [...byPost.entries()].filter(([pid, cs]) => pid.startsWith('P-0') && cs.length >= 20).sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([pid]) => pid);
const bestRows: Row[] = [];
for (const pid of ['P-THICK', 'P-CHAIN', 'P-GW', ...generic]) {
  const groups = new Map<string, typeof comments>();
  for (const c of byPost.get(pid)!) {
    const parent = c.parentId ? commentPublic.get(c.parentId)! : '';
    groups.set(parent, [...(groups.get(parent) ?? []), c]);
  }
  for (const parent of [...groups.keys()].sort()) {
    groups
      .get(parent)!
      .map((c) => ({ ...c, snap: snapOf.get(`COMMENT:${c.id}`)! }))
      .sort((a, b) => b.snap.best - a.snap.best || tie(a, b))
      .forEach((c, i) => bestRows.push({ post_id: pid, parent_id: parent, rank: i + 1, comment_id: c.publicId, score: c.snap.best.toFixed(7) }));
  }
}
compare('expected_comment_order_best.csv', bestRows, { field: 'score', eps: 5e-5 });
// counts from the caches
compare('expected_counts.csv', [...posts.map((p) => ({ node_id: p.publicId, ups: p.ups, downs: p.downs })), ...comments.map((c) => ({ node_id: c.publicId, ups: c.ups, downs: c.downs }))].sort((a, b) => (a.node_id < b.node_id ? -1 : 1)));
// outcomes from VoteEvent, in (castAt, insertion) order = fixture (cast_at, row) order
const events = await db.voteEvent.findMany({ where: { orgId: org.id }, select: { nodeKind: true, nodeId: true, outcome: true, voterId: true, castAt: true }, orderBy: [{ castAt: 'asc' }] });
const profiles = await db.profile.findMany({ where: { orgId: org.id }, select: { id: true, handle: true } });
const handleToFixtureId = new Map(fx.users.map((u) => [u.handle, u.id]));
const profileFixtureId = new Map(profiles.map((p) => [p.id, handleToFixtureId.get(p.handle)!]));
const sortedFixture = [...fx.votes].sort((a, b) => a.cast_at - b.cast_at || a.row - b.row);
// events with equal castAt come back in insertion order only by accident; pair them to the fixture rows by (castAt, voter, node)
const evKey = (e: (typeof events)[number]) => `${toEpoch(e.castAt)}|${profileFixtureId.get(e.voterId)}|${e.nodeKind === 'POST' ? postPublic.get(e.nodeId) : commentPublic.get(e.nodeId)}`;
const evMap = new Map<string, string[]>();
for (const e of events) evMap.set(evKey(e), [...(evMap.get(evKey(e)) ?? []), e.outcome]);
const outcomeRows: Row[] = sortedFixture
  .map((v) => ({ row: v.row, voter: v.voter, node_id: v.node_id, outcome: evMap.get(`${v.cast_at}|${v.voter}|${v.node_id}`)?.shift() ?? '(none)' }))
  .sort((a, b) => a.row - b.row);
compare('expected_vote_outcomes.csv', outcomeRows);
// trees from stored rows: paths must equal assignPaths, and the render must match
const treeRows: Row[] = [];
const pageRows: Row[] = [];
let pathMismatch = 0;
type DbNode = TreeNode & { dbId: string };
const bestOf = (n: TreeNode) => snapOf.get(`COMMENT:${(n as DbNode).dbId}`)!.best;
const bestOrder = <T extends TreeNode>(s: readonly T[]) => [...s].sort((a, b) => bestOf(b) - bestOf(a) || b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const asNodes = (pid: string) => byPost.get(pid)!.map((c) => ({ id: c.publicId, dbId: c.id, post_id: pid, parent_id: c.parentId ? commentPublic.get(c.parentId)! : '', created_at: toEpoch(c.createdAt), status: c.status as TreeNode['status'], storedPath: c.path, storedDepth: c.depth }));
for (const pid of [...byPost.keys()]) {
  const nodes = asNodes(pid);
  const paths = assignPaths(nodes);
  for (const n of nodes) if (paths.get(n.id) !== n.storedPath || n.storedDepth !== n.storedPath.length / 6 - 1) pathMismatch++;
}
for (const [pid, pages] of [['P-CHAIN', [1]], ['P-THICK', [1, 2]]] as const) {
  const nodes = asNodes(pid);
  let topShown = 0;
  for (const page of pages) {
    const r = renderThread(nodes, bestOrder, page, limits.max_depth_rendered);
    topShown = r.topLevelShown;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const row of r.rows) treeRows.push({ post_id: pid, page, id: row.id, depth: row.depth, path: byId.get(row.id)!.storedPath, rendered_as: row.rendered_as, continue_thread: row.continue_thread ? 1 : 0 });
  }
  pageRows.push({ post_id: pid, comments_total: posts.find((p) => p.publicId === pid)!.commentCount, top_level_shown: topShown, pages: pageCount(topShown) });
}
compare('expected_tree.csv', treeRows);
compare('expected_pages.csv', pageRows);
compare(
  'expected_permalink.csv',
  ['C-CHAIN-7', 'C-THICK-DEEP-11', 'C-DEL-LEAF'].map((nid) => {
    const pid = nid.startsWith('C-THICK') ? 'P-THICK' : 'P-CHAIN';
    const nodes = asNodes(pid);
    const r = permalink(nodes, assignPaths(nodes), bestOrder, nid, limits.max_depth_rendered);
    return { node_id: nid, ancestors: r.ancestors.join('|'), rows: r.rows.length, first_rendered_as: r.rows[0]?.rendered_as ?? 'omitted' };
  }),
);
// limits scripts are pure; the db adds nothing, but the file is part of the 12
const accounts = new Map(fx.users.map((u) => [u.id, u.created_at]));
const authored = new Map<string, number[]>();
for (const r of [...fx.posts, ...fx.comments]) if (r.status !== 'removed') authored.set(r.author, [...(authored.get(r.author) ?? []), r.created_at].sort((a, b) => a - b));
const contributionsAt = (u: string, t: number) => (authored.get(u) ?? []).filter((x) => x < t).length;
const tt = NOW - 3600;
const scripts = [
  ['spam-young-comments', 'comment', 'u193', Array.from({ length: 60 }, (_, i) => tt + i)],
  ['spam-young-posts', 'post', 'u193', Array.from({ length: 20 }, (_, i) => tt + 60 * i)],
  ['spam-young-votes', 'vote', 'u193', Array.from({ length: 100 }, (_, i) => tt + i)],
  ['normal-u050-posts', 'post', 'u050', fx.posts.filter((p) => p.author === 'u050').map((p) => p.created_at).sort((a, b) => a - b)],
  ['normal-u050-comments', 'comment', 'u050', fx.comments.filter((c) => c.author === 'u050').map((c) => c.created_at).sort((a, b) => a - b)],
  ['normal-u050-votes', 'vote', 'u050', fx.votes.filter((v) => v.voter === 'u050').map((v) => v.cast_at).sort((a, b) => a - b)],
] as const;
compare(
  'expected_limits.csv',
  scripts.map(([script, action, user, attempts]) => {
    const r = replay(attempts, action, { created_at: accounts.get(user)!, contributionsAt: (t) => contributionsAt(user, t) }, limits);
    return { script, action, attempts: attempts.length, allowed: r.allowed, refused: r.refused, first_retry_after: r.firstRetryAfter ?? '' };
  }),
);

// database-only checks
const verify = await votesVerify(db, org.id);
const signals = await db.brigadeSignal.findMany({ where: { orgId: org.id } });
const brigadePost = posts.find((p) => p.publicId === 'P-BRIGADE')!;
const countMismatch = posts.filter((p) => p.commentCount !== (byPost.get(p.publicId)?.length ?? 0)).length;

console.log(`engine:eval:db — org ${SLUG}; loaded ${report.reduce((n, r) => n + r.inserted, 0)} rows in ${loadSeconds.toFixed(1)} s through the writers; ranked at ${NOW}`);
for (const r of results) console.log(r);
console.log(`${pathMismatch === 0 ? 'ok  ' : 'DIFF'} stored paths = assignPaths for ${comments.length} comments (${pathMismatch} mismatches)`);
console.log(`${verify.mismatches.length === 0 ? 'ok  ' : 'DIFF'} votes:verify ${verify.nodes} nodes, ${verify.mismatches.length} mismatches`);
console.log(`${signals.length === 1 && signals[0]!.nodeId === brigadePost.id && signals[0]!.voterCount === 7 ? 'ok  ' : 'DIFF'} BrigadeSignal rows: ${signals.length} (${signals.map((s) => `${s.nodeKind} ${s.nodeId === brigadePost.id ? 'P-BRIGADE' : s.nodeId} voters ${s.voterCount}`).join('; ')})`);
console.log(`${countMismatch === 0 ? 'ok  ' : 'DIFF'} commentCount = comments per post (${countMismatch} mismatches)`);
failed ||= pathMismatch > 0 || verify.mismatches.length > 0 || signals.length !== 1 || countMismatch > 0;
await db.$disconnect();
if (failed) {
  console.error('engine:eval:db: FAIL');
  process.exit(1);
}
console.log('engine:eval:db: OK — stored rows reproduce every expected file');

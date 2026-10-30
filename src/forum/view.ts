// Read models for the pages (Phase 4, task 4.3). Queries only; every write goes through the action door or the
// moderation module. Ordering comes from the pure engines; scores come from RankSnapshot when a row exists (R-5,
// with rankedAt shown as freshness) and are computed live for nodes newer than the last run.
import type { OrgCtx } from '@/core/authz/guards';
import { db } from '@/core/db';
import { hot, net, orderPosts, orderSiblings, wilsonLower, type Counts, type PostSort } from '@/ranking';
import type { RankingRules } from '@/rules';
import { assignPaths, pageCount, permalink, renderThread, type RenderedRow, type TreeNode } from '@/tree';
import { toEpoch } from './db';
import type { ModeratorCtx } from './moderation';

export type ProfileCtx = ModeratorCtx & { handle: string; modState: string; bannedUntil: Date | null };

/** The signed-in member's forum identity; created on first visit from the email's local part (unique per org). */
export async function ensureProfile(ctx: OrgCtx): Promise<ProfileCtx> {
  const have = await db.profile.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } } });
  const p =
    have ??
    (await (async () => {
      const email = (await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { email: true } })).email;
      const base = email.split('@')[0]!.replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'member';
      for (let n = 0; ; n++) {
        const handle = n === 0 ? base : `${base}${n}`;
        const clash = await db.profile.findUnique({ where: { orgId_handle: { orgId: ctx.orgId, handle } } });
        if (!clash) return db.profile.create({ data: { orgId: ctx.orgId, userId: ctx.userId, handle } });
      }
    })());
  return { orgId: ctx.orgId, profileId: p.id, role: ctx.role, isModerator: p.isModerator, handle: p.handle, modState: p.modState, bannedUntil: p.bannedUntil };
}

export async function boards(orgId: string) {
  const bs = await db.board.findMany({ where: { orgId }, orderBy: { slug: 'asc' } });
  const counts = await db.post.groupBy({ by: ['boardId'], where: { orgId, status: 'visible' }, _count: { _all: true } });
  const n = new Map(counts.map((c) => [c.boardId, c._count._all]));
  return bs.map((b) => ({ ...b, posts: n.get(b.id) ?? 0 }));
}

type Scored = { hot: number; best: number; net: number; fromSnapshot: boolean };
async function scores(orgId: string, kind: 'POST' | 'COMMENT', nodes: { id: string; created_at: number; ups: number; downs: number }[], now: number, rules: RankingRules): Promise<{ by: Map<string, Scored>; rankedAt: Date | null }> {
  const snaps = await db.rankSnapshot.findMany({ where: { orgId, nodeKind: kind, nodeId: { in: nodes.map((n) => n.id) } } });
  const sm = new Map(snaps.map((s) => [s.nodeId, s]));
  const by = new Map<string, Scored>();
  for (const n of nodes) {
    const s = sm.get(n.id);
    const c: Counts = { ups: n.ups, downs: n.downs };
    by.set(n.id, s ? { hot: s.hot, best: s.best, net: s.net, fromSnapshot: true } : { hot: hot(c, n.created_at, rules), best: wilsonLower(c, rules.best.z), net: net(c), fromSnapshot: false });
  }
  const rankedAt = snaps.length ? snaps.reduce((a, s) => (s.rankedAt > a ? s.rankedAt : a), snaps[0]!.rankedAt) : null;
  return { by, rankedAt };
}

export const POST_SORTS: PostSort[] = ['hot', 'top_day', 'top_week', 'top_all', 'new'];
export const SORT_LABEL: Record<PostSort, string> = { hot: 'Hot', top_day: 'Top today', top_week: 'Top this week', top_all: 'Top all time', new: 'New' };

export async function boardPosts(orgId: string, boardSlug: string, sort: PostSort, now: number, rules: RankingRules) {
  const board = await db.board.findUnique({ where: { orgId_slug: { orgId, slug: boardSlug } } });
  if (!board) return null;
  const rows = await db.post.findMany({ where: { orgId, boardId: board.id, status: 'visible' }, include: { author: { select: { handle: true } } } });
  const nodes = rows.map((r) => ({ ...r, created_at: toEpoch(r.createdAt) }));
  const { by, rankedAt } = await scores(orgId, 'POST', nodes, now, rules);
  const counts = (id: string) => ({ ups: 0, downs: 0, ...nodes.find((n) => n.id === id) });
  // orderPosts scores from counts; to honour the snapshot, sort by the stored score with the same tiebreak
  const tie = (a: (typeof nodes)[number], b: (typeof nodes)[number]) => b.created_at - a.created_at || (a.publicId < b.publicId ? -1 : 1);
  let ordered: typeof nodes;
  if (sort === 'hot') ordered = [...nodes].sort((a, b) => by.get(b.id)!.hot - by.get(a.id)!.hot || tie(a, b));
  else if (sort === 'new') ordered = [...nodes].sort(tie);
  else ordered = orderPosts(nodes, counts, sort, now, rules).sort((a, b) => by.get(b.id)!.net - by.get(a.id)!.net || tie(a, b));
  const pinned = ordered.filter((p) => p.pinnedAt);
  const rest = ordered.filter((p) => !p.pinnedAt);
  return { board, posts: [...pinned, ...rest].map((p) => ({ ...p, score: by.get(p.id)! })), rankedAt };
}

export type ThreadNode = TreeNode & { dbId: string; author: string; body: string; ups: number; downs: number; editedAt: Date | null; publicId: string };

export async function thread(orgId: string, publicId: string, sort: 'best' | 'top' | 'new', page: number, maxDepth: number, now: number, rules: RankingRules) {
  const post = await db.post.findUnique({ where: { orgId_publicId: { orgId, publicId } }, include: { author: { select: { handle: true, id: true } }, board: true, uploads: true } });
  if (!post) return null;
  const comments = await db.comment.findMany({ where: { postId: post.id }, include: { author: { select: { handle: true } } } });
  const nodes: ThreadNode[] = comments.map((c) => ({ id: c.publicId, dbId: c.id, post_id: post.publicId, parent_id: c.parentId ? comments.find((x) => x.id === c.parentId)!.publicId : '', created_at: toEpoch(c.createdAt), status: c.status, author: c.author.handle, body: c.body, ups: c.ups, downs: c.downs, editedAt: c.editedAt, publicId: c.publicId }));
  const { by, rankedAt } = await scores(orgId, 'COMMENT', nodes.map((n) => ({ id: n.dbId, created_at: n.created_at, ups: n.ups, downs: n.downs })), now, rules);
  const byPublic = new Map(nodes.map((n) => [n.id, n.dbId]));
  const order = <T extends TreeNode>(s: readonly T[]) => {
    const counts = (id: string) => {
      const n = nodes.find((x) => x.id === id)!;
      return { ups: n.ups, downs: n.downs };
    };
    const bestOf = (n: TreeNode) => by.get(byPublic.get(n.id)!)!.best;
    if (sort === 'best') return [...s].sort((a, b) => bestOf(b) - bestOf(a) || b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
    return orderSiblings(s, counts, sort, rules);
  };
  const paths = assignPaths(nodes);
  const r = renderThread(nodes, order, page, maxDepth);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const postScore = (await scores(orgId, 'POST', [{ id: post.id, created_at: toEpoch(post.createdAt), ups: post.ups, downs: post.downs }], now, rules)).by.get(post.id)!;
  return { post, postScore, rows: r.rows.map((row) => ({ ...row, node: byId.get(row.id)!, path: paths.get(row.id)! })), topLevelShown: r.topLevelShown, pages: pageCount(r.topLevelShown), rankedAt, nodes, paths, order };
}

export async function permalinkView(orgId: string, postPublicId: string, commentPublicId: string, maxDepth: number, now: number, rules: RankingRules) {
  const t = await thread(orgId, postPublicId, 'best', 1, maxDepth, now, rules);
  if (!t || !t.paths.has(commentPublicId)) return null;
  const r = permalink(t.nodes, t.paths, t.order, commentPublicId, maxDepth);
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  return { post: t.post, ancestors: r.ancestors.map((id) => byId.get(id)!), rows: r.rows.map((row: RenderedRow) => ({ ...row, node: byId.get(row.id)! })) };
}

export async function profilePage(orgId: string, handle: string) {
  const p = await db.profile.findUnique({ where: { orgId_handle: { orgId, handle } } });
  if (!p) return null;
  const [posts, comments, postCount, commentCount] = await Promise.all([
    db.post.findMany({ where: { authorId: p.id, status: 'visible' }, orderBy: { createdAt: 'desc' }, take: 20, select: { publicId: true, title: true, createdAt: true, ups: true, downs: true } }),
    db.comment.findMany({ where: { authorId: p.id, status: 'visible' }, orderBy: { createdAt: 'desc' }, take: 20, include: { post: { select: { publicId: true, title: true } } } }),
    db.post.count({ where: { authorId: p.id, status: { not: 'removed' } } }),
    db.comment.count({ where: { authorId: p.id, status: { not: 'removed' } } }),
  ]);
  return { profile: p, posts, comments, contributions: postCount + commentCount };
}

/** Task 4.6: plain full-text over title + body with Postgres `simple` config; removed content excluded. No index at
 *  fixture scale (expression indexes are outside what the Prisma diff can carry); revisit past ~10⁵ rows. */
export async function search(orgId: string, q: string, limit = 50) {
  const query = q.trim().slice(0, 200);
  if (!query) return { posts: [], comments: [] };
  const posts = await db.$queryRaw<{ publicId: string; title: string; rank: number }[]>`
    SELECT "publicId", "title", ts_rank(to_tsvector('simple', "title" || ' ' || "body"), plainto_tsquery('simple', ${query})) AS rank
    FROM "Post" WHERE "orgId" = ${orgId}::uuid AND "status" = 'visible' AND to_tsvector('simple', "title" || ' ' || "body") @@ plainto_tsquery('simple', ${query})
    ORDER BY rank DESC, "createdAt" DESC LIMIT ${limit}`;
  const comments = await db.$queryRaw<{ publicId: string; postPublicId: string; body: string; rank: number }[]>`
    SELECT c."publicId", p."publicId" AS "postPublicId", c."body", ts_rank(to_tsvector('simple', c."body"), plainto_tsquery('simple', ${query})) AS rank
    FROM "Comment" c JOIN "Post" p ON p."id" = c."postId"
    WHERE c."orgId" = ${orgId}::uuid AND c."status" = 'visible' AND to_tsvector('simple', c."body") @@ plainto_tsquery('simple', ${query})
    ORDER BY rank DESC, c."createdAt" DESC LIMIT ${limit}`;
  return { posts, comments };
}

export const nowEpoch = (): number => Math.floor(Date.now() / 1000);

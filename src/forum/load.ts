// commons:load (task 2.4): the fixture forum into one org, write-once. Users become template Users on example.com
// (D-1) with a member Membership and a Profile; posts and comments go through the tree writer in (created_at, id)
// order so the stored ordinals equal src/tree's assignPaths; every vote event goes through the vote path in
// (cast_at, row) order. A second run on the same org inserts nothing; a different fixture set refuses.
import type { Fixtures } from '@/fixtures/load';
import type { LimitRules } from '@/rules';
import { ForumRefused, toDate, type Tx } from './db';
import { createComment, createPost } from './tree-write';
import { castVote } from './votes';

export type LoadReport = { table: string; wanted: number; existing: number; inserted: number };

export async function loadForum(tx: Tx, orgId: string, fx: Fixtures, rules: LimitRules): Promise<LoadReport[]> {
  const report: LoadReport[] = [];
  // write-once: an org with any post is already loaded
  const existingPosts = await tx.post.count({ where: { orgId } });
  if (existingPosts) {
    if (existingPosts !== fx.posts.length) throw new ForumRefused('WRITE_ONCE', `org has ${existingPosts} posts, fixture has ${fx.posts.length}`);
    return [{ table: 'Post', wanted: fx.posts.length, existing: existingPosts, inserted: 0 }];
  }
  // users → User + Membership + Profile
  const profileOf = new Map<string, string>();
  for (const u of fx.users) {
    const email = `${u.id}@example.com`;
    const user = (await tx.user.findUnique({ where: { email } })) ?? (await tx.user.create({ data: { email, name: u.handle } }));
    await tx.membership.upsert({ where: { orgId_userId: { orgId, userId: user.id } }, update: {}, create: { orgId, userId: user.id, role: 'member' } });
    const profile = await tx.profile.create({ data: { orgId, userId: user.id, handle: u.handle, joinedAt: toDate(u.created_at), bannedUntil: u.banned_until === null ? null : toDate(u.banned_until) } });
    profileOf.set(u.id, profile.id);
  }
  report.push({ table: 'Profile', wanted: fx.users.length, existing: 0, inserted: fx.users.length });
  const boards = new Map<string, string>();
  const boardSlugs = [...new Set(fx.posts.map((p) => p.board))].sort();
  for (const slug of boardSlugs) {
    const b = await tx.board.create({ data: { orgId, slug, title: slug } });
    boards.set(slug, b.id);
  }
  report.push({ table: 'Board', wanted: boardSlugs.length, existing: 0, inserted: boardSlugs.length });
  const postIds = new Map<string, string>();
  for (const p of [...fx.posts].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))) {
    const row = await createPost(tx, { orgId, boardId: boards.get(p.board)!, authorId: profileOf.get(p.author)!, publicId: p.id, title: `${p.id} title`, body: `${p.id} body`, createdAt: p.created_at });
    postIds.set(p.id, row.id);
  }
  report.push({ table: 'Post', wanted: fx.posts.length, existing: 0, inserted: fx.posts.length });
  const commentIds = new Map<string, string>();
  const byPost = new Map<string, typeof fx.comments>();
  for (const c of fx.comments) byPost.set(c.post_id, [...(byPost.get(c.post_id) ?? []), c]);
  let nComments = 0;
  for (const [pid, cs] of byPost) {
    // parents before children, siblings in creation order: sort by (created_at, id) is enough because a parent is always older
    for (const c of [...cs].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))) {
      const row = await createComment(tx, { orgId, postId: postIds.get(pid)!, parentId: c.parent_id ? commentIds.get(c.parent_id)! : null, authorId: profileOf.get(c.author)!, publicId: c.id, body: `${c.id} body`, createdAt: c.created_at });
      commentIds.set(c.id, row.id);
      nComments++;
    }
  }
  report.push({ table: 'Comment', wanted: fx.comments.length, existing: 0, inserted: nComments });
  // Statuses are applied after creation, as in life: a node is written visible and deleted or removed later (so a
  // reply under a later-removed parent loads; D-30 only refuses new replies). Phase 4's moderation path owns this.
  let nStatus = 0;
  for (const p of fx.posts) {
    if (p.status === 'visible') continue;
    await tx.post.update({ where: { id: postIds.get(p.id)! }, data: { status: p.status } });
    nStatus++;
  }
  for (const c of fx.comments) {
    if (c.status === 'visible') continue;
    await tx.comment.update({ where: { id: commentIds.get(c.id)! }, data: { status: c.status } });
    nStatus++;
  }
  report.push({ table: 'status', wanted: nStatus, existing: 0, inserted: nStatus });
  const nodeRef = (publicId: string) => (postIds.has(publicId) ? { kind: 'POST' as const, id: postIds.get(publicId)! } : { kind: 'COMMENT' as const, id: commentIds.get(publicId)! });
  let nEvents = 0;
  for (const v of [...fx.votes].sort((a, b) => a.cast_at - b.cast_at || a.row - b.row)) {
    await castVote(tx, { orgId, voterId: profileOf.get(v.voter)!, node: nodeRef(v.node_id), value: v.value, castAt: v.cast_at, note: v.note }, rules);
    nEvents++;
  }
  report.push({ table: 'VoteEvent', wanted: fx.votes.length, existing: 0, inserted: nEvents });
  return report;
}

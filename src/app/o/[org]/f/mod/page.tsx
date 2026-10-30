import { readFileSync } from 'node:fs';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { Markdown, Text, when } from '@/components/forum';
import { authorHistory, canModerate, queue } from '@/forum/moderation';
import { ensureProfile } from '@/forum/view';
import { parseLimitRules, parseModerationRules } from '@/rules';
import { moderateContent, reviewBrigade, reviewDuplicate } from '../actions';

const mod = parseModerationRules(JSON.parse(readFileSync('rules/moderation.json', 'utf8')));
const brigadeRule = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8'))).signals.brigade;

/** Task 4.4: open cases with content in context, reporter count and author history; brigade and duplicate signals;
 *  the append-only log. Moderators only ("not yours" ≡ not found for everyone else). */
export default async function ModQueue({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const me = await ensureProfile(ctx);
  if (!canModerate(me)) notFound();
  const items = await queue(db, ctx.orgId, mod.queue.page_size);
  // context for every node in the queue
  const postIds = items.filter((i) => i.node.kind === 'POST').map((i) => i.node.id);
  const commentIds = items.filter((i) => i.node.kind === 'COMMENT').map((i) => i.node.id);
  const [posts, comments] = await Promise.all([
    db.post.findMany({ where: { id: { in: postIds }, orgId: ctx.orgId }, include: { author: true } }),
    db.comment.findMany({ where: { id: { in: commentIds }, orgId: ctx.orgId }, include: { author: true, post: { select: { publicId: true, title: true } } } }),
  ]);
  const ctxOf = (node: { kind: 'POST' | 'COMMENT'; id: string }) => {
    if (node.kind === 'POST') {
      const p = posts.find((x) => x.id === node.id);
      return p ? { title: p.title, body: p.body, author: p.author, status: p.status, postPublicId: p.publicId, postId: p.id, commentId: undefined as string | undefined, link: `/o/${ctx.slug}/f/p/${p.publicId}` } : null;
    }
    const c = comments.find((x) => x.id === node.id);
    return c ? { title: `comment on ${c.post.title}`, body: c.body, author: c.author, status: c.status, postPublicId: c.post.publicId, postId: c.postId, commentId: c.id, link: `/o/${ctx.slug}/f/p/${c.post.publicId}/c/${c.publicId}` } : null;
  };
  const log = await db.moderationAction.findMany({ where: { orgId: ctx.orgId }, orderBy: { seq: 'desc' }, take: 50, include: { actor: { select: { handle: true } }, subject: { select: { handle: true } } } });

  return (
    <main>
      <h1>Moderation queue</h1>
      <p className="meta">
        {items.length} open item{items.length === 1 ? '' : 's'}: cases from reports, brigade signals (≥ {brigadeRule.min_voters} gated downvotes in {Math.round(brigadeRule.window_seconds / 60)} min), duplicate signals. Nothing here was acted on automatically.
      </p>
      {items.length === 0 && <p>The queue is empty.</p>}
      {await Promise.all(
        items.map(async (item) => {
          const c = ctxOf(item.node);
          if (!c) return null;
          const hist = await authorHistory(db, c.author.id);
          return (
            <section key={`${item.kind}-${item.id}`} aria-label={`${item.kind} on ${c.title}`} className="post">
              <h2>
                {item.kind === 'CASE' ? `Reported (${item.reports}): ${item.reasons.join(', ')}` : item.kind === 'BRIGADE' ? `Suspected brigade: ${item.voterCount} gated downvotes` : 'Suspected duplicate'} · <Link href={c.link}><Text value={c.title} /></Link>
              </h2>
              <p className="meta">
                by <Link href={`/o/${ctx.slug}/f/u/${c.author.handle}`}><Text value={c.author.handle} /></Link> ({c.author.modState}; {hist.reports} reports on their posts, {hist.actions} prior actions) · status {c.status} · opened {when(item.kind === 'CASE' ? item.openedAt : item.createdAt)}
              </p>
              <Markdown body={c.body} />
              {item.kind === 'CASE' && (
                <ActionForm action={moderateContent.bind(null, ctx.slug)}>
                  <input type="hidden" name="postId" value={c.postId} />
                  {c.commentId && <input type="hidden" name="commentId" value={c.commentId} />}
                  <label>
                    Reason <input name="reason" required maxLength={1000} aria-label={`Reason for ${c.title}`} />
                  </label>
                  <button type="submit" name="action" value="REMOVE">Remove</button> <button type="submit" name="action" value="CLEAR">Clear</button>
                </ActionForm>
              )}
              {item.kind === 'BRIGADE' && (
                <ActionForm action={reviewBrigade.bind(null, ctx.slug)}>
                  <input type="hidden" name="brigadeSignalId" value={item.id} />
                  <label>
                    Note <input name="reason" required maxLength={1000} aria-label={`Review note for brigade on ${c.title}`} />
                  </label>
                  <button type="submit">Mark reviewed</button>
                </ActionForm>
              )}
              {item.kind === 'DUPLICATE' && (
                <ActionForm action={reviewDuplicate.bind(null, ctx.slug)}>
                  <input type="hidden" name="duplicateSignalId" value={item.id} />
                  <label>
                    Note <input name="reason" required maxLength={1000} aria-label={`Review note for duplicate ${c.title}`} />
                  </label>
                  <button type="submit">Mark reviewed</button>
                </ActionForm>
              )}
            </section>
          );
        }),
      )}
      <h2>Moderation log</h2>
      <p className="meta">Append-only: the database refuses UPDATE and DELETE on these rows.</p>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Action</th>
            <th>Target</th>
            <th>From → to</th>
            <th>By</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {log.map((l) => (
            <tr key={l.id}>
              <td>{when(l.createdAt)}</td>
              <td>{l.kind}</td>
              <td>{l.subject ? <Text value={l.subject.handle} /> : `${l.nodeKind} ${l.nodeId?.slice(0, 8)}`}</td>
              <td>
                {l.fromState} → {l.toState}
              </td>
              <td>
                <Text value={l.actor.handle} />
              </td>
              <td>
                <Text value={l.reason} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

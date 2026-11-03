import { readFileSync } from 'node:fs';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ForumForm as ActionForm } from '@/components/forum-form';
import { ago, Badge, CommentHeading, Crumbs, Markdown, Pager, removedName, Text, Tree, when, whenText } from '@/components/forum';
import { canModerate, editHistoryForThread } from '@/forum/moderation';
import { downvoteGateNote, ensureProfile, myVotes, nowEpoch, thread, type ThreadNode } from '@/forum/view';
import { VoteControl } from '@/components/vote-control';
import { parseLimitRules, parseModerationRules, parseRankingRules } from '@/rules';
import type { RenderedRow } from '@/tree';
import { deleteOwn, edit, moderateContent, moderateThread, reply, report, vote } from '../../actions';

const ranking = parseRankingRules(JSON.parse(readFileSync('rules/ranking.json', 'utf8')));
const limits = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const mod = parseModerationRules(JSON.parse(readFileSync('rules/moderation.json', 'utf8')));
const COMMENT_SORTS = ['best', 'top', 'new'] as const;
type CommentSort = (typeof COMMENT_SORTS)[number];

type Row = RenderedRow & { node: ThreadNode; path: string };

/** 4.1.13 (WCAG 2.4.2): titled after the post; guard first, scoped lookup (FR-06, INV-03). Removed posts keep a neutral title. */
export async function generateMetadata({ params }: { params: Promise<{ org: string; post: string }> }) {
  const ctx = await requireOrg((await params).org);
  const p = await db.post.findUnique({ where: { orgId_publicId: { orgId: ctx.orgId, publicId: (await params).post } }, select: { title: true, status: true } });
  return { title: p ? `${p.status === 'visible' ? p.title : `[${p.status}]`} · Commons` : 'Commons' };
}

export default async function Thread({ params, searchParams }: { params: Promise<{ org: string; post: string }>; searchParams: Promise<{ sort?: string; page?: string; upload?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const me = await ensureProfile(ctx);
  const { post: publicId } = await params;
  const sp = await searchParams;
  const sort: CommentSort = (COMMENT_SORTS as readonly string[]).includes(sp.sort ?? '') ? (sp.sort as CommentSort) : 'best';
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const t = await thread(ctx.orgId, publicId, sort, page, limits.max_depth_rendered, nowEpoch(), ranking);
  if (!t) notFound();
  const { post } = t;
  const isMod = canModerate(me);
  // 5.1: the viewer's votes on everything rendered, and whether their ▼ would count now
  const mine = await myVotes(ctx.orgId, me.profileId, [{ kind: 'POST', id: post.id }, ...t.rows.map((r) => ({ kind: 'COMMENT' as const, id: r.node.dbId }))]);
  const gateNote = await downvoteGateNote(me.profileId, nowEpoch(), limits);
  const edits: Awaited<ReturnType<typeof editHistoryForThread>> = isMod ? await editHistoryForThread(db, ctx.orgId, post.id, t.nodes.map((n) => n.dbId)) : new Map();
  const here = `/o/${ctx.slug}/f/p/${publicId}`;
  const bound = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);
  const myCommentIds = new Set((await db.comment.findMany({ where: { postId: post.id, authorId: me.profileId }, select: { publicId: true } })).map((c) => c.publicId));
  const reasons = mod.report_reasons;

  function CommentView({ r }: { r: Row }) {
    const n = r.node;
    const removed = r.rendered_as !== 'body';
    const who = removed ? removedName(r.rendered_as).toLowerCase() : `comment by ${n.author}`; // M5: names that tell links apart
    return (
      <article>
        <CommentHeading status={r.rendered_as} author={n.author} href={`/o/${ctx.slug}/f/u/${n.author}`} />
        {!removed && <VoteControl action={bound(vote)} postId={post.id} commentId={n.dbId} label={`comment by ${n.author}`} mine={mine.get(n.dbId) ?? 0} isAuthor={n.author === me.handle} gateNote={gateNote} />}
        <div className="meta">
          {n.ups - n.downs} points · {ago(new Date(n.created_at * 1000))}
          {n.editedAt && <> · <Badge>Edited</Badge></>} · <Link href={`${here}/c/${n.publicId}`} aria-label={`Permalink to ${who}, ${whenText(new Date(n.created_at * 1000))}`}>permalink</Link>
        </div>
        {!removed && <Markdown body={n.body} />}
        {r.continue_thread && (
          <p>
            <Link href={`${here}/c/${n.publicId}`}>Continue the thread under {removed ? `the ${r.rendered_as} comment` : `${n.author}'s comment`}</Link>
          </p>
        )}
        {!removed && (
          <details>
            <summary>Reply, report{myCommentIds.has(n.publicId) ? ', edit' : ''}{isMod ? ', moderate' : ''}</summary>
            {!post.lockedAt && (
              <ActionForm action={bound(reply)}>
                <input type="hidden" name="postId" value={post.id} />
                <input type="hidden" name="parentId" value={n.dbId} />
                <label>
                  Reply to {n.author}
                  <textarea name="body" required maxLength={50000} />
                </label>
                <button type="submit">Reply</button>
              </ActionForm>
            )}
            <ReportForm kind="COMMENT" commentId={n.dbId} label={`comment by ${n.author}`} />
            {myCommentIds.has(n.publicId) && (
              <ActionForm action={bound(edit)}>
                <input type="hidden" name="postId" value={post.id} />
                <input type="hidden" name="commentId" value={n.dbId} />
                <label>
                  Edit your comment
                  <textarea name="body" defaultValue={n.body} required maxLength={50000} />
                </label>
                <button type="submit">Save edit</button>
              </ActionForm>
            )}
            {myCommentIds.has(n.publicId) && (
              <ActionForm action={bound(deleteOwn)}>
                <input type="hidden" name="postId" value={post.id} />
                <input type="hidden" name="commentId" value={n.dbId} />
                <button type="submit" aria-label={`Delete your comment (it shows as [deleted]; replies stay)`}>Delete</button>
              </ActionForm>
            )}
            {isMod && <ModContent kind="COMMENT" commentId={n.dbId} label={`comment by ${n.author}`} />}
            {isMod && <EditHistory kind="COMMENT" id={n.dbId} />}
          </details>
        )}
        {removed && isMod && (
          <details>
            <summary>Moderate</summary>
            <ModContent kind="COMMENT" commentId={n.dbId} label="removed comment" />
          </details>
        )}
      </article>
    );
  }

  function ReportForm({ kind, commentId, label }: { kind: 'POST' | 'COMMENT'; commentId?: string; label: string }) {
    return (
      <ActionForm action={bound(report)}>
        <input type="hidden" name="postId" value={post.id} />
        {kind === 'COMMENT' && <input type="hidden" name="commentId" value={commentId} />}
        <label>
          Report {label}
          <select name="reason" defaultValue="spam" aria-label={`Reason for reporting ${label}`}>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Say what (optional, for &ldquo;Something else&rdquo; especially)
          <textarea name="detail" maxLength={2000} rows={2} aria-label={`Detail for reporting ${label}`} />
        </label>
        <button type="submit">Report</button>
      </ActionForm>
    );
  }

  /** 4.1.9 (P0-6): previous bodies, moderators only; rendered through the same sanitizer as live bodies. */
  function EditHistory({ kind, id }: { kind: 'POST' | 'COMMENT'; id: string }) {
    const h = edits.get(`${kind}:${id}`) ?? [];
    if (h.length === 0) return null;
    return (
      <details className="edits">
        <summary>Edit history ({h.length}, moderators only)</summary>
        <ol>
          {h.map((e, i) => (
            <li key={i}>
              <p className="meta">
                before the edit by <Text value={e.editor} /> at {when(e.editedAt)} · {e.withinWindow ? 'inside the window, unmarked' : 'outside the window, marked'}
              </p>
              <Markdown body={e.previousBody} />
            </li>
          ))}
        </ol>
      </details>
    );
  }

  function ModContent({ kind, commentId, label }: { kind: 'POST' | 'COMMENT'; commentId?: string; label: string }) {
    return (
      <ActionForm action={bound(moderateContent)}>
        <input type="hidden" name="postId" value={post.id} />
        {kind === 'COMMENT' && <input type="hidden" name="commentId" value={commentId} />}
        <input type="hidden" name="back" value={here} />
        <label>
          Reason <input name="reason" required maxLength={1000} aria-label={`Moderation reason for ${label}`} />
        </label>
        <button type="submit" name="action" value="REMOVE">Remove</button> <button type="submit" name="action" value="RESTORE">Restore</button>{' '}
        <button type="submit" name="action" value="CLEAR">Clear reports</button>
      </ActionForm>
    );
  }

  return (
    <main id="main" tabIndex={-1}>
      <Crumbs items={[{ href: `/o/${ctx.slug}/f`, text: 'Boards' }, { href: `/o/${ctx.slug}/f/${post.board.slug}`, text: <Text value={post.board.title} /> }, { text: 'Thread' }]} />
      <article aria-label="Post">
        <h1>
          {post.status === 'visible' ? <Text value={post.title} /> : <span className="removed">[{post.status}]</span>}
          {post.pinnedAt && <> <Badge role="pin">Pinned</Badge></>}
          {post.lockedAt && <> <Badge role="warn">Locked</Badge></>}
        </h1>
        {post.status === 'visible' && <VoteControl action={bound(vote)} postId={post.id} label="post" mine={mine.get(post.id) ?? 0} isAuthor={post.author.id === me.profileId} gateNote={gateNote} />}
        <div className="meta">
          {post.ups - post.downs} points · by <Link href={`/o/${ctx.slug}/f/u/${post.author.handle}`}><Text value={post.author.handle} /></Link> · {ago(post.createdAt)}
          {post.editedAt && <> · <Badge>Edited</Badge></>} · {post.commentCount} comments · ranked {ago(t.rankedAt)}{isMod && <> · hot {t.postScore.hot.toFixed(2)} (moderators only, D-9)</>}
        </div>
        {post.status === 'visible' ? <Markdown body={post.body} /> : <p className="removed">This post was {post.status}{isMod ? '; the body is below for moderators.' : '.'}</p>}
        {post.status !== 'visible' && isMod && <Markdown body={post.body} />}
        {post.uploads.length > 0 && (
          <ul aria-label="Attachments">
            {post.uploads.map((u) => (
              <li key={u.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- served by our own guarded route with the stored mime; next/image would re-fetch it through the optimizer, outside the guard */}
                <img src={`/o/${ctx.slug}/f/uploads/${u.id}`} alt={`Attachment ${u.id.slice(0, 8)} (${u.mime}, ${Math.round(u.bytes / 1024)} kB)`} style={{ maxWidth: '100%', maxHeight: '24rem' }} />
              </li>
            ))}
          </ul>
        )}
        {sp.upload && <p role="alert">{sp.upload}</p>}
        <details open={sp.upload ? true : undefined}>
          <summary>Report{post.author.id === me.profileId ? ', edit' : ''}{isMod ? ', moderate' : ''}</summary>
          <ReportForm kind="POST" label="this post" />
          {post.author.id === me.profileId && (
            <ActionForm action={bound(edit)}>
              <input type="hidden" name="postId" value={post.id} />
              <label>
                Edit your post
                <textarea name="body" defaultValue={post.body} required maxLength={50000} />
              </label>
              <button type="submit">Save edit</button>
            </ActionForm>
          )}
          {post.author.id === me.profileId && post.status === 'visible' && (
            <ActionForm action={bound(deleteOwn)}>
              <input type="hidden" name="postId" value={post.id} />
              <button type="submit" aria-label="Delete your post (the title and body show as [deleted]; comments stay)">Delete post</button>
            </ActionForm>
          )}
          {post.author.id === me.profileId && (
            <form method="post" encType="multipart/form-data" action={`/o/${ctx.slug}/f/uploads?post=${post.id}`}>
              <label>
                Attach an image (png, jpeg or webp, up to {Math.round(limits.upload.max_bytes / 1_000_000)} MB)
                <input type="file" name="file" accept={limits.upload.types.join(',')} required />
              </label>
              <button type="submit">Attach</button>
            </form>
          )}
          {isMod && (
            <>
              <ModContent kind="POST" label="this post" />
              <EditHistory kind="POST" id={post.id} />
              <ActionForm action={bound(moderateThread)}>
                <input type="hidden" name="postId" value={post.id} />
                <label>
                  Reason <input name="reason" required maxLength={1000} aria-label="Reason for thread action" />
                </label>
                <button type="submit" name="action" value={post.lockedAt ? 'UNLOCK' : 'LOCK'}>{post.lockedAt ? 'Unlock' : 'Lock'}</button>{' '}
                <button type="submit" name="action" value={post.pinnedAt ? 'UNPIN' : 'PIN'}>{post.pinnedAt ? 'Unpin' : 'Pin'}</button>
              </ActionForm>
            </>
          )}
        </details>
      </article>
      <h2 id="comments">
        {post.commentCount} comments · {t.topLevelShown} top-level shown
      </h2>
      <nav className="tabs" aria-label="Comment sort">
        {COMMENT_SORTS.map((s) => (
          <span key={s}>
            <Link href={`${here}?sort=${s}`} aria-current={s === sort ? 'page' : undefined}>
              {s[0]!.toUpperCase() + s.slice(1)}
            </Link>{' '}
          </span>
        ))}
      </nav>
      {!post.lockedAt && (
        <ActionForm action={bound(reply)}>
          <input type="hidden" name="postId" value={post.id} />
          <label>
            New comment
            <textarea name="body" required maxLength={50000} />
          </label>
          <button type="submit">Comment</button>
        </ActionForm>
      )}
      {post.lockedAt && <p><Badge role="warn">Locked</Badge> This thread is locked; no new replies.</p>}
      <Tree rows={t.rows as Row[]} item={(r) => <CommentView r={r} />} />
      <Pager page={page} pages={t.pages} label="Comment pages" href={(p) => `${here}?sort=${sort}&page=${p}`} />
    </main>
  );
}

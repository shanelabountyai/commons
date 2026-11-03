import { readFileSync } from 'node:fs';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { db } from '@/core/db';
import { ForumForm as ActionForm } from '@/components/forum-form';
import { ago, Badge, Crumbs, Pager, Text } from '@/components/forum';
import { boardPosts, downvoteGateNote, ensureProfile, myVotes, nowEpoch, POST_SORTS, SORT_LABEL } from '@/forum/view';
import { VoteControl } from '@/components/vote-control';
import { parseLimitRules } from '@/rules';
import type { PostSort } from '@/ranking';
import { parseRankingRules } from '@/rules';
import { describeBoard, newPost, vote } from '../actions';

const ranking = parseRankingRules(JSON.parse(readFileSync('rules/ranking.json', 'utf8')));
const limits = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));

/** 4.1.13 (WCAG 2.4.2): the page is titled after the board; guard first, scoped lookup (FR-06, INV-03). */
export async function generateMetadata({ params }: { params: Promise<{ org: string; board: string }> }) {
  const ctx = await requireOrg((await params).org);
  const b = await db.board.findUnique({ where: { orgId_slug: { orgId: ctx.orgId, slug: (await params).board } }, select: { title: true } });
  return { title: b ? `${b.title} · Commons` : 'Commons' };
}

export default async function Board({ params, searchParams }: { params: Promise<{ org: string; board: string }>; searchParams: Promise<{ sort?: string; page?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const me = await ensureProfile(ctx);
  const { board: slug } = await params;
  const sp = await searchParams;
  const sort: PostSort = (POST_SORTS as string[]).includes(sp.sort ?? '') ? (sp.sort as PostSort) : 'hot';
  const v = await boardPosts(ctx.orgId, slug, sort, nowEpoch(), ranking, Number.parseInt(sp.page ?? '1', 10) || 1);
  if (!v) notFound();
  // 5.1: the viewer's votes on the listed posts and whether their ▼ would count now
  const mine = await myVotes(ctx.orgId, me.profileId, v.posts.map((p) => ({ kind: 'POST' as const, id: p.id })));
  const gateNote = await downvoteGateNote(me.profileId, nowEpoch(), limits);
  const newVote = vote.bind(null, ctx.slug);
  const base = `/o/${ctx.slug}/f/${slug}`;
  const canDescribe = can(ctx.role, 'org.update'); // PRD 6.3: owner and admin (D-90)
  return (
    <main id="main" tabIndex={-1}>
      <Crumbs items={[{ href: `/o/${ctx.slug}/f`, text: 'Boards' }, { text: <Text value={v.board.title} /> }]} />
      <h1>
        <Text value={v.board.title} />
      </h1>
      {v.board.description ? (
        <p>
          <Text value={v.board.description} />
        </p>
      ) : (
        canDescribe && <p className="meta">No description yet.</p>
      )}
      {canDescribe && (
        <details>
          <summary>Edit description</summary>
          <ActionForm action={describeBoard.bind(null, ctx.slug)}>
            <input type="hidden" name="boardId" value={v.board.id} />
            <label>
              Board description <input name="description" defaultValue={v.board.description} maxLength={300} />
            </label>
            <button type="submit">Save description</button>
          </ActionForm>
        </details>
      )}
      <p className="meta"><a href="#compose">Write a post</a></p>
      <nav className="tabs" aria-label="Sort">
        {POST_SORTS.map((s) => (
          <span key={s}>
            <Link href={`${base}?sort=${s}`} aria-current={s === sort ? 'page' : undefined}>
              {SORT_LABEL[s]}
            </Link>{' '}
          </span>
        ))}
        <span className="meta">· ranked {ago(v.rankedAt)}{v.posts.some((p) => !p.score.fromSnapshot) ? ' (newest posts scored live)' : ''}</span>
      </nav>
      {v.empty && <p>No posts yet. Start one below.</p>}
      {!v.empty && v.posts.length === 0 && <p>Nothing in this window.</p>}
      <ol>
        {v.posts.map((p) => (
          <li key={p.id} className={p.pinnedAt ? 'post row pinned' : 'post row'}>
            <div className="votes-cell">
              <VoteControl action={newVote} postId={p.id} label={`post ${p.title}`} mine={mine.get(p.id) ?? 0} isAuthor={p.authorId === me.profileId} gateNote={gateNote} />
              {p.ups - p.downs}
            </div>
            <div>
              <Link href={`/o/${ctx.slug}/f/p/${p.publicId}`}>
                <Text value={p.title} />
              </Link>
              {p.pinnedAt && <> <Badge role="pin">Pinned</Badge></>}
              {p.lockedAt && <> <Badge role="warn">Locked</Badge></>}
              <div className="meta">
                by <Link href={`/o/${ctx.slug}/f/u/${p.author.handle}`}><Text value={p.author.handle} /></Link> · {ago(p.createdAt)} · {p.commentCount} comments
              </div>
            </div>
          </li>
        ))}
      </ol>
      <Pager page={v.page} pages={v.pages} label="Board pages" href={(n) => `${base}?sort=${sort}&page=${n}`} />
      <h2 id="compose">New post</h2>
      <ActionForm action={newPost.bind(null, ctx.slug)}>
        <input type="hidden" name="boardId" value={v.board.id} />
        <label>
          Title <input name="title" required maxLength={300}  />
        </label>
        <label>
          Body (markdown: paragraphs, emphasis, code, links, lists, quotes)
          <textarea name="body" required maxLength={50000} />
        </label>
        <button type="submit">Post</button>
      </ActionForm>
    </main>
  );
}

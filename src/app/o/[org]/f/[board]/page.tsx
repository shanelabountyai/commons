import { readFileSync } from 'node:fs';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ForumForm as ActionForm } from '@/components/forum-form';
import { ago, ScopeNote, Text } from '@/components/forum';
import { boardPosts, ensureProfile, nowEpoch, POST_SORTS, SORT_LABEL } from '@/forum/view';
import type { PostSort } from '@/ranking';
import { parseRankingRules } from '@/rules';
import { newPost } from '../actions';

const ranking = parseRankingRules(JSON.parse(readFileSync('rules/ranking.json', 'utf8')));

/** 4.1.13 (WCAG 2.4.2): the page is titled after the board; guard first, scoped lookup (FR-06, INV-03). */
export async function generateMetadata({ params }: { params: Promise<{ org: string; board: string }> }) {
  const ctx = await requireOrg((await params).org);
  const b = await db.board.findUnique({ where: { orgId_slug: { orgId: ctx.orgId, slug: (await params).board } }, select: { title: true } });
  return { title: b ? `${b.title} · Commons` : 'Commons' };
}

export default async function Board({ params, searchParams }: { params: Promise<{ org: string; board: string }>; searchParams: Promise<{ sort?: string }> }) {
  const ctx = await requireOrg((await params).org);
  await ensureProfile(ctx);
  const { board: slug } = await params;
  const sortParam = (await searchParams).sort;
  const sort: PostSort = (POST_SORTS as string[]).includes(sortParam ?? '') ? (sortParam as PostSort) : 'hot';
  const v = await boardPosts(ctx.orgId, slug, sort, nowEpoch(), ranking);
  if (!v) notFound();
  const base = `/o/${ctx.slug}/f/${slug}`;
  return (
    <main id="main" tabIndex={-1}>
      <p className="meta">
        <Link href={`/o/${ctx.slug}/f`}>Boards</Link> ›
      </p>
      <h1>
        <Text value={v.board.title} />
      </h1>
      <ScopeNote />
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
      {v.posts.length === 0 && <p>Nothing here under this sort.</p>}
      <ol>
        {v.posts.map((p) => (
          <li key={p.id} className="post">
            <Link href={`/o/${ctx.slug}/f/p/${p.publicId}`} className={p.pinnedAt ? 'pin' : undefined}>
              <Text value={p.title} />
            </Link>
            <div className="meta">
              {p.ups - p.downs} points · {p.commentCount} comments · by <Link href={`/o/${ctx.slug}/f/u/${p.author.handle}`}><Text value={p.author.handle} /></Link> · {p.createdAt.toISOString().slice(0, 10)}
              {p.lockedAt ? ' · locked' : ''}
            </div>
          </li>
        ))}
      </ol>
      <h2>New post</h2>
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

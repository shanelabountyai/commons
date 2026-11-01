import { readFileSync } from 'node:fs';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Markdown, Text, when } from '@/components/forum';
import { ensureProfile, nowEpoch, permalinkView } from '@/forum/view';
import { parseLimitRules, parseRankingRules } from '@/rules';

const ranking = parseRankingRules(JSON.parse(readFileSync('rules/ranking.json', 'utf8')));
const limits = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));

/** T-5: ancestors collapsed to one line each, then the subtree with the node at depth 0. */
/** 4.1.13 (WCAG 2.4.2): guard first, scoped lookup (FR-06, INV-03). */
export async function generateMetadata({ params }: { params: Promise<{ org: string; post: string; comment: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { post, comment } = await params;
  const c = await db.comment.findUnique({ where: { orgId_publicId: { orgId: ctx.orgId, publicId: comment } }, select: { status: true, author: { select: { handle: true } }, post: { select: { publicId: true, title: true } } } });
  if (!c || c.post.publicId !== post) return { title: 'Commons' };
  return { title: `Comment by ${c.status === 'visible' ? c.author.handle : `[${c.status}]`} on ${c.post.title} · Commons` };
}

export default async function Permalink({ params }: { params: Promise<{ org: string; post: string; comment: string }> }) {
  const ctx = await requireOrg((await params).org);
  await ensureProfile(ctx);
  const { post, comment } = await params;
  const v = await permalinkView(ctx.orgId, post, comment, limits.max_depth_rendered, nowEpoch(), ranking);
  if (!v) notFound();
  const here = `/o/${ctx.slug}/f/p/${post}`;
  return (
    <main id="main" tabIndex={-1}>
      <p className="meta">
        <Link href={`/o/${ctx.slug}/f`}>Boards</Link> › <Link href={here}><Text value={v.post.title} /></Link> › comment
      </p>
      <h1>Comment in context</h1>
      {v.ancestors.length > 0 && (
        <ol aria-label="Ancestors">
          {v.ancestors.map((a) => (
            <li key={a.id} className="meta">
              <Link href={`${here}/c/${a.publicId}`}>{a.status === 'visible' ? <Text value={a.author} /> : `[${a.status}]`}</Link>: {a.status === 'visible' ? a.body.slice(0, 120).replace(/\s+/g, ' ') : ''}
              {a.body.length > 120 && a.status === 'visible' ? '…' : ''}
            </li>
          ))}
        </ol>
      )}
      {v.rows.length === 0 && <p className="removed">This comment was deleted or removed and has no visible replies.</p>}
      <ol className="thread">
        {v.rows.map((r) => (
          <li key={r.id} id={r.id} className="c" style={{ marginLeft: `${r.depth * 1.25}rem` }}>
            <article aria-label={`Comment by ${r.rendered_as === 'body' ? r.node.author : 'removed'}`}>
              <div className="meta">
                {r.rendered_as === 'body' ? <Text value={r.node.author} /> : <span className="removed">[{r.rendered_as}]</span>} · {r.node.ups - r.node.downs} points · {when(new Date(r.node.created_at * 1000))} · depth {r.depth}
              </div>
              {r.rendered_as === 'body' && <Markdown body={r.node.body} />}
              {r.continue_thread && (
                <p>
                  <Link href={`${here}/c/${r.node.publicId}`}>Continue this thread →</Link>
                </p>
              )}
            </article>
          </li>
        ))}
      </ol>
      <p>
        <Link href={`${here}#${comment}`}>Back to the thread</Link>
      </p>
    </main>
  );
}

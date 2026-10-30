import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { Text } from '@/components/forum';
import { ensureProfile, search } from '@/forum/view';

export const metadata = { title: 'Search · Commons' };

/** P1-4: plain full-text (Postgres `simple`); the semantic, cited version is Footnote's lesson, not this one. */
export default async function Search({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireOrg((await params).org);
  await ensureProfile(ctx);
  const q = (await searchParams).q ?? '';
  const r = await search(ctx.orgId, q);
  return (
    <main id="main" tabIndex={-1}>
      <h1>Search</h1>
      <form method="get" role="search">
        <label>
          Words <input name="q" defaultValue={q} maxLength={200} />
        </label>
        <button type="submit">Search</button>
      </form>
      {q && (
        <>
          <h2>
            Posts ({r.posts.length}) for “<Text value={q} />”
          </h2>
          <ul>
            {r.posts.map((p) => (
              <li key={p.publicId}>
                <Link href={`/o/${ctx.slug}/f/p/${p.publicId}`}>
                  <Text value={p.title} />
                </Link>
              </li>
            ))}
          </ul>
          <h2>Comments ({r.comments.length})</h2>
          <ul>
            {r.comments.map((c) => (
              <li key={c.publicId}>
                <Link href={`/o/${ctx.slug}/f/p/${c.postPublicId}/c/${c.publicId}`}>
                  <Text value={c.body.slice(0, 120).replace(/\s+/g, ' ')} />
                </Link>
              </li>
            ))}
          </ul>
          <p className="meta">Plain word match over titles and bodies; removed content is excluded. No index at this size.</p>
        </>
      )}
    </main>
  );
}

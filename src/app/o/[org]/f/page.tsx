import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { ScopeNote, Text } from '@/components/forum';
import { boards, ensureProfile } from '@/forum/view';

export const metadata = { title: 'Boards' };

export default async function Boards({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  await ensureProfile(ctx);
  const bs = await boards(ctx.orgId);
  return (
    <main>
      <h1>Boards</h1>
      <ScopeNote />
      {bs.length === 0 && <p>No boards yet. Load the fixture (<code>npm run commons:load -- --org {ctx.slug}</code>) or ask an admin to create one.</p>}
      <ul>
        {bs.map((b) => (
          <li key={b.id}>
            <Link href={`/o/${ctx.slug}/f/${b.slug}`}>
              <Text value={b.title} />
            </Link>{' '}
            <span className="meta">
              {b.posts} {b.posts === 1 ? 'post' : 'posts'}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}

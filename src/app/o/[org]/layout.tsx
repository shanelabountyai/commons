import Link from 'next/link';
import { can } from '@/core/authz/permissions';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';

// Navigation only. Layouts do not re-run on every navigation, so each page calls requireOrg itself.
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const me = await db.profile.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } }, select: { isModerator: true, handle: true } });
  const mod = ctx.role === 'owner' || ctx.role === 'admin' || !!me?.isModerator;
  const base = `/o/${ctx.slug}`;
  return (
    <>
      <nav aria-label="Forum">
        <strong>{org.name}</strong> · <Link href={`${base}/f`}>Boards</Link> · <Link href={`${base}/f/search`}>Search</Link>
        {me && <> · <Link href={`${base}/f/u/${me.handle}`}>You ({me.handle})</Link></>}
        {mod && <> · <Link href={`${base}/f/mod`}>Mod queue</Link></>}
        {' · '}<Link href={`${base}/settings/members`}>Members</Link>
        {can(ctx.role, 'org.delete') && <> · <Link href={`${base}/settings/danger`}>Delete org</Link></>}
        {' · '}<Link href="/onboarding">Your orgs</Link> · <Link href="/account/security">Account</Link>
      </nav>
      {children}
    </>
  );
}

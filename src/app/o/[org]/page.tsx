import { redirect } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';

// The org home is the forum (Phase 4).
export default async function OrgHome({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  redirect(`/o/${ctx.slug}/f`);
}

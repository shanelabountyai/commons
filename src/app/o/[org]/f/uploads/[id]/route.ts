import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { canModerate } from '@/forum/moderation';
import { findServableUpload, readUpload } from '@/forum/uploads';
import { ensureProfile } from '@/forum/view';

// Serves an attachment to members of the org (guard first). Content-Type comes from the stored record, never from
// the request; nosniff and a tight CSP keep an image from being read as anything else. PRD 6.2 (D-87): a post that is
// not visible serves its attachments to moderators only, the same as its body (P0-6); everyone else gets a 404.
export async function GET(_req: Request, { params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const u = await findServableUpload(db, ctx.orgId, id, canModerate(await ensureProfile(ctx)));
  if (!u) notFound();
  const bytes = await readUpload(ctx.orgId, u.id);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': u.mime,
      'Content-Length': String(u.bytes),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

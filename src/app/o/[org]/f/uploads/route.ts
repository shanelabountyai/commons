import { readFileSync } from 'node:fs';
import { redirect } from 'next/navigation';
import { audit } from '@/core/audit';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { refusalText } from '@/forum/refusals';
import { storeUpload } from '@/forum/uploads';
import { ensureProfile, nowEpoch } from '@/forum/view';
import { parseLimitRules, parseModerationRules } from '@/rules';

const limits = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const mod = parseModerationRules(JSON.parse(readFileSync('rules/moderation.json', 'utf8')));

// Task 4.7: multipart upload for an attachment on your own post (a route handler, not a server action, because a File
// cannot be described to the INV-01..04 harness). Guard first; same-origin is enforced by the template's http checks
// on the page that posts here; refusals come back to the thread as ?upload=<message>. PRD 6.2: storeUpload is the door
// (ban, lock, per-post count, window), so RATE_LIMITED comes back the same way, with its retryAfter.
export async function POST(req: Request, { params }: { params: Promise<{ org: string }> }) {
  console.error(`uploads: POST ${new URL(req.url).pathname} content-type=${req.headers.get('content-type') ?? '-'}`); // one line per attempt; names no user data
  const ctx = await requireOrg((await params).org);
  const me = await ensureProfile(ctx);
  const postId = new URL(req.url).searchParams.get('post') ?? '';
  const post = await db.post.findFirst({ where: { id: postId, orgId: ctx.orgId }, select: { publicId: true } });
  if (!post) return new Response('Not found', { status: 404 });
  const back = `/o/${ctx.slug}/f/p/${post.publicId}`;
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) redirect(`${back}?upload=${encodeURIComponent('Choose a file. (INPUT_INVALID)')}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    await db.$transaction(async (tx) => {
      const alt = form.get('alt');
      const r = await storeUpload(tx, { orgId: ctx.orgId, profileId: me.profileId, postId, mime: file.type, bytes, alt: typeof alt === 'string' ? alt : '', decorative: form.get('decorative') === 'on', at: nowEpoch() }, limits, mod);
      await audit(ctx, 'forum.upload', { targetType: 'upload', targetId: r.id, data: { postId, mime: file.type, bytes: bytes.length } }, tx);
    });
  } catch (e) {
    const text = refusalText(e);
    if (text) redirect(`${back}?upload=${encodeURIComponent(text)}`);
    console.error('uploads: unexpected', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    throw e;
  }
  redirect(back);
}

import { readFileSync } from 'node:fs';
import { redirect } from 'next/navigation';
import { audit } from '@/core/audit';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ForumRefused } from '@/forum/db';
import { storeUpload } from '@/forum/uploads';
import { ensureProfile } from '@/forum/view';
import { parseLimitRules } from '@/rules';

const limits = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));

// Task 4.7: multipart upload for an attachment on your own post (a route handler, not a server action, because a File
// cannot be described to the INV-01..04 harness). Guard first; same-origin is enforced by the template's http checks
// on the page that posts here; refusals come back to the thread as ?upload=<message>.
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
      const r = await storeUpload(tx, { orgId: ctx.orgId, profileId: me.profileId, postId, mime: file.type, bytes }, limits);
      await audit(ctx, 'forum.upload', { targetType: 'upload', targetId: r.id, data: { postId, mime: file.type, bytes: bytes.length } }, tx);
    });
  } catch (e) {
    if (e instanceof ForumRefused) redirect(`${back}?upload=${encodeURIComponent(`${e.message.replace(/^[A-Z_]+: /, '')} (${e.code})`)}`);
    console.error('uploads: unexpected', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    throw e;
  }
  redirect(back);
}

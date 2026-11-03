// Uploads (task 4.7, from D-40). Type and size from rules/limits.json, checked before anything is written; bytes go
// to local disk under var/uploads/<org>/<id> (gitignored; a deploy target would swap this module's two file
// functions for a blob store), the record goes to Upload. The magic bytes must match the declared type: a file
// named .png that starts like an SVG is refused. Served by the route handler, which re-reads the record's mime.
// PRD 6.2 (D-86, D-87): the upload comes through the door like every other write, the header's claimed size is
// capped, metadata containers are stripped before the write, and the author describes the image.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readImageHeader, stripMetadata } from '@/limits/image-header';
import type { LimitRules, ModerationRules } from '@/rules';
import { admit, checkText, RateLimited, refuseIfLocked } from './actions';
import { ForumRefused, lockKey, type Tx } from './db';
import { guardAndRecord } from './limits-store';

export const UPLOAD_ROOT = process.env.UPLOAD_ROOT ?? 'var/uploads';
export const MAX_ALT_CHARS = 300;

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
};

export function checkUpload(mime: string, bytes: Buffer, rules: LimitRules): void {
  if (!rules.upload.types.includes(mime)) throw new ForumRefused('INPUT_INVALID', `upload type ${mime} is not allowed (${rules.upload.types.join(', ')})`);
  if (bytes.length === 0) throw new ForumRefused('INPUT_INVALID', 'upload is empty');
  if (bytes.length > rules.upload.max_bytes) throw new ForumRefused('INPUT_INVALID', `upload is ${bytes.length} bytes; the limit is ${rules.upload.max_bytes}`);
  const magic = MAGIC[mime];
  if (!magic || !magic(bytes)) throw new ForumRefused('INPUT_INVALID', `upload bytes do not look like ${mime}`);
  const h = readImageHeader(mime, bytes, rules.upload.max_pixels);
  if (h.verdict === 'allow') return;
  if (h.reason === 'too_many_pixels') throw new ForumRefused('INPUT_INVALID', `upload is ${h.width} × ${h.height} px (${h.width! * h.height!} pixels); the limit is ${rules.upload.max_pixels}`);
  if (h.reason === 'zero_dimension') throw new ForumRefused('INPUT_INVALID', `upload is ${h.width} × ${h.height} px; an image needs both`);
  throw new ForumRefused('INPUT_INVALID', `upload header is not a readable ${mime} (${h.reason})`);
}

/** '' for decorative; otherwise trimmed text, refused empty, over 300 chars, or holding a control character. */
function checkAlt(alt: string, decorative: boolean): string {
  if (decorative) return '';
  const t = alt.trim();
  checkText('description', t, MAX_ALT_CHARS);
  if (/[\u0000-\u001f\u007f]/.test(t)) throw new ForumRefused('INPUT_INVALID', 'description contains a control character');
  return t;
}

export type StoreUpload = { orgId: string; profileId: string; postId: string; mime: string; bytes: Buffer; alt: string; decorative: boolean; at: number };

/** The door, in its order (PRD 6.2): ban; post and authorship; lock; per-post count; description and file; the window
 *  last, so a refused file records no hit; then the stripped bytes are written. */
export async function storeUpload(tx: Tx, u: StoreUpload, rules: LimitRules, mod?: ModerationRules): Promise<{ id: string }> {
  await admit(tx, u.orgId, u.profileId, u.at);
  const post = await tx.post.findFirst({ where: { id: u.postId, orgId: u.orgId }, select: { authorId: true } });
  if (!post) throw new ForumRefused('UNKNOWN_NODE', `POST ${u.postId}`);
  if (post.authorId !== u.profileId) throw new ForumRefused('NOT_AUTHOR', 'only the author attaches files to a post');
  await refuseIfLocked(tx, u.orgId, { kind: 'POST', id: u.postId }, 'upload', mod);
  await lockKey(tx, `limit:${u.profileId}:upload`); // the same key guardAndRecord takes: two tabs cannot both attach a 4th
  const count = await tx.upload.count({ where: { postId: u.postId } });
  if (count >= rules.upload.max_per_post) throw new ForumRefused('INPUT_INVALID', `this post has ${count} attachments; the limit is ${rules.upload.max_per_post}`);
  const alt = checkAlt(u.alt, u.decorative);
  checkUpload(u.mime, u.bytes, rules);
  const g = await guardAndRecord(tx, { orgId: u.orgId, profileId: u.profileId, action: 'upload', at: u.at }, rules);
  if (g.verdict === 'refuse') throw new RateLimited('upload', g.retryAfter);
  const bytes = Buffer.from(stripMetadata(u.mime, u.bytes));
  const row = await tx.upload.create({ data: { orgId: u.orgId, profileId: u.profileId, postId: u.postId, mime: u.mime, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), alt }, select: { id: true } });
  const dir = join(UPLOAD_ROOT, u.orgId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, row.id), bytes);
  return row;
}

/** PRD 6.2 (D-87 #3): an attachment of a post that is not visible is served to moderators only, as its body is (P0-6). */
export async function findServableUpload(client: Tx, orgId: string, id: string, isModerator: boolean) {
  const u = await client.upload.findFirst({ where: { id, orgId }, include: { post: { select: { status: true } } } });
  if (!u) return null;
  if (!isModerator && u.post?.status !== 'visible') return null;
  return u;
}

export async function readUpload(orgId: string, id: string): Promise<Buffer> {
  return readFile(join(UPLOAD_ROOT, orgId, id));
}

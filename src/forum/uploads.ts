// Uploads (task 4.7, from D-40). Type and size from rules/limits.json, checked before anything is written; bytes go
// to local disk under var/uploads/<org>/<id> (gitignored; a deploy target would swap this module's two file
// functions for a blob store), the record goes to Upload. The magic bytes must match the declared type: a file
// named .png that starts like an SVG is refused. Served by the route handler, which re-reads the record's mime.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LimitRules } from '@/rules';
import { ForumRefused, type Tx } from './db';

export const UPLOAD_ROOT = process.env.UPLOAD_ROOT ?? 'var/uploads';

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
}

export async function storeUpload(tx: Tx, u: { orgId: string; profileId: string; postId: string; mime: string; bytes: Buffer }, rules: LimitRules): Promise<{ id: string }> {
  checkUpload(u.mime, u.bytes, rules);
  const post = await tx.post.findFirst({ where: { id: u.postId, orgId: u.orgId }, select: { authorId: true } });
  if (!post) throw new ForumRefused('UNKNOWN_NODE', `POST ${u.postId}`);
  if (post.authorId !== u.profileId) throw new ForumRefused('NOT_AUTHOR', 'only the author attaches files to a post');
  const row = await tx.upload.create({ data: { orgId: u.orgId, profileId: u.profileId, postId: u.postId, mime: u.mime, bytes: u.bytes.length, sha256: createHash('sha256').update(u.bytes).digest('hex') }, select: { id: true } });
  const dir = join(UPLOAD_ROOT, u.orgId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, row.id), u.bytes);
  return row;
}

export async function readUpload(orgId: string, id: string): Promise<Buffer> {
  return readFile(join(UPLOAD_ROOT, orgId, id));
}

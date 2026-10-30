// Task 4.7: type, size and magic bytes from rules/limits.json; only the author attaches; the file lands on disk.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { toDate } from '@/forum/db';
import { checkUpload, readUpload, storeUpload } from '@/forum/uploads';
import { parseLimitRules } from '@/rules';
import { makeOrg } from '../helpers/org';

const rules = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
let orgId: string;
let author: string;
let other: string;
let postId: string;

beforeAll(async () => {
  await db.$executeRawUnsafe(`TRUNCATE "Upload", "Post", "Board", "Profile" CASCADE`);
  await db.org.deleteMany({ where: { slug: 'upload-test' } });
  orgId = (await makeOrg('upload-test')).id;
  const board = await db.board.create({ data: { orgId, slug: 'help', title: 'Help' } });
  const mk = async (h: string) => {
    const u = await db.user.create({ data: { email: `${h}-${orgId.slice(0, 8)}@example.com` } });
    return (await db.profile.create({ data: { orgId, userId: u.id, handle: h, joinedAt: toDate(0) } })).id;
  };
  author = await mk('author');
  other = await mk('other');
  postId = (await db.post.create({ data: { orgId, boardId: board.id, authorId: author, publicId: 'U-P1', title: 't', body: 'b' } })).id;
});
afterAll(() => db.$disconnect());

describe('uploads', () => {
  it('refuses by name: wrong type, oversize, empty, wrong magic bytes', () => {
    expect(() => checkUpload('image/svg+xml', PNG, rules)).toThrow(/INPUT_INVALID.*image\/svg\+xml is not allowed/);
    expect(() => checkUpload('image/png', Buffer.concat([PNG, Buffer.alloc(rules.upload.max_bytes)]), rules)).toThrow(/INPUT_INVALID.*the limit is 2000000/);
    expect(() => checkUpload('image/png', Buffer.alloc(0), rules)).toThrow(/empty/);
    expect(() => checkUpload('image/png', Buffer.from('<svg onload=alert(1)>'), rules)).toThrow(/do not look like image\/png/);
    expect(() => checkUpload('image/png', PNG, rules)).not.toThrow();
  });
  it('only the author attaches; the record and the bytes agree', async () => {
    await expect(db.$transaction((tx) => storeUpload(tx, { orgId, profileId: other, postId, mime: 'image/png', bytes: PNG }, rules))).rejects.toMatchObject({ code: 'NOT_AUTHOR' });
    const r = await db.$transaction((tx) => storeUpload(tx, { orgId, profileId: author, postId, mime: 'image/png', bytes: PNG }, rules));
    const row = await db.upload.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ mime: 'image/png', bytes: PNG.length, postId });
    expect((await readUpload(orgId, r.id)).equals(PNG)).toBe(true);
  });
});

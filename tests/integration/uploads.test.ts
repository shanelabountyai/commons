// Task 4.7: type, size and magic bytes from rules/limits.json; only the author attaches; the file lands on disk.
// PRD 6.2 (D-86, D-87): the upload goes through the door (ban, author, lock, per-post count, header, window), carries
// the author's description, and a non-visible post's upload is served only to moderators. Red before the code.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { toDate } from '@/forum/db';
import { checkUpload, findServableUpload, readUpload, storeUpload } from '@/forum/uploads';
import { parseLimitRules, parseModerationRules } from '@/rules';
import { makeOrg } from '../helpers/org';

const rules = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const mod = parseModerationRules(JSON.parse(readFileSync('rules/moderation.json', 'utf8')));
const cases = (JSON.parse(readFileSync('fixtures/uploads/cases.json', 'utf8')) as { cases: { id: string; hex: string }[] }).cases;
const fx = (id: string) => Buffer.from(cases.find((c) => c.id === id)!.hex, 'hex');
const PNG = fx('U-PNG-01'); // 1 x 1, no metadata chunks: stored byte-identical
const T = 1_793_836_800;
let orgId: string;
let boardId: string;
let author: string;
let other: string;
let postId: string;
let n = 0;

const mk = async (h: string) => {
  const u = await db.user.create({ data: { email: `${h}-${orgId.slice(0, 8)}@example.com` } });
  return (await db.profile.create({ data: { orgId, userId: u.id, handle: h, joinedAt: toDate(0) } })).id;
};
const newPost = async (authorId: string) => (await db.post.create({ data: { orgId, boardId, authorId, publicId: `U-P${++n}`, title: 't', body: 'b' } })).id;
const store = (o: { profileId?: string; postId?: string; bytes?: Buffer; alt?: string; decorative?: boolean; at: number }) =>
  db.$transaction((tx) => storeUpload(tx, { orgId, profileId: o.profileId ?? author, postId: o.postId ?? postId, mime: 'image/png', bytes: o.bytes ?? PNG, alt: o.alt ?? 'a rack, front view', decorative: o.decorative ?? false, at: o.at }, rules, mod));
const hits = (profileId: string) => db.limitHit.count({ where: { profileId, action: 'upload' } });

beforeAll(async () => {
  await db.$executeRawUnsafe(`TRUNCATE "Upload", "Post", "Board", "Profile", "LimitHit" CASCADE`);
  await db.org.deleteMany({ where: { slug: 'upload-test' } });
  orgId = (await makeOrg('upload-test')).id;
  boardId = (await db.board.create({ data: { orgId, slug: 'help', title: 'Help' } })).id;
  author = await mk('author');
  other = await mk('other');
  postId = await newPost(author);
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
    await expect(store({ profileId: other, at: T })).rejects.toMatchObject({ code: 'NOT_AUTHOR' });
    const r = await store({ at: T });
    const row = await db.upload.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ mime: 'image/png', bytes: PNG.length, postId, alt: 'a rack, front view' });
    expect((await readUpload(orgId, r.id)).equals(PNG)).toBe(true);
  });
});

describe('PRD 6.2: the upload goes through the door', () => {
  it('a banned member is refused BANNED_UNTIL and records no hit', async () => {
    const p = await mk('banned');
    const post = await newPost(p);
    await db.profile.update({ where: { id: p }, data: { bannedUntil: toDate(T + 86_400) } });
    await expect(store({ profileId: p, postId: post, at: T })).rejects.toMatchObject({ code: 'BANNED_UNTIL' });
    expect(await hits(p)).toBe(0);
  });
  it('a locked thread refuses an upload THREAD_LOCKED', async () => {
    const p = await mk('locked');
    const post = await newPost(p);
    await db.post.update({ where: { id: post }, data: { lockedAt: toDate(T) } });
    await expect(store({ profileId: p, postId: post, at: T + 1 })).rejects.toMatchObject({ code: 'THREAD_LOCKED' });
    expect(await hits(p)).toBe(0);
  });
  it('the max_per_post + 1-th attachment is refused', async () => {
    const p = await mk('perpost');
    const post = await newPost(p);
    for (let i = 0; i < rules.upload.max_per_post; i++) await store({ profileId: p, postId: post, at: T + i * 3601 }); // an hour apart: the window is not what this tests
    await expect(store({ profileId: p, postId: post, at: T + 10 * 3601 })).rejects.toMatchObject({ code: 'INPUT_INVALID', message: expect.stringMatching(/4 attachments; the limit is 4/) });
  });
  it("a young member's third upload in the window is RATE_LIMITED with retryAfter; refusals record no hit", async () => {
    const p = await mk('young');
    const post = await newPost(p);
    await store({ profileId: p, postId: post, at: T });
    await expect(store({ profileId: p, postId: post, bytes: fx('U-PNG-02'), at: T + 5 })).rejects.toMatchObject({ code: 'INPUT_INVALID' }); // refused file: no hit
    await store({ profileId: p, postId: post, at: T + 10 });
    expect(await hits(p)).toBe(2);
    await expect(store({ profileId: p, postId: post, at: T + 20 })).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfter: 3580 });
    expect(await hits(p)).toBe(2);
  });
  it('a 20 000 x 20 000 PNG header is refused with the pixel count', async () => {
    const p = await mk('pixels');
    await expect(store({ profileId: p, postId: await newPost(p), bytes: fx('U-PNG-02'), at: T })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      message: expect.stringMatching(/20000 × 20000 px \(400000000 pixels\); the limit is 25000000/),
    });
  });
  it('metadata is stripped before the write; sha256 is of the stored bytes', async () => {
    const p = await mk('strip');
    const post = await newPost(p);
    const ok = await db.$transaction((tx) => storeUpload(tx, { orgId, profileId: p, postId: post, mime: 'image/jpeg', bytes: fx('U-STRIP-JPG'), alt: 'x', decorative: false, at: T }, rules, mod));
    const stored = await readUpload(orgId, ok.id);
    const want = (JSON.parse(readFileSync('fixtures/uploads/cases.json', 'utf8')) as { cases: { id: string; stripped_sha256: string; stripped_bytes: number }[] }).cases.find((c) => c.id === 'U-STRIP-JPG')!;
    expect(stored.length).toBe(want.stripped_bytes);
    expect(await db.upload.findUniqueOrThrow({ where: { id: ok.id } })).toMatchObject({ bytes: want.stripped_bytes, sha256: want.stripped_sha256 });
    expect(stored.includes(Buffer.from('GPSLatitude'))).toBe(false);
  });
});

describe('PRD 6.2: author alt text', () => {
  it('empty without decorative is refused; decorative stores ""; 301 chars and a NUL are refused', async () => {
    const p = await mk('alt');
    const post = await newPost(p);
    await expect(store({ profileId: p, postId: post, alt: '', at: T })).rejects.toMatchObject({ code: 'INPUT_INVALID', message: expect.stringMatching(/description is empty/) });
    await expect(store({ profileId: p, postId: post, alt: '   ', at: T })).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(store({ profileId: p, postId: post, alt: 'x'.repeat(301), at: T })).rejects.toMatchObject({ code: 'INPUT_INVALID', message: expect.stringMatching(/301 chars; the limit is 300/) });
    await expect(store({ profileId: p, postId: post, alt: 'a\u0000b', at: T })).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(await hits(p)).toBe(0);
    const d = await store({ profileId: p, postId: post, alt: 'ignored', decorative: true, at: T });
    expect((await db.upload.findUniqueOrThrow({ where: { id: d.id } })).alt).toBe('');
  });
});

describe('PRD 6.2: a non-visible post serves its uploads to moderators only', () => {
  it('removed post: hidden from a member, served to a moderator; visible post: served to both', async () => {
    const p = await mk('removed');
    const post = await newPost(p);
    const u = await store({ profileId: p, postId: post, at: T });
    expect(await findServableUpload(db, orgId, u.id, false)).toMatchObject({ id: u.id });
    await db.post.update({ where: { id: post }, data: { status: 'removed' } });
    expect(await findServableUpload(db, orgId, u.id, false)).toBeNull();
    expect(await findServableUpload(db, orgId, u.id, true)).toMatchObject({ id: u.id });
    await db.post.update({ where: { id: post }, data: { status: 'deleted' } });
    expect(await findServableUpload(db, orgId, u.id, false)).toBeNull();
  });
});

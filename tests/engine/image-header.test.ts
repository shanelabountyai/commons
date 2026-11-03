// PRD 6.2 (D-87): every case in fixtures/uploads/cases.json agrees with tools/uploadlib.py (header and strip).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evalUploads, type UploadCase } from '@/eval/uploads';
import { readImageHeader } from '@/limits/image-header';
import { parseLimitRules } from '@/rules';

const rules = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const fx = JSON.parse(readFileSync('fixtures/uploads/cases.json', 'utf8')) as { max_pixels: number; cases: UploadCase[] };

describe('image header parse and strip (PRD 6.2)', () => {
  it('the fixture was built against the committed max_pixels', () => expect(fx.max_pixels).toBe(rules.upload.max_pixels));
  it('every case matches the oracle', () => {
    const r = evalUploads(fx.cases, rules.upload.max_pixels);
    expect(r.firstDiff).toBeUndefined();
    expect(r.matched).toBe(30);
  });
  it('GL-21/22: exactly max_pixels is allowed, one over is refused', () => {
    const ihdr = (w: number, h: number) => {
      const b = Buffer.alloc(33);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b);
      b.writeUInt32BE(w, 16);
      b.writeUInt32BE(h, 20);
      return b;
    };
    expect(readImageHeader('image/png', ihdr(5000, 5000), rules.upload.max_pixels)).toMatchObject({ verdict: 'allow' });
    expect(readImageHeader('image/png', ihdr(1, 25_000_001), rules.upload.max_pixels)).toMatchObject({ verdict: 'refuse', reason: 'too_many_pixels' });
  });
});

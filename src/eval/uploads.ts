// PRD 6.2 (D-87): fixtures/uploads/cases.json through the header parse and the strip; one FileResult, one row per
// case, first difference named. The oracle's fields are width, height, verdict, reason, stripped_sha256/_bytes.
import { createHash } from 'node:crypto';
import { readImageHeader, stripMetadata } from '@/limits/image-header';
import type { FileResult } from './index';

export type UploadCase = { id: string; mime: string; hex: string; width: number | null; height: number | null; verdict: 'allow' | 'refuse'; reason: string | null; stripped_sha256: string | null; stripped_bytes: number | null };

export function evalUploads(cases: readonly UploadCase[], maxPixels: number): FileResult {
  const file = 'uploads/cases.json';
  const res: FileResult = { file, rows: cases.length, matched: 0 };
  cases.forEach((c, i) => {
    const bytes = Buffer.from(c.hex, 'hex');
    const v = readImageHeader(c.mime, bytes, maxPixels);
    const s = v.verdict === 'allow' ? stripMetadata(c.mime, bytes) : null;
    const got: Record<string, unknown> = {
      width: v.width ?? null,
      height: v.height ?? null,
      verdict: v.verdict,
      reason: v.verdict === 'refuse' ? v.reason : null,
      stripped_sha256: s ? createHash('sha256').update(s).digest('hex') : null,
      stripped_bytes: s ? s.length : null,
    };
    const field = Object.keys(got).find((k) => got[k] !== c[k as keyof UploadCase]);
    if (field) res.firstDiff ??= { file, row: i, field: `${c.id}.${field}`, expected: String(c[field as keyof UploadCase]), actual: String(got[field]) };
    else res.matched++;
  });
  return res;
}

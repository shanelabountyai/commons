// The renderer (task 3.3) in vitest: the fixture set, the allowed subset, the link policy, and the nesting flatten.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flattenNesting, renderMarkdown, renderText } from '@/render';

type Case = { id: string; class: 'markdown' | 'text'; input: string; forbidden: string[]; must_contain: string[] };
const spec = JSON.parse(readFileSync('fixtures/xss/cases.json', 'utf8')) as { live_patterns: Record<string, string>; cases: Case[] };
const re = Object.fromEntries(Object.entries(spec.live_patterns).map(([k, v]) => [k, new RegExp(v, 'i')]));

describe('src/render against fixtures/xss', () => {
  for (const c of spec.cases) {
    it(`${c.id} is inert`, () => {
      const out = c.class === 'markdown' ? renderMarkdown(c.input) : renderText(c.input);
      expect(c.forbidden.filter((k) => re[k]!.test(out)), out.slice(0, 120)).toEqual([]);
      for (const s of c.must_contain) expect(out).toContain(s);
    });
  }
  it('links: http/https/mailto keep their href with the rel set; others lose it', () => {
    expect(renderMarkdown('[a](https://x.example)')).toContain('<a href="https://x.example" rel="nofollow ugc noopener" target="_blank">a</a>');
    expect(renderMarkdown('[a](ftp://x.example)')).toContain('<a rel="nofollow ugc noopener" target="_blank">a</a>');
  });
  it('raw HTML is text, markdown is markup', () => {
    expect(renderMarkdown('<b>x</b> **y**')).toBe('<p>&lt;b&gt;x&lt;/b&gt; <strong>y</strong></p>\n');
  });
  it('D-42 flattenNesting keeps content past the cap', () => {
    expect(flattenNesting('> '.repeat(50) + 'deep')).toBe('> '.repeat(8) + 'deep');
    expect(flattenNesting('> > ok')).toBe('> > ok');
    expect(renderMarkdown('* '.repeat(300) + 'item')).toContain('item');
  });
  it('renderText encodes the five characters and drops controls', () => {
    expect(renderText('<a href="x">&\'\u0000')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});

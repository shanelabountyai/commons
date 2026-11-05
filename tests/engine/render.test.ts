// The renderer (task 3.3) in vitest: the fixture set, the allowed subset, the link policy, and the nesting flatten.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadFixtures } from '@/fixtures/load';
import { flattenNesting, linkHrefs, renderMarkdown, renderText } from '@/render';

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
    expect(renderMarkdown('[a](https://x.example)')).toContain('<a href="https://x.example" rel="nofollow ugc noopener">a</a>');
    expect(renderMarkdown('[a](ftp://x.example)')).toContain('<a rel="nofollow ugc noopener">a</a>');
    expect(renderMarkdown('# h1\n\n### h3\n\n###### h6')).toBe('<h4>h1</h4>\n<h6>h3</h6>\n<h6>h6</h6>\n'); // D-61: demoted three levels, capped at h6
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

// PRD 7.3 (D-104): the link counter is the renderer. If they ever drift apart, this fails.
describe('linkHrefs is pinned to renderMarkdown', () => {
  const fx = loadFixtures();
  const anchors = (body: string) => (renderMarkdown(body).match(/<a href=/g) ?? []).length;
  for (const c of fx.links) {
    it(`${c.id} ${c.syntax}: ${c.anchors} anchor(s)`, () => {
      expect(anchors(c.body)).toBe(c.anchors);
      expect(linkHrefs(c.body)).toHaveLength(c.anchors);
    });
  }
  // Rendering all 5,500 costs ~85 s (DOMPurify ~15 ms a body); a body with no `[` or `<` cannot render an anchor
  // (linkify and raw HTML are off), so the pin renders the 325 that hold one. D-103 measured all 5,500 agreeing.
  it('the 325 community bodies holding [ or <: as many hrefs as anchors, each with a link', () => {
    const bodies = [...fx.text.values()].map((t) => t.body).filter((b) => /[[<]/.test(b));
    expect(bodies).toHaveLength(325);
    expect(bodies.filter((b) => linkHrefs(b).length !== anchors(b) || anchors(b) === 0)).toEqual([]);
  });
  it('returns the hrefs as rendered: mailto kept, an unsafe scheme dropped', () => {
    expect(linkHrefs('[m](mailto:a@x.example) <https://y.example> [f](ftp://z.example)')).toEqual(['mailto:a@x.example', 'https://y.example']);
  });
});

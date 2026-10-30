// The one sanitizer module (CLAUDE.md non-negotiable 1; D-38; task 3.3). Everything a user typed reaches a page
// through one of two functions here, and nothing else in src/ may call markdown-it, DOMPurify or
// dangerouslySetInnerHTML (engine:lint enforces the last two).
//
//   renderMarkdown(body)  — markdown fields (post and comment bodies): markdown-it with html OFF (raw HTML is text),
//                           then DOMPurify with an explicit allowlist, then our own link policy. Returns HTML.
//   renderText(value)     — plain-text fields (title, handle, board title): entity-encoded, never markdown. Returns HTML.
//
// Allowed subset (3.2): p, br, strong, em, b, i, code, pre, a, ul, ol, li, blockquote, h1–h6, hr, del, s. No images
// (D-40), no raw HTML, no tables yet. Links: http, https, mailto only; everything else loses its href. Every anchor
// gets rel="nofollow ugc noopener" and target="_blank".
import DOMPurify from 'isomorphic-dompurify';
import MarkdownIt from 'markdown-it';

export const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'b', 'i', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'del', 's'] as const;
export const ALLOWED_ATTR = ['href', 'rel', 'target'] as const;
export const LINK_REL = 'nofollow ugc noopener';
export const MAX_BODY_CHARS = 50_000; // longer bodies are cut before parsing (X-41); the writer refuses them earlier

const md = new MarkdownIt('commonmark', { html: false, linkify: false, typographer: false, breaks: false });
// markdown-it's own URL check already drops javascript:/vbscript:/data: on links; keep it and add ours below.

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

/** D-42: markdown-it silently drops content nested deeper than its limit, so pathological runs of quote or list
 *  markers are collapsed to MAX_NESTING before parsing and the text survives (X-42, X-43). */
export const MAX_NESTING = 8;
const QUOTE_RUN = /^((?:>\s?){9,})/;
const LIST_RUN = /^((?:(?:[*+-]|\d{1,9}[.)])\s+){9,})/;
export function flattenNesting(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const q = QUOTE_RUN.exec(line);
      if (q) return '> '.repeat(MAX_NESTING) + line.slice(q[1]!.length);
      const l = LIST_RUN.exec(line);
      if (l) return '- '.repeat(MAX_NESTING) + line.slice(l[1]!.length);
      return line;
    })
    .join('\n');
}

function linkPolicy(root: ParentNode): void {
  for (const a of Array.from(root.querySelectorAll('a'))) {
    const href = (a.getAttribute('href') ?? '').trim();
    if (!SAFE_HREF.test(href)) a.removeAttribute('href');
    a.setAttribute('rel', LINK_REL);
    a.setAttribute('target', '_blank');
  }
}

export function renderMarkdown(body: string): string {
  const src = body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body;
  const html = md.render(flattenNesting(src));
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_CONTENTS: ['script', 'style', 'svg', 'math', 'iframe', 'object', 'embed', 'form'],
    KEEP_CONTENT: true,
    RETURN_DOM: true,
  }) as unknown as HTMLElement;
  linkPolicy(clean);
  return clean.innerHTML;
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Plain-text fields: every markup-significant character encoded; control characters and BOM dropped. */
export function renderText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F﻿]/g, '').replace(/[&<>"']/g, (c) => ENTITIES[c]!);
}

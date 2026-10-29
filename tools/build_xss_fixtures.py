"""XSS fixture set (Phase 3, task 3.1; CLAUDE.md non-negotiable 1). Stdlib only; python3 -I tools/build_xss_fixtures.py

Writes fixtures/xss/cases.json: hostile inputs for every text field, each with the patterns the rendered output
must NOT contain (a live vector) and, where it matters, the text it MUST contain (the content survives as text).
Written before any renderer exists. The set is frozen (hashed in fixtures/MANIFEST.json by reference_rank.py's
manifest step); every abuse technique that works once becomes a case here (non-negotiable 7).

Field classes: `markdown` fields (post body, comment body) go through the markdown renderer and the sanitizer;
`text` fields (post title, handle, board title) are plain text, output-encoded, never markdown.
"""
import json
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "xss")

# Patterns a rendered fragment must never contain (case-insensitive regex, applied to the HTML string).
LIVE = {
    "script": r"<script",
    "handler": r"\son[a-z]+\s*=",
    "js_url": r"javascript\s*:",
    "data_url": r"data\s*:",
    "vbs_url": r"vbscript\s*:",
    "iframe": r"<(iframe|object|embed|frame|frameset|applet)",
    "svg": r"<(svg|math|foreignobject|annotation-xml)",
    "img": r"<img",
    "form": r"<(form|input|button|textarea|select|option|base|link|meta|style)",
    "raw_lt": r"<(?![/]?(p|br|strong|em|b|i|code|pre|a|ul|ol|li|blockquote|h[1-6]|hr|del|s)\b)",  # any other tag at all
}
TEXT_LIVE = {"any_tag": r"<[a-z/!?]"}  # plain-text fields contain no markup whatsoever once encoded

cases = []


def md(cid, inp, must_contain=None, note=""):
    cases.append({"id": cid, "field": "body", "class": "markdown", "input": inp, "forbidden": sorted(LIVE), "must_contain": must_contain or [], "note": note})


def tx(cid, field, inp, must_contain=None, note=""):
    cases.append({"id": cid, "field": field, "class": "text", "input": inp, "forbidden": sorted(TEXT_LIVE), "must_contain": must_contain or [], "note": note})


# --- markdown bodies: scripts and handlers ---
md("X-01", "<script>alert(1)</script>hello", ["hello"], "bare script tag")
md("X-02", "<SCRIPT SRC=//evil.example/x.js></SCRIPT>", [], "uppercase, external src")
md("X-03", "<scr<script>ipt>alert(1)</scr</script>ipt>", [], "nested split tag")
md("X-04", "<img src=x onerror=alert(1)>", [], "img with handler")
md("X-05", "<b onmouseover=alert(1)>bold</b>", ["bold"], "handler on an allowed tag")
md("X-06", "<a href='javascript:alert(1)'>click</a>", ["click"], "javascript: href in raw html")
md("X-07", "[click](javascript:alert(1))", ["click"], "javascript: href in markdown link")
md("X-08", "[click](JaVaScRiPt:alert(1))", ["click"], "mixed-case scheme")
md("X-09", "[click](java\tscript:alert(1))", ["click"], "tab inside the scheme")
md("X-10", "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)", ["click"], "data: URL")
md("X-11", "[click](vbscript:msgbox(1))", ["click"], "vbscript: URL")
md("X-12", "[x](&#106;avascript:alert(1))", [], "entity-encoded scheme")
md("X-13", "[x](&#x6A;&#x61;vascript:alert(1))", [], "hex-entity scheme")
md("X-14", "<svg onload=alert(1)>", [], "svg with handler")
md("X-15", "<svg><script>alert(1)</script></svg>", [], "script inside svg")
md("X-16", "<math><mi xlink:href='javascript:alert(1)'>x</mi></math>", [], "mathml xlink")
md("X-17", "<iframe src='javascript:alert(1)'></iframe>", [], "iframe")
md("X-18", "<object data='x.swf'></object><embed src='x.swf'>", [], "object/embed")
md("X-19", "<form action='https://evil.example'><input name=q><button>go</button></form>", [], "form fields")
md("X-20", "<style>body{display:none}</style>text", ["text"], "style tag")
md("X-21", "<base href='https://evil.example/'>", [], "base tag")
md("X-22", "<meta http-equiv=refresh content='0;url=https://evil.example'>", [], "meta refresh")
md("X-23", "<link rel=stylesheet href=https://evil.example/x.css>", [], "link tag")
md("X-24", "<div style=\"background:url(javascript:alert(1))\">x</div>", ["x"], "style attribute")
md("X-25", "<a href='https://ok.example' target='_blank'>ok</a>", ["ok"], "raw anchor: allowed only through the markdown path, raw html is not rendered")
md("X-26", "```html\n<script>alert(1)</script>\n```", ["&lt;script&gt;"], "script inside a code fence must be shown as text")
md("X-27", "`<img src=x onerror=alert(1)>`", ["&lt;img"], "inline code")
md("X-28", "<!-- <script>alert(1)</script> -->after", ["after"], "html comment")
md("X-29", "<![CDATA[<script>alert(1)</script>]]>", [], "cdata")
md("X-30", "<?xml version='1.0'?><script>alert(1)</script>", [], "processing instruction")
md("X-31", "&lt;script&gt;alert(1)&lt;/script&gt;", ["&lt;script&gt;"], "already-encoded text must stay encoded, not be decoded twice")
md("X-32", "<a href=\"https://ok.example\" onclick=\"alert(1)\">x</a>", ["x"], "handler on anchor")
md("X-33", "[x](https://ok.example \"title\" onclick=alert(1))", [], "junk after the title in a markdown link")
md("X-34", "![x](https://evil.example/a.png)", [], "markdown image: no images until Phase 4 (D-40)")
md("X-35", "![x](x onerror=alert(1))", [], "image with handler in the url")
md("X-36", "<p>‮<script>alert(1)</script></p>", [], "RTL override before a tag")
md("X-37", "<scr\u0000ipt>alert(1)</script>", [], "NUL inside the tag name")
md("X-38", "﻿<script>alert(1)</script>", [], "BOM prefix")
md("X-39", "＜script＞alert(1)＜/script＞", ["＜script＞"], "fullwidth brackets are text, must survive as text")
md("X-40", "<<script>script>alert(1)<</script>/script>", [], "double open")
md("X-41", "a" * 200_000, ["a" * 100], "200 kB body: renders without hanging, content kept")
md("X-42", "> " * 500 + "deep", ["deep"], "500 nested blockquotes")
md("X-43", "* " * 2000 + "item", ["item"], "2,000 nested list markers")
md("X-44", "[" * 5000 + "x" + "]" * 5000, [], "5,000 unbalanced brackets (parser cost)")
md("X-45", "<a href=\"https://ok.example\">ok</a> **bold** _em_ `code`\n\n- one\n- two\n\n> quote", ["<strong>bold</strong>", "<em>em</em>", "<code>code</code>", "<li>one</li>", "<blockquote>"], "the allowed subset renders")
md("X-46", "[ok](https://ok.example)", ['href="https://ok.example"', 'rel="nofollow ugc noopener"'], "a markdown link carries the rel set and keeps its href")
md("X-47", "[mail](mailto:a@example.com)", ['href="mailto:a@example.com"'], "mailto allowed")
md("X-48", "[rel](/local/path) and [proto](//evil.example/x)", ["rel", "proto"], "relative and protocol-relative links: text kept; href policy is the renderer's (must not be javascript)")
md("X-49", "<details open ontoggle=alert(1)><summary>x</summary></details>", ["x"], "details/ontoggle")
md("X-50", "<marquee onstart=alert(1)>x</marquee>", ["x"], "obsolete tag with handler")

# --- plain-text fields: title, handle, board title ---
for i, (field, inp, keep) in enumerate([
    ("title", "<script>alert(1)</script>My title", ["My title"]),
    ("title", "Title <img src=x onerror=alert(1)>", ["Title"]),
    ("title", "\"><svg onload=alert(1)>", []),
    ("title", "Normal title with & ampersand and <angle> brackets", ["&amp;", "&lt;angle&gt;"]),
    ("handle", "<b>bold</b>name", ["bold", "name"]),
    ("handle", "name\" onmouseover=\"alert(1)", ["name"]),
    ("handle", "x" * 10_000, ["x" * 50]),
    ("board_title", "Self-hosting <script>alert(1)</script>", ["Self-hosting"]),
    ("board_title", "`md` **not** rendered", ["`md` **not** rendered"]),
], start=1):
    tx(f"T-{i:02d}", field, inp, keep)

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "cases.json"), "w") as f:
    json.dump({"version": 1, "live_patterns": {**LIVE, **TEXT_LIVE}, "cases": cases}, f, indent=1, ensure_ascii=False)
    f.write("\n")
print(f"{len(cases)} cases -> fixtures/xss/cases.json ({sum(1 for c in cases if c['class']=='markdown')} markdown, {sum(1 for c in cases if c['class']=='text')} text)")

"""Link-syntax fixture set (PRD 7.3, D-104; rule 7). Stdlib only; python3 -I tools/build_link_fixtures.py

Writes fixtures/links/cases.json: one body per markdown syntax, each with the number of anchors the author states
renderMarkdown emits for it (`anchors`) and the number the PRD 7.2 counter (`](http(s)://`) counted (`counted_7_2`).
Written before the new counter, like the XSS set. The link counter must agree with the renderer on every case; the
ten cases where `anchors` is 1 and `counted_7_2` is 0 are the bodies of the `spam-link-syntax-rotation` attack.
Frozen: hashed in fixtures/MANIFEST.json by reference_rank.py's manifest step.
"""
import json
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "links")

CASES = [
    ("L-01", "inline", "[a](https://h1.example.test)", 1, 1),
    ("L-02", "autolink", "<https://h2.example.test>", 1, 0),
    ("L-03", "autolink, upper-case scheme", "<HTTPS://h3.example.test>", 1, 0),
    ("L-04", "reference", "[a][r]\n\n[r]: https://h4.example.test", 1, 0),
    ("L-05", "collapsed reference", "[r][]\n\n[r]: https://h5.example.test", 1, 0),
    ("L-06", "shortcut reference", "[r]\n\n[r]: https://h6.example.test", 1, 0),
    ("L-07", "space before destination", "[a]( https://h7.example.test)", 1, 0),
    ("L-08", "angle-bracket destination", "[a](<https://h8.example.test>)", 1, 0),
    ("L-09", "upper-case scheme", "[a](HTTPS://h9.example.test)", 1, 0),
    ("L-10", "newline before destination", "[a](\nhttps://h10.example.test)", 1, 0),
    ("L-11", "mailto", "[a](mailto:x@h11.example.test)", 1, 0),
    ("L-12", "bare URL (linkify off)", "https://h12.example.test", 0, 0),
    ("L-13", "image (no images, D-40)", "![a](https://h13.example.test/i.png)", 0, 1),
]

cases = [{"id": i, "syntax": s, "body": b, "anchors": a, "counted_7_2": c} for i, s, b, a, c in CASES]

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "cases.json"), "w") as f:
        json.dump({"version": 1, "cases": cases}, f, indent=1, ensure_ascii=False)
        f.write("\n")
    gaps = sum(1 for c in cases if c["anchors"] == 1 and c["counted_7_2"] == 0)
    print(f"{len(cases)} cases -> fixtures/links/cases.json ({gaps} render an anchor the 7.2 counter missed)")

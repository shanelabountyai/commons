"""Checks every fixture file's sha256 against fixtures/MANIFEST.json and that the reference evaluator still
reproduces the expected files from the inputs. Ends with OK or exits 1 naming the first mismatch.
python3 -I tools/verify_fixtures.py
"""
import csv
import hashlib
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import reference_rank as ref  # noqa: E402
import uploadlib  # noqa: E402
import build_community_text  # noqa: E402
import community_text_lib as ctl  # noqa: E402

FIX = os.path.join(HERE, "..", "fixtures")


def main():
    manifest = json.load(open(os.path.join(FIX, "MANIFEST.json")))
    for name, want in sorted(manifest.items()):
        p = os.path.join(FIX, name)
        if not os.path.exists(p):
            print(f"MISSING {name}")
            return 1
        got = hashlib.sha256(open(p, "rb").read()).hexdigest()
        if got != want:
            print(f"HASH MISMATCH {name}: {got[:12]} != {want[:12]}")
            return 1
    out, _ = ref.compute(*ref.load())
    for name, rows in out.items():
        if ref.to_csv(name, rows) != open(os.path.join(FIX, name)).read():
            print(f"REFERENCE DRIFT {name}: recomputed rows differ from the committed file")
            return 1
    up = json.load(open(os.path.join(FIX, "uploads", "cases.json")))["cases"]
    for c in up:
        data = bytes.fromhex(c["hex"])
        got = uploadlib.parse(c["mime"], data)
        s = uploadlib.strip(c["mime"], data) if got["verdict"] == "allow" else None
        got.update(stripped_sha256=hashlib.sha256(s).hexdigest() if s is not None else None, stripped_bytes=len(s) if s is not None else None)
        for k, v in got.items():
            if c[k] != v:
                print(f"UPLOAD DRIFT {c['id']} {k}: committed {c[k]!r}, oracle {v!r}")
                return 1
    community = build_community_text.build(20261104)
    for name, body in community.items():
        if body != open(os.path.join(FIX, name), newline="").read():
            print(f"COMMUNITY DRIFT {name}: the seed no longer reproduces the committed file")
            return 1
    dups = ctl.duplicates(ctl.nodes(), window=float("inf"))
    want = sorted((r["post_id"], r["original_id"]) for r in ctl.read("community/reposts.csv"))
    if dups != want:
        print(f"COMMUNITY DUPLICATES {len(dups)} found, reposts.csv names {len(want)}: the reposts must be the only duplicates")
        return 1
    print(f"OK: {len(manifest)} files match MANIFEST.json; {len(out)} expected files, {len(up)} upload cases and {len(community)} community files reproduce from the inputs")
    return 0


if __name__ == "__main__":
    sys.exit(main())

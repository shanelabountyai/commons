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
    print(f"OK: {len(manifest)} files match MANIFEST.json; {len(out)} expected files reproduce from the inputs")
    return 0


if __name__ == "__main__":
    sys.exit(main())

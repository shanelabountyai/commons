"""Commons community-text oracle (PRD 7.1, D-98). Stdlib only; python3 -I.

Test oracle, not product code. Over fixtures/community/: the normalized body hash (the src/forum/actions.ts bodyHash
rule: lowercase, collapse whitespace, trim, sha256 hex), link hosts from markdown links, lengths, the duplicate check
(rules/moderation.json duplicate) and the report-swarm check (tools/modlib.py) over the organic reports. PRD 7.2
measures with these; 7.1 only asserts that, with no window, the duplicate check finds exactly the generated reposts.
"""
import csv
import hashlib
import json
import os
import re

import modlib

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "..", "fixtures")
DUP = json.load(open(os.path.join(HERE, "..", "rules", "moderation.json")))["duplicate"]
LINK = re.compile(r"\]\(https?://([^/\s)]+)")


def read(name):
    with open(os.path.join(FIX, name), newline="") as f:
        return list(csv.DictReader(f))


def body_hash(s):
    return hashlib.sha256(" ".join(s.lower().split()).encode()).hexdigest()


def hosts(body):
    return LINK.findall(body)


def nodes():
    """[{id, author, created_at, status, title, body}] for every post and comment."""
    text = {r["node_id"]: r for r in read("community/bodies.csv")}
    out = []
    for name in ("posts.csv", "comments.csv"):
        for n in read(name):
            out.append({"id": n["id"], "author": n["author"], "created_at": int(n["created_at"]), "status": n["status"],
                        "title": text[n["id"]]["title"], "body": text[n["id"]]["body"]})
    return out


def duplicates(ns, window=DUP["window_seconds"]):
    """(node, earlier match) pairs: same normalized body, >= min_chars, the match inside window (inclusive, D-80)."""
    seen, out = {}, []
    for n in sorted(ns, key=lambda n: (n["created_at"], n["id"])):
        if len(n["body"].strip()) < DUP["min_chars"]:
            continue
        h = body_hash(n["body"])
        prior = [m for m in seen.get(h, []) if n["created_at"] - m["created_at"] <= window]
        if prior:
            out.append((n["id"], prior[-1]["id"]))
        seen.setdefault(h, []).append(n)
    return sorted(out)


def swarms(ns):
    users = read("users.csv")
    sc = {"accounts": [{"id": u["id"], "created_at": int(u["created_at"])} for u in users],
          "nodes": [{"id": n["id"], "author": n["author"]} for n in ns],
          "reports": [{"row": i, "reporter": r["reporter"], "node_id": r["node_id"], "reported_at": int(r["reported_at"])}
                      for i, r in enumerate(read("community/reports.csv"))]}
    return modlib.detect(sc)

"""Commons reference evaluator. Stdlib only; python3 -I tools/reference_rank.py [--write-expected]

Reads fixtures/, reduces votes (votelib), ranks posts and comments (rankinglib), renders the named threads
(treelib), replays the limit scripts (limitslib), prints the eval table, and with --write-expected writes
fixtures/expected_*.csv and fixtures/MANIFEST.json. The TypeScript engine:eval must reproduce every row.
"""
import argparse
import bisect
import csv
import hashlib
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from rankinglib import hot, wilson_lower, top_window_includes  # noqa: E402
from votelib import reduce_votes  # noqa: E402
from treelib import assign_paths, depth, render, permalink  # noqa: E402
from limitslib import replay  # noqa: E402

FIX = os.path.join(HERE, "..", "fixtures")
T0 = 1_793_232_000
H, D = 3600, 86400
NOW = T0 + 7 * D
NAMED_THREADS = ["P-THICK", "P-CHAIN", "P-GW"]
EXPECTED = ["expected_post_order_hot.csv", "expected_post_order_top_day.csv", "expected_post_order_top_week.csv",
            "expected_post_order_top_all.csv", "expected_post_order_new.csv", "expected_comment_order_best.csv",
            "expected_counts.csv", "expected_vote_outcomes.csv", "expected_tree.csv", "expected_pages.csv",
            "expected_permalink.csv", "expected_limits.csv"]
INPUTS = ["users.csv", "boards.csv", "posts.csv", "comments.csv", "votes.csv", "xss/cases.json"]


def read(name):
    with open(os.path.join(FIX, name), newline="") as f:
        return list(csv.DictReader(f))


def load():
    users = read("users.csv")
    posts = read("posts.csv")
    comments = read("comments.csv")
    votes = read("votes.csv")
    for r in posts + comments:
        r["created_at"] = int(r["created_at"])
    for r in users:
        r["created_at"] = int(r["created_at"])
    for v in votes:
        v["cast_at"] = int(v["cast_at"])
        v["value"] = int(v["value"])
    return users, posts, comments, votes


def compute(users, posts, comments, votes):
    accounts = {u["id"]: u["created_at"] for u in users}
    nodes = {p["id"]: p["author"] for p in posts}
    nodes.update({c["id"]: c["author"] for c in comments})
    # L-5 contributions: authored, not removed, created before t
    authored = {}
    for r in posts + comments:
        if r["status"] != "removed":
            authored.setdefault(r["author"], []).append(r["created_at"])
    for v in authored.values():
        v.sort()

    def contributions_at(user, t):
        return bisect.bisect_left(authored.get(user, []), t)

    counts, outcomes = reduce_votes(nodes, votes, contributions_at, accounts)
    out = {}
    # posts: listings exclude non-visible posts
    vis = [p for p in posts if p["status"] == "visible"]

    def hot_key(p):
        return (-hot(*counts[p["id"]], p["created_at"]), -p["created_at"], p["id"])

    def net(p):
        u, d = counts[p["id"]]
        return u - d

    def rows(sorted_posts, score):
        return [{"rank": i + 1, "post_id": p["id"], "score": score(p)} for i, p in enumerate(sorted_posts)]

    out["expected_post_order_hot.csv"] = rows(sorted(vis, key=hot_key), lambda p: f"{hot(*counts[p['id']], p['created_at']):.7f}")
    for w in ("day", "week", "all"):
        inw = [p for p in vis if top_window_includes(p["created_at"], NOW, w)]
        out[f"expected_post_order_top_{w}.csv"] = rows(sorted(inw, key=lambda p: (-net(p), -p["created_at"], p["id"])), net)
    out["expected_post_order_new.csv"] = rows(sorted(vis, key=lambda p: (-p["created_at"], p["id"])), lambda p: p["created_at"])
    # comments: Best per parent group for the named threads + 3 fixed generic threads
    by_post = {}
    for c in comments:
        by_post.setdefault(c["post_id"], []).append(c)
    generic = sorted((pid for pid, cs in by_post.items() if pid.startswith("P-0") and len(cs) >= 20), key=lambda pid: (-len(by_post[pid]), pid))[:3]
    threads = NAMED_THREADS + generic

    def best_key(c):
        u, d = counts[c["id"]]
        return (-wilson_lower(u, u + d), -c["created_at"], c["id"])

    best_rows = []
    for pid in threads:
        groups = {}
        for c in by_post[pid]:
            groups.setdefault(c["parent_id"], []).append(c)
        for parent in sorted(groups):
            for i, c in enumerate(sorted(groups[parent], key=best_key)):
                u, d = counts[c["id"]]
                best_rows.append({"post_id": pid, "parent_id": parent, "rank": i + 1, "comment_id": c["id"], "score": f"{wilson_lower(u, u + d):.7f}"})
    out["expected_comment_order_best.csv"] = best_rows
    out["expected_counts.csv"] = [{"node_id": n, "ups": counts[n][0], "downs": counts[n][1]} for n in sorted(counts)]
    out["expected_vote_outcomes.csv"] = [{"row": i + 2, "voter": votes[i]["voter"], "node_id": votes[i]["node_id"], "outcome": o} for i, o in sorted(outcomes)]
    # tree renders: P-CHAIN page 1, P-THICK pages 1 and 2, Best order
    tree_rows, page_rows, perma_rows = [], [], []
    for pid, pages in (("P-CHAIN", [1]), ("P-THICK", [1, 2])):
        cs = by_post[pid]
        paths = assign_paths(cs)
        for pg in pages:
            rws, n_top = render(cs, paths, best_key, pg)
            for nid, d, how, cont in rws:
                tree_rows.append({"post_id": pid, "page": pg, "id": nid, "depth": d, "path": paths[nid], "rendered_as": how, "continue_thread": int(cont)})
        _, n_top = render(cs, paths, best_key, 1)
        page_rows.append({"post_id": pid, "comments_total": len(cs), "top_level_shown": n_top, "pages": -(-n_top // 50)})
    for nid in ("C-CHAIN-7", "C-THICK-DEEP-11", "C-DEL-LEAF"):
        pid = "P-CHAIN" if nid.startswith("C-CHAIN") or nid == "C-DEL-LEAF" else "P-THICK"
        cs = by_post[pid]
        paths = assign_paths(cs)
        anc, rws = permalink(cs, paths, best_key, nid)
        perma_rows.append({"node_id": nid, "ancestors": "|".join(anc), "rows": len(rws), "first_rendered_as": rws[0][2] if rws else "omitted"})
    out["expected_tree.csv"] = tree_rows
    out["expected_pages.csv"] = page_rows
    out["expected_permalink.csv"] = perma_rows
    # limit scripts (brief L-3/L-4; plan §fixture shape)
    scripts = []
    t0 = NOW - H
    scripts.append(("spam-young-comments", "comment", "u193", [t0 + i for i in range(60)]))
    scripts.append(("spam-young-posts", "post", "u193", [t0 + 60 * i for i in range(20)]))
    scripts.append(("spam-young-votes", "vote", "u193", [t0 + i for i in range(100)]))
    # normal user: replay u050's own fixture activity through every window
    normal = "u050"
    acts = {"post": sorted(p["created_at"] for p in posts if p["author"] == normal),
            "comment": sorted(c["created_at"] for c in comments if c["author"] == normal),
            "vote": sorted(v["cast_at"] for v in votes if v["voter"] == normal)}
    for action, ts in acts.items():
        scripts.append((f"normal-{normal}-{action}s", action, normal, ts))
    limit_rows = []
    for name, action, user, attempts in scripts:
        a, r, first = replay(attempts, action, accounts[user], lambda t, u=user: contributions_at(u, t))
        limit_rows.append({"script": name, "action": action, "attempts": len(attempts), "allowed": a, "refused": r, "first_retry_after": "" if first is None else first})
    out["expected_limits.csv"] = limit_rows
    return out, counts


def table(out):
    lines = [f"nodes: {len(out['expected_counts.csv'])}  visible posts ranked: {len(out['expected_post_order_hot.csv'])}  now: {NOW}"]
    for k in ("hot", "top_day", "top_week", "top_all", "new"):
        r = out[f"expected_post_order_{k}.csv"]
        lines.append(f"posts {k:8s}: {len(r):3d} rows; top 3: " + ", ".join(f"{x['post_id']}({x['score']})" for x in r[:3]))
    lines.append(f"comments best : {len(out['expected_comment_order_best.csv'])} rows over {len(set(r['post_id'] for r in out['expected_comment_order_best.csv']))} threads")
    oc = {}
    for r in out["expected_vote_outcomes.csv"]:
        oc[r["outcome"]] = oc.get(r["outcome"], 0) + 1
    lines.append("vote outcomes : " + ", ".join(f"{k} {v}" for k, v in sorted(oc.items())))
    for r in out["expected_pages.csv"]:
        lines.append(f"thread {r['post_id']:8s}: {r['comments_total']} comments, {r['top_level_shown']} top-level shown, {r['pages']} pages")
    tr = out["expected_tree.csv"]
    lines.append(f"tree rows     : {len(tr)} rendered; continue-thread links: {sum(r['continue_thread'] for r in tr)}; removed: {sum(1 for r in tr if r['rendered_as']=='removed')}; deleted: {sum(1 for r in tr if r['rendered_as']=='deleted')}")
    for r in out["expected_limits.csv"]:
        lines.append(f"limits {r['script']:28s}: {r['attempts']:3d} attempts, {r['allowed']:3d} allowed, {r['refused']:3d} refused, first retryAfter {r['first_retry_after']}")
    return "\n".join(lines)


FIELDS = {"expected_post_order_hot.csv": ["rank", "post_id", "score"], "expected_post_order_top_day.csv": ["rank", "post_id", "score"],
          "expected_post_order_top_week.csv": ["rank", "post_id", "score"], "expected_post_order_top_all.csv": ["rank", "post_id", "score"],
          "expected_post_order_new.csv": ["rank", "post_id", "score"]}


def to_csv(name, rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=FIELDS.get(name) or list(rows[0].keys()), lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def write_expected(out):
    for name, rows in out.items():
        with open(os.path.join(FIX, name), "w", newline="") as f:
            f.write(to_csv(name, rows))
    manifest = {n: hashlib.sha256(open(os.path.join(FIX, n), "rb").read()).hexdigest() for n in INPUTS + EXPECTED}
    with open(os.path.join(FIX, "MANIFEST.json"), "w") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write("\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--write-expected", action="store_true")
    a = ap.parse_args()
    out, _ = compute(*load())
    print(table(out))
    if a.write_expected:
        write_expected(out)
        print("wrote", ", ".join(EXPECTED), "and MANIFEST.json")

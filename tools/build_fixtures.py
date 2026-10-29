"""Commons fixture generator. Stdlib only; python3 -I tools/build_fixtures.py --seed 20261029

Writes fixtures/{users,boards,posts,comments,votes}.csv deterministically from the seed (D-25). Every
golden case that needs a real node is embedded by name (brief §4, C-8). Bodies are sha256 of a seeded
phrase, not text, until Phase 3. Run twice -> identical bytes.
"""
import argparse
import csv
import hashlib
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from limitslib import downvote_allowed  # noqa: E402

T0 = 1_793_232_000  # 2026-10-29T00:00:00Z (D-7)
H, D = 3600, 86400
NOW = T0 + 7 * D  # eval instant for Top windows and New (plan §fixture shape)
BOARDS = [("selfhosting", "Self-hosting"), ("networking", "Networking"), ("hardware", "Hardware"),
          ("sbc", "Small-board computers"), ("help", "Help"), ("meta", "Meta")]
N_USERS, N_POSTS, N_COMMENTS_TOTAL, THICK_COMMENTS = 200, 500, 5000, 1000
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures")


def body_hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:16]


def build(seed: int):
    rng = random.Random(seed)
    users, posts, comments, votes = [], [], [], []

    # --- users: u001..u185 regular, u186..u192 brigade (young), u193 spam script, u194..u200 young-ish ---
    for i in range(1, N_USERS + 1):
        uid = f"u{i:03d}"
        if 186 <= i <= 192:
            created = T0 - 3 * H  # young at T0+1h (age 4 h)
        elif i == 193:
            created = T0 - 1 * H
        elif i >= 194:
            created = T0 - rng.randint(1, 20) * H
        else:
            created = T0 - rng.randint(2, 400) * D - rng.randint(0, D - 1)
        users.append({"id": uid, "handle": f"homelabber{i:03d}", "created_at": created, "banned_until": ""})
    regular = [u["id"] for u in users[:185]]
    by_user_created = {u["id"]: u["created_at"] for u in users}

    def pick_author(after):
        # an author must exist before the node
        cands = [u for u in regular if by_user_created[u] < after]
        return rng.choice(cands)

    # --- posts ---
    def add_post(pid, board, created, author=None, status="visible"):
        posts.append({"id": pid, "board": board, "author": author or pick_author(created), "created_at": created,
                      "status": status, "title_hash": body_hash(pid + "-title"), "body_hash": body_hash(pid + "-body")})
        return posts[-1]

    named = {}
    named["P-GH-50"] = add_post("P-GH-50", "selfhosting", T0)
    named["P-GH-5-12H"] = add_post("P-GH-5-12H", "selfhosting", T0 + 12 * H)
    named["P-GH-5-13H"] = add_post("P-GH-5-13H", "selfhosting", T0 + 13 * H)
    named["P-GH-5-24H"] = add_post("P-GH-5-24H", "selfhosting", T0 + 24 * H)
    named["P-THICK"] = add_post("P-THICK", "networking", T0 - 10 * D)
    named["P-CHAIN"] = add_post("P-CHAIN", "hardware", T0 - 5 * D)
    named["P-GW"] = add_post("P-GW", "sbc", T0 - 3 * D)
    named["P-BRIGADE"] = add_post("P-BRIGADE", "meta", T0 - 2 * D)
    named["P-DAY-EDGE-IN"] = add_post("P-DAY-EDGE-IN", "help", NOW - D)        # exactly 24 h old at NOW: in 'day' (GT-01)
    named["P-DAY-EDGE-OUT"] = add_post("P-DAY-EDGE-OUT", "help", NOW - D - 1)  # 24 h + 1 s: out (GT-02)
    generic_posts = []
    for i in range(1, N_POSTS - len(named) + 1):
        created = NOW - rng.randint(2 * H, 37 * D)  # about 1 in 18 lands inside the last two days
        status = "removed" if i in (17, 211, 404) else "visible"
        generic_posts.append(add_post(f"P-{i:04d}", rng.choice(BOARDS)[0], created, status=status))

    # --- comments ---
    def add_comment(cid, post, parent_id, created, author=None, status="visible"):
        comments.append({"id": cid, "post_id": post["id"], "parent_id": parent_id, "author": author or pick_author(created),
                         "created_at": created, "status": status, "body_hash": body_hash(cid)})
        return comments[-1]

    def grow(post, n, prefix, depth_cap, end):
        """n comments under post; parent is top-level with p=0.45 else a uniform existing comment (depth-capped)."""
        mine, depth_of = [], {}
        t = post["created_at"] + 60
        step = max(1, (end - t) // max(n, 1))
        for k in range(1, n + 1):
            t += rng.randint(1, max(1, 2 * step - 1))
            t = min(t, end)
            parent = ""
            if mine and rng.random() > 0.45:
                cand = rng.choice(mine)
                if depth_of[cand] + 1 <= depth_cap:
                    parent = cand
            cid = f"{prefix}{k:04d}"
            r = rng.random()
            status = "deleted" if r < 0.02 else "removed" if r < 0.03 else "visible"
            add_comment(cid, post, parent, t, status=status)
            mine.append(cid)
            depth_of[cid] = 0 if parent == "" else depth_of[parent] + 1
        return mine, depth_of

    # P-THICK: 988 grown (cap 11) + a forced chain to depth 11 (12 nodes) = 1000
    thick, thick_depth = grow(named["P-THICK"], THICK_COMMENTS - 12, "C-THICK-", 11, T0 - 1 * D)
    parent, t = "", T0 - 20 * H
    for d in range(12):
        cid = f"C-THICK-DEEP-{d:02d}"
        add_comment(cid, named["P-THICK"], parent, t + d * 60)
        parent = cid
    # P-CHAIN: 8-deep chain, depth 3 author-deleted, depth 5 mod-removed; sibling S1 with two dead leaves
    parent, t = "", named["P-CHAIN"]["created_at"] + 600
    chain_author = pick_author(t)
    for d in range(8):
        cid = f"C-CHAIN-{d}"
        status = "deleted" if d == 3 else "removed" if d == 5 else "visible"
        add_comment(cid, named["P-CHAIN"], parent, t + d * 300, author=chain_author if d == 3 else None, status=status)
        parent = cid
    add_comment("C-CHAIN-S1", named["P-CHAIN"], "", t + 3000)
    add_comment("C-DEL-LEAF", named["P-CHAIN"], "C-CHAIN-S1", t + 3100, status="deleted")
    add_comment("C-REM-LEAF", named["P-CHAIN"], "C-CHAIN-S1", t + 3200, status="removed")
    # P-GW: three top-level siblings for the Wilson goldens
    t = named["P-GW"]["created_at"] + 600
    gw = {k: add_comment(k, named["P-GW"], "", t + i * 60) for i, k in enumerate(["C-GW-1-1", "C-GW-70-100", "C-GW-10-10"])}
    # generic comments over the generic posts
    remaining = N_COMMENTS_TOTAL - len(comments)
    weights = [rng.paretovariate(1.2) for _ in generic_posts]
    total_w = sum(weights)
    alloc = [int(remaining * w / total_w) for w in weights]
    for i in range(remaining - sum(alloc)):
        alloc[i % len(alloc)] += 1
    for post, n in zip(generic_posts, alloc):
        if n:
            grow(post, n, f"C-{post['id'][2:]}-", 9, NOW - 2 * H)
    assert len(comments) == N_COMMENTS_TOTAL, len(comments)

    # --- votes ---
    nodes = [(p["id"], p["author"], p["created_at"]) for p in posts] + [(c["id"], c["author"], c["created_at"]) for c in comments]
    authored = {}
    for nid, author, created in nodes:
        authored.setdefault(author, []).append(created)
    for v in authored.values():
        v.sort()

    def contributions_at(user, t):
        # L-5 approximation for generation only: authored nodes created before t (removal ignored here; the
        # reference reducer recomputes with removal applied, which can only lower a count)
        import bisect
        return bisect.bisect_left(authored.get(user, []), t)

    seen = set()

    def add_vote(voter, nid, value, t, note=""):
        votes.append({"voter": voter, "node_id": nid, "value": value, "cast_at": t, "note": note})

    def other_voters(k, author, after):
        cands = [u for u in regular if u != author and by_user_created[u] < after]
        return rng.sample(cands, k)

    # named vote patterns (C-8: the author's +1 is implicit, so 49 / 4 / 69+30 / 9 others)
    for pid, k in (("P-GH-50", 49), ("P-GH-5-12H", 4), ("P-GH-5-13H", 4), ("P-GH-5-24H", 4)):
        p = named[pid]
        for u in other_voters(k, p["author"], p["created_at"]):
            add_vote(u, pid, 1, p["created_at"] + rng.randint(1, 1800), "golden")
            seen.add((u, pid))
    c = gw["C-GW-70-100"]
    vs = other_voters(99, c["author"], c["created_at"])
    for i, u in enumerate(vs):
        val = 1 if i < 69 else -1
        t = c["created_at"] + rng.randint(1, 3600)
        if val == -1 and not downvote_allowed(by_user_created[u], contributions_at(u, t), t):
            val = 1  # keep the golden exact: swap in an eligible downvoter below
        add_vote(u, c["id"], val, t, "golden")
        seen.add((u, c["id"]))
    downs = sum(1 for v in votes if v["node_id"] == "C-GW-70-100" and v["value"] == -1)
    assert downs == 30, f"GW-70-100 downvoters gated: {downs}"
    c = gw["C-GW-10-10"]
    for u in other_voters(9, c["author"], c["created_at"]):
        add_vote(u, c["id"], 1, c["created_at"] + rng.randint(1, 3600), "golden")
        seen.add((u, c["id"]))
    # brigade: 7 young accounts downvote P-BRIGADE inside 10 min at T0+1h -> all GATED_DOWNVOTE
    for i, u in enumerate([f"u{n:03d}" for n in range(186, 193)]):
        add_vote(u, "P-BRIGADE", -1, T0 + H + i * 80, "brigade-1")
    # generic votes
    post_k = [0, 1, 2, 3, 5, 8, 13, 21, 34]
    post_w = [10, 18, 18, 15, 13, 10, 8, 5, 3]
    com_k = [0, 1, 2, 3, 5, 8]
    com_w = [40, 25, 15, 10, 6, 4]
    for nid, author, created in nodes:
        if nid in named or nid in gw or nid.startswith("P-GH"):
            continue
        k = rng.choices(post_k if nid.startswith("P-") else com_k, post_w if nid.startswith("P-") else com_w)[0]
        if not k:
            continue
        for u in other_voters(k, author, created):
            if (u, nid) in seen:
                continue
            t = created + rng.randint(1, min(3 * D, max(2, NOW - 1 - created)))
            val = -1 if rng.random() < 0.15 else 1
            if val == -1 and not downvote_allowed(by_user_created[u], contributions_at(u, t), t):
                val = 1
            add_vote(u, nid, val, t)
            seen.add((u, nid))
    # deliberate second events: 10 toggles, 10 switches; 3 self-downvotes; 2 author re-ups; 5 gated downvotes
    firsts = [v for v in votes if v["note"] == "" and v["cast_at"] < NOW - D]
    for v in rng.sample(firsts, 10):
        add_vote(v["voter"], v["node_id"], v["value"], v["cast_at"] + rng.randint(60, 3600), "toggle")
    for v in rng.sample([f for f in firsts if f["value"] == 1], 10):
        t = v["cast_at"] + rng.randint(60, 3600)
        if downvote_allowed(by_user_created[v["voter"]], contributions_at(v["voter"], t), t):
            add_vote(v["voter"], v["node_id"], -1, t, "switch")
        else:
            add_vote(v["voter"], v["node_id"], 1, t, "toggle")
    authors = {nid: (author, created) for nid, author, created in nodes}
    for nid in rng.sample([n for n in authors if n.startswith("C-0")], 3):
        a, cr = authors[nid]
        add_vote(a, nid, -1, cr + 120, "self-down")
    for nid in rng.sample([n for n in authors if n.startswith("P-0")], 2):
        a, cr = authors[nid]
        add_vote(a, nid, 1, cr + 120, "self-up")
    young = [f"u{n:03d}" for n in range(194, 201)]
    for nid in rng.sample([n for n in authors if n.startswith("P-0")], 5):
        add_vote(rng.choice(young), nid, -1, T0 + rng.randint(H, 2 * D), "gated")

    votes.sort(key=lambda v: (v["cast_at"], v["voter"], v["node_id"]))
    posts.sort(key=lambda p: (p["created_at"], p["id"]))
    comments.sort(key=lambda c: (c["post_id"], c["created_at"], c["id"]))
    return users, [{"slug": s, "title": t} for s, t in BOARDS], posts, comments, votes


def write_csv(name, rows, fields):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    a = ap.parse_args()
    users, boards, posts, comments, votes = build(a.seed)
    write_csv("users.csv", users, ["id", "handle", "created_at", "banned_until"])
    write_csv("boards.csv", boards, ["slug", "title"])
    write_csv("posts.csv", posts, ["id", "board", "author", "created_at", "status", "title_hash", "body_hash"])
    write_csv("comments.csv", comments, ["id", "post_id", "parent_id", "author", "created_at", "status", "body_hash"])
    write_csv("votes.csv", votes, ["voter", "node_id", "value", "cast_at", "note"])
    print(f"seed {a.seed}: {len(users)} users, {len(boards)} boards, {len(posts)} posts, {len(comments)} comments, {len(votes)} vote events -> fixtures/")

"""PRD 5.3 — ranking measurement study (measure only, D-63). Stdlib only; python3 -I tools/rank_study.py [--gravity G]
[--no-author-plus-one] [--step-hours 6] [--json]

Reads the frozen fixture, reduces votes as of each time step with the same oracle the expected files come from
(votelib, rankinglib), and prints M1–M7 from docs/prd/5.3-ranking-measurement-study.md. Writes nothing under
fixtures/ (rule 8). Every number in docs/EVAL.md §Phase 5 comes from this command.
"""
import argparse
import bisect
import json
import math
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rankinglib  # noqa: E402
from rankinglib import wilson_lower  # noqa: E402
from votelib import reduce_votes  # noqa: E402
from limitslib import downvote_allowed  # noqa: E402
from reference_rank import load, NOW, H  # noqa: E402

GATE_HOURS, GATE_CONTRIBUTIONS = 24, 3  # rules/limits.json downvote_gate; M6 reports distance from it
HOT_EPOCH = rankinglib.HOT_EPOCH


# ------------------------------------------------------------------------------------------------ statistics helpers

def ranks(keys):
    """Average ranks (1-based) of a list of sortable keys; ties share the mean rank."""
    order = sorted(range(len(keys)), key=lambda i: keys[i])
    r = [0.0] * len(keys)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and keys[order[j + 1]] == keys[order[i]]:
            j += 1
        mean = (i + j) / 2 + 1
        for k in range(i, j + 1):
            r[order[k]] = mean
        i = j + 1
    return r


def spearman(a, b):
    n = len(a)
    if n < 3:
        return None
    ra, rb = ranks(a), ranks(b)
    ma, mb = sum(ra) / n, sum(rb) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return num / den if den else None


def kendall(a, b):
    """tau-b over paired keys (O(n²); n ≤ ~100 here)."""
    n = len(a)
    if n < 3:
        return None
    conc = disc = ties_a = ties_b = 0
    for i in range(n):
        for j in range(i + 1, n):
            da = (a[i] > a[j]) - (a[i] < a[j])
            db = (b[i] > b[j]) - (b[i] < b[j])
            if da == 0 and db == 0:
                continue
            if da == 0:
                ties_a += 1
            elif db == 0:
                ties_b += 1
            elif da == db:
                conc += 1
            else:
                disc += 1
    den = math.sqrt((conc + disc + ties_a) * (conc + disc + ties_b))
    return (conc - disc) / den if den else None


def pct(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    k = (len(xs) - 1) * p
    f, c = math.floor(k), math.ceil(k)
    return xs[f] if f == c else xs[f] + (xs[c] - xs[f]) * (k - f)


def fmt(x, nd=3):
    if x is None:
        return "—"
    if isinstance(x, bool) or isinstance(x, str):
        return str(x)
    return f"{float(x):.{nd}f}" if (isinstance(x, float) or nd != 0) and not (isinstance(x, int) and nd == 0) else str(x)


# ------------------------------------------------------------------------------------------------ fixture as of t

class Fixture:
    def __init__(self):
        self.users, self.posts, self.comments, self.votes = load()
        self.accounts = {u["id"]: u["created_at"] for u in self.users}
        self.nodes = {p["id"]: p["author"] for p in self.posts}
        self.nodes.update({c["id"]: c["author"] for c in self.comments})
        authored = {}
        for r in self.posts + self.comments:
            if r["status"] != "removed":
                authored.setdefault(r["author"], []).append(r["created_at"])
        for v in authored.values():
            v.sort()
        self.authored = authored
        self.votes_sorted = sorted(self.votes, key=lambda v: v["cast_at"])
        self.vote_times = [v["cast_at"] for v in self.votes_sorted]
        self.boards = sorted({p["board"] for p in self.posts if p["status"] == "visible"})

    def contributions_at(self, user, t):
        return bisect.bisect_left(self.authored.get(user, []), t)

    def counts_at(self, t):
        upto = self.votes_sorted[: bisect.bisect_right(self.vote_times, t)]
        counts, _ = reduce_votes(self.nodes, upto, self.contributions_at, self.accounts)
        return counts

    def visible_posts_at(self, board, t):
        return [p for p in self.posts if p["status"] == "visible" and p["board"] == board and p["created_at"] <= t]


def hot_with(gravity, ups, downs, created):
    s = ups - downs
    order = math.log10(max(abs(s), 1))
    sign = 1 if s > 0 else -1 if s < 0 else 0
    return round(sign * order + (created - HOT_EPOCH) / gravity, 7)


# ------------------------------------------------------------------------------------------------ measurements

def m1_m2(fx, gravity, step_hours):
    """Per board: Hot↔New agreement per step (M1) and hours in each top-5 (M2)."""
    first = min(p["created_at"] for p in fx.posts)
    steps = list(range(first + step_hours * H, NOW + 1, step_hours * H))
    counts_cache = {t: fx.counts_at(t) for t in steps}
    out = {}
    for board in fx.boards:
        rhos, taus = [], []
        hours_hot, hours_new = {}, {}
        for t in steps:
            posts = fx.visible_posts_at(board, t)
            if len(posts) < 3:
                continue
            counts = counts_cache[t]
            hot_key = {p["id"]: (-hot_with(gravity, *counts[p["id"]], p["created_at"]), -p["created_at"], p["id"]) for p in posts}
            new_key = {p["id"]: (-p["created_at"], p["id"]) for p in posts}
            ids = [p["id"] for p in posts]
            # rank position under each order (1 = top)
            hot_pos = {pid: i + 1 for i, pid in enumerate(sorted(ids, key=lambda i: hot_key[i]))}
            new_pos = {pid: i + 1 for i, pid in enumerate(sorted(ids, key=lambda i: new_key[i]))}
            a = [hot_pos[i] for i in ids]
            b = [new_pos[i] for i in ids]
            rhos.append(spearman(a, b))
            taus.append(kendall(a, b))
            for pid, pos in hot_pos.items():
                if pos <= 5:
                    hours_hot[pid] = hours_hot.get(pid, 0) + step_hours
            for pid, pos in new_pos.items():
                if pos <= 5:
                    hours_new[pid] = hours_new.get(pid, 0) + step_hours
        rhos = [r for r in rhos if r is not None]
        taus = [r for r in taus if r is not None]
        only_hot = sorted(set(hours_hot) - set(hours_new))
        out[board] = {
            "steps": len(rhos),
            "spearman_median": statistics.median(rhos) if rhos else None,
            "spearman_min": min(rhos) if rhos else None,
            "spearman_max": max(rhos) if rhos else None,
            "kendall_median": statistics.median(taus) if taus else None,
            "hot_top5_posts": len(hours_hot),
            "new_top5_posts": len(hours_new),
            "hot_top5_hours_median": statistics.median(hours_hot.values()) if hours_hot else None,
            "hot_top5_hours_p90": pct(list(hours_hot.values()), 0.9),
            "new_top5_hours_median": statistics.median(hours_new.values()) if hours_new else None,
            "reached_hot_top5_never_new_top5": len(only_hot),
            "reached_hot_top5_never_new_top5_ids": only_hot[:10],
        }
    return steps, out


def m3_m4(fx, author_plus_one):
    counts = fx.counts_at(NOW)
    groups = {}
    for c in fx.comments:
        groups.setdefault((c["post_id"], c["parent_id"]), []).append(c)
    sib = [g for g in groups.values() if len(g) >= 2]
    only_author = sum(1 for c in fx.comments if counts[c["id"]] == (1, 0))
    le = {k: sum(1 for g in sib if all(sum(counts[c["id"]]) <= k for c in g)) for k in (1, 2, 3)}

    def best_key(c, drop_author):
        u, d = counts[c["id"]]
        n = u + d - (1 if drop_author else 0)
        uu = u - (1 if drop_author else 0)
        return (-wilson_lower(uu, n), -c["created_at"], c["id"])

    changed_first = 0
    taus = []
    tie_only = 0
    for g in sib:
        cur = sorted(g, key=lambda c: best_key(c, False))
        alt = sorted(g, key=lambda c: best_key(c, True))
        if cur[0]["id"] != alt[0]["id"]:
            changed_first += 1
        pos_cur = {c["id"]: i for i, c in enumerate(cur)}
        pos_alt = {c["id"]: i for i, c in enumerate(alt)}
        ids = [c["id"] for c in g]
        tau = kendall([pos_cur[i] for i in ids], [pos_alt[i] for i in ids])
        if tau is not None:
            taus.append(tau)
        scores = {round(wilson_lower(counts[c["id"]][0], sum(counts[c["id"]])), 9) for c in g}
        if len(scores) == 1:
            tie_only += 1
    return {
        "comments": len(fx.comments),
        "comments_only_author_vote": only_author,
        "sibling_groups": len(sib),
        "groups_all_n_le_1": le[1],
        "groups_all_n_le_2": le[2],
        "groups_all_n_le_3": le[3],
        "groups_where_best_is_pure_tiebreak": tie_only,
        "m4_groups_first_changes_without_author_plus_one": changed_first,
        "m4_kendall_median_current_vs_without": statistics.median(taus) if taus else None,
        "m4_groups_compared": len(taus),
    }


def m6(fx):
    first_down = {}
    for v in fx.votes_sorted:
        if v["value"] == -1 and v["voter"] not in first_down:
            first_down[v["voter"]] = v
    ages, contribs, allowed, near_age, near_contrib = [], [], 0, 0, 0
    for voter, v in first_down.items():
        t = v["cast_at"]
        age_h = (t - fx.accounts[voter]) / H
        c = fx.contributions_at(voter, t)
        ages.append(age_h)
        contribs.append(c)
        if downvote_allowed(fx.accounts[voter], c, t):
            allowed += 1
        if abs(age_h - GATE_HOURS) <= 1:
            near_age += 1
        if abs(c - GATE_CONTRIBUTIONS) <= 1:
            near_contrib += 1
    return {
        "users_with_a_downvote": len(first_down),
        "first_downvote_allowed_by_gate": allowed,
        "first_downvote_gated": len(first_down) - allowed,
        "age_hours_at_first_downvote_p50": pct(ages, 0.5),
        "age_hours_at_first_downvote_p10": pct(ages, 0.1),
        "contributions_at_first_downvote_p50": pct(contribs, 0.5),
        "contributions_at_first_downvote_p10": pct(contribs, 0.1),
        "within_1h_of_the_24h_age_gate": near_age,
        "within_1_contribution_of_the_3_contribution_gate": near_contrib,
    }


def m7(fx):
    flagged = {v["voter"] for v in fx.votes if v.get("note", "").startswith("brigade")}
    by_user_comments, by_user_votes = {}, {}
    for c in fx.comments:
        by_user_comments.setdefault(c["author"], []).append(c["created_at"])
    for v in fx.votes:
        by_user_votes.setdefault(v["voter"], []).append(v["cast_at"])

    def gaps(by_user):
        g = []
        for u, ts in by_user.items():
            if u in flagged:
                continue
            ts = sorted(ts)
            g.extend(b - a for a, b in zip(ts, ts[1:]))
        return g

    gc, gv = gaps(by_user_comments), gaps(by_user_votes)
    return {
        "users_excluded_as_flagged_voters": len(flagged),
        "comment_gap_s_p50": pct(gc, 0.5),
        "comment_gap_s_p1": pct(gc, 0.01),
        "comment_gaps_under_10s": sum(1 for x in gc if x < 10),
        "comment_gaps": len(gc),
        "vote_gap_s_p50": pct(gv, 0.5),
        "vote_gap_s_p1": pct(gv, 0.01),
        "vote_gaps_under_2s": sum(1 for x in gv if x < 2),
        "vote_gaps": len(gv),
        "max_comments_any_user_any_60s": max_in_window(by_user_comments, flagged, 60),
        "max_votes_any_user_any_60s": max_in_window(by_user_votes, flagged, 60),
    }


def max_in_window(by_user, flagged, w):
    best = 0
    for u, ts in by_user.items():
        if u in flagged:
            continue
        ts = sorted(ts)
        j = 0
        for i in range(len(ts)):
            while ts[i] - ts[j] >= w:
                j += 1
            best = max(best, i - j + 1)
    return best


# ------------------------------------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gravity", type=int, default=None, help="hot gravity in seconds for M1/M2 (default: the rules file's 45000; M5 sweeps 45000/90000/150000)")
    ap.add_argument("--no-author-plus-one", action="store_true", help="print the M4 alternative Best only")
    ap.add_argument("--step-hours", type=int, default=6)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    fx = Fixture()
    report = {"now": NOW, "step_hours": a.step_hours, "posts": len(fx.posts), "comments": len(fx.comments), "votes": len(fx.votes), "boards": fx.boards}
    gravities = [a.gravity] if a.gravity else [rankinglib.HOT_GRAVITY_SECONDS, 90_000, 150_000]
    report["m1_m2_by_gravity"] = {}
    for g in gravities:
        steps, per_board = m1_m2(fx, g, a.step_hours)
        report["m1_m2_by_gravity"][g] = per_board
        report["steps"] = len(steps)
    report["m3_m4"] = m3_m4(fx, not a.no_author_plus_one)
    report["m6"] = m6(fx)
    report["m7"] = m7(fx)
    if a.json:
        print(json.dumps(report, indent=1, default=str))
        return
    print(f"rank_study: {report['posts']} posts, {report['comments']} comments, {report['votes']} vote events; {report['steps']} steps of {a.step_hours} h ending at the fixture instant {NOW}")
    for g, per_board in report["m1_m2_by_gravity"].items():
        print(f"\nM1/M2 — gravity {g} s (one decade of votes = {g / 3600:.1f} h)")
        print(f"{'board':12} {'steps':>5} {'ρ med':>7} {'ρ min':>7} {'ρ max':>7} {'τ med':>7} {'hot5':>5} {'new5':>5} {'h hot med':>9} {'h hot p90':>9} {'h new med':>9} {'hot-only':>8}")
        for b, r in per_board.items():
            print(f"{b:12} {r['steps']:>5} {fmt(r['spearman_median']):>7} {fmt(r['spearman_min']):>7} {fmt(r['spearman_max']):>7} {fmt(r['kendall_median']):>7} {r['hot_top5_posts']:>5} {r['new_top5_posts']:>5} {fmt(r['hot_top5_hours_median'],1):>9} {fmt(r['hot_top5_hours_p90'],1):>9} {fmt(r['new_top5_hours_median'],1):>9} {r['reached_hot_top5_never_new_top5']:>8}")
    m = report["m3_m4"]
    print("\nM3 — Best on small n")
    for k in ("comments", "comments_only_author_vote", "sibling_groups", "groups_all_n_le_1", "groups_all_n_le_2", "groups_all_n_le_3", "groups_where_best_is_pure_tiebreak"):
        print(f"  {k:44} {m[k]}")
    print("M4 — Best without the author's +1 (Hot and Top unchanged)")
    for k in ("m4_groups_compared", "m4_groups_first_changes_without_author_plus_one"):
        print(f"  {k:44} {m[k]} of {m['sibling_groups'] if k.endswith('plus_one') else m['sibling_groups']} sibling groups" if k.endswith('plus_one') else f"  {k:44} {m[k]} (groups of ≥ 3, where τ is defined)")
    print(f"  {'m4_kendall_median_current_vs_without':44} {fmt(m['m4_kendall_median_current_vs_without'])}")
    print("\nM6 — the downvote gate against first downvotes")
    for k, v in report["m6"].items():
        print(f"  {k:44} {v if isinstance(v, int) else fmt(v, 1)}")
    print("\nM7 — pacing of non-flagged users")
    for k, v in report["m7"].items():
        print(f"  {k:44} {v if isinstance(v, int) else fmt(v, 1)}")


if __name__ == "__main__":
    main()

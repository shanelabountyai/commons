"""PRD 7.2 (D-100) section 2: the carried measurements that change no rule. Stdlib only; python3 -I tools/carried_measures.py

Test oracle, not product code. Prints one line per measurement over the frozen community fixture; docs/EVAL.md
section Phase 7 / 7.2 records them. Normal side = invented distribution (PRD 7.1 section 1); a real community's
rates are unknown.
"""
import bisect
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import community_text_lib as ct  # noqa: E402
from limitslib import downvote_allowed, is_young  # noqa: E402
from modlib import RULES as SWARM  # noqa: E402

D = 86400


def main():
    users = {u["id"]: int(u["created_at"]) for u in ct.read("users.csv")}
    ns = ct.nodes()
    live = [n for n in ns if n["status"] != "removed"]

    def contributions(min_chars):
        by = {}
        for n in live:
            if len(n["body"].strip()) >= min_chars:
                by.setdefault(n["author"], []).append(n["created_at"])
        for v in by.values():
            v.sort()
        return lambda u, t: bisect.bisect_left(by.get(u, []), t)

    # 1. min_contribution_chars: L-2 counting only contributions of >= N chars
    downs = [(v["voter"], int(v["cast_at"])) for v in ct.read("votes.csv") if v["value"] == "-1"]
    base = contributions(0)
    allowed = [(u, t) for u, t in downs if downvote_allowed(users[u], base(u, t), t)]
    per_n = []
    for n in (2, 3, 10, 20, 40):
        c = contributions(n)
        per_n.append(f"N={n} refuses {sum(1 for u, t in allowed if not downvote_allowed(users[u], c(u, t), t))}")
    attack = ["x", "x", "x"]  # a day-old account's three 1-char self-replies; "+1" is 2 chars and passes N=2
    print(f"min_contribution_chars: {len(downs)} community downvotes, {len(allowed)} allowed today; " + ", ".join(per_n)
          + f"; the 1-char attack: allowed today, refused at N>=2 ({sum(len(b) >= 2 for b in attack)} of 3 count)")

    # 2. report swarm over the organic reports
    reports = [(r["reporter"], r["node_id"], int(r["reported_at"])) for r in ct.read("community/reports.csv")]
    author = {n["id"]: n["author"] for n in ns}
    young = [r for r in reports if r[2] - users[r[0]] < SWARM["max_reporter_age_days"] * D]

    def peak(rs):
        best = 0
        for _, nid, t in rs:
            a = author[nid]
            best = max(best, len({rep for rep, n2, t2 in rs if author[n2] == a and t - SWARM["window_seconds"] < t2 <= t}))
        return best
    print(f"report swarm: {len(reports)} organic reports, {len(ct.swarms(ns))} REPORT_SWARM signals; {len(young)} from reporters under "
          f"{SWARM['max_reporter_age_days']} d, young peak {peak(young)} per author per window; any-age peak {peak(reports)} (threshold {SWARM['min_reporters']})")

    # 3. link hosts, the SME's other two candidates
    linked = sorted((n for n in ns if ct.hosts(n["body"])), key=lambda n: (n["created_at"], n["id"]))
    contrib = contributions(0)
    young_linked = sum(1 for n in linked if is_young(users[n["author"]], contrib(n["author"], n["created_at"]), n["created_at"]))
    fired, hosts = 0, set()
    for n in linked:
        hit = {h for h in ct.hosts(n["body"]) for m in linked
               if m["author"] != n["author"] and n["created_at"] - D < m["created_at"] <= n["created_at"] and h in ct.hosts(m["body"])}
        fired += bool(hit)
        hosts |= hit
    print(f"link hosts: {len(linked)} linked nodes; young_links_per_body 0 refuses {young_linked}; "
          f"same host by >=2 accounts in 24 h fires on {fired} nodes over {len(hosts)} hosts")

    # 4. repost windows over the organic reposts
    reposts = {r["post_id"]: r["original_id"] for r in ct.read("community/reposts.csv")}
    at = {n["id"]: n["created_at"] for n in ns}
    gaps = sorted((at[p] - at[o]) / 3600 for p, o in reposts.items())
    flags = []
    for w in (86400, 259200, 604800):
        flags.append(f"{w} s flags {sum(1 for nid, _ in ct.duplicates(ns, w) if nid in reposts)}")
    print(f"repost: {len(reposts)} organic reposts, gaps {gaps[0]:.1f}-{gaps[-1]:.1f} h; " + ", ".join(flags)
          + "; the attack (25 h apart) raises 0 at 86400 s and 6 at 604800 s (abuse:spam)")


if __name__ == "__main__":
    main()

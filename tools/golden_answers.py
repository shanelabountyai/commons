"""Golden ranking answers. Prints each case and ends with OK, or exits 1 naming the first failure.

Expected values were derived from the closed-form formulas in docs/domain-brief.md §3 and are
frozen here. Never edit an expected value to make a test pass (D-10).
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I drops the script dir
from rankinglib import hot, wilson_lower, top_window_includes
from treelib import seg, assign_paths, depth, ancestors, render
from limitslib import is_young, downvote_allowed, check as limit_check

T0 = 1_793_232_000  # 2026-10-29T00:00:00Z, fixture anchor (D-7)
H = 3600
cases = []

def check(cid, desc, got, want, tol=0.0):
    ok = (abs(got - want) <= tol) if isinstance(want, float) else (got == want)
    cases.append((cid, desc, got, want, ok))

# --- Hot: decay crossover (PRD P0-3) ---
# 50-vote post created at T0 vs 5-vote post created later. One order of magnitude = 12.5 h,
# so the 5-vote post ties at +12.5 h, loses before, wins after.
old = hot(50, 0, T0)
check("GH-01", "50 votes at T0 beats 5 votes at T0+12h", hot(5, 0, T0 + 12 * H) < old, True)
check("GH-02", "50 votes at T0 loses to 5 votes at T0+13h", hot(5, 0, T0 + 13 * H) > old, True)
check("GH-03", "50 votes at T0 loses to 5 votes at T0+24h (yesterday vs this hour)", hot(5, 0, T0 + 24 * H) > old, True)
check("GH-04", "crossover offset in seconds = 45000 (log10(50/5) * gravity)",
      round((old - hot(5, 0, T0)) * 45_000), 45_000)
check("GH-05", "net 0 and net -1 score the same (both log10 term 0)",
      hot(0, 0, T0) == hot(0, 1, T0), True)
check("GH-06", "net -10 ranks below net 0 at same time", hot(0, 10, T0) < hot(0, 0, T0), True)
check("GH-07", "hot ignores 'now': value for (50,0,T0)", old, 14650.6766811, 1e-7)  # (T0-HOT_EPOCH)/45000 = 14648.9777111, + log10(50) = 1.6989700

# --- Wilson 'Best' (PRD P0-3): small samples naive ratios get wrong ---
check("GW-01", "1 up / 1 vote (100%) ranks below 70 up / 100 votes (70%)",
      wilson_lower(1, 1) < wilson_lower(70, 100), True)
check("GW-02", "2 up / 2 votes ranks below 70 / 100", wilson_lower(2, 2) < wilson_lower(70, 100), True)
check("GW-03", "1 up / 2 votes ranks below 70 / 100", wilson_lower(1, 2) < wilson_lower(70, 100), True)
check("GW-04", "10 / 10 ranks above 70 / 100", wilson_lower(10, 10) > wilson_lower(70, 100), True)
check("GW-05", "0 votes scores 0.0", wilson_lower(0, 0), 0.0)
check("GW-06", "wilson(70,100)", wilson_lower(70, 100), 0.6042, 5e-5)
check("GW-07", "wilson(1,1)", wilson_lower(1, 1), 0.2065, 5e-5)
check("GW-08", "wilson(10,10)", wilson_lower(10, 10), 0.7225, 5e-5)

# --- Top windows ---
now = T0 + 7 * 24 * H
check("GT-01", "post exactly 24h old is in 'day'", top_window_includes(now - 86_400, now, "day"), True)
check("GT-02", "post 24h+1s old is not in 'day'", top_window_includes(now - 86_401, now, "day"), False)
check("GT-03", "future-dated post is in no window", top_window_includes(now + 1, now, "all"), False)

# --- Tree (GR-), brief §2 and D-13 ---
check("GR-01", "segment of ordinal 1 is 000001", seg(1), "000001")
check("GR-02", "segment of ordinal 36 is 000010", seg(36), "000010")
mini = [
    {"id": "a", "post_id": "p", "parent_id": "", "created_at": 10, "status": "visible"},
    {"id": "b", "post_id": "p", "parent_id": "a", "created_at": 11, "status": "deleted"},
    {"id": "c", "post_id": "p", "parent_id": "b", "created_at": 12, "status": "visible"},
    {"id": "d", "post_id": "p", "parent_id": "a", "created_at": 13, "status": "removed"},
    {"id": "e", "post_id": "p", "parent_id": "d", "created_at": 14, "status": "deleted"},
    {"id": "f", "post_id": "p", "parent_id": "", "created_at": 9, "status": "visible"},
]
paths = assign_paths(mini)
check("GR-03", "sibling ordinals follow (created_at, id): f is 000001, a is 000002", (paths["f"], paths["a"]), ("000001", "000002"))
check("GR-04", "c's path is a+b+c segments", paths["c"], "000002000001000001")
check("GR-05", "depth of c is 2", depth(paths["c"]), 2)
check("GR-06", "ancestors of c are a then b", ancestors(paths["c"]), [paths["a"], paths["b"]])
rows, n_top = render(mini, paths, lambda n: (n["created_at"], n["id"]))
ids = [r[0] for r in rows]
check("GR-07", "deleted b with a visible descendant renders as [deleted] in place", [r for r in rows if r[0] == "b"][0][2], "deleted")
check("GR-08", "removed d whose only child is a deleted leaf is omitted, and so is e", ("d" in ids, "e" in ids), (False, False))
check("GR-09", "comment totals still count omitted nodes: 6 comments, 4 rendered", (len(mini), len(rows)), (6, 4))
chain = [{"id": f"n{d}", "post_id": "p", "parent_id": "" if d == 0 else f"n{d-1}", "created_at": d, "status": "visible"} for d in range(9)]
cp = assign_paths(chain)
crow, _ = render(chain, cp, lambda n: (n["created_at"], n["id"]))
check("GR-10", "render cuts at depth 6: 7 rows, the depth-6 row carries continue_thread", (len(crow), crow[-1][1], crow[-1][3]), (7, 6, True))
many = [{"id": f"t{k:03d}", "post_id": "p", "parent_id": "", "created_at": k, "status": "visible"} for k in range(120)]
mp = assign_paths(many)
p2, n_top = render(many, mp, lambda n: (n["created_at"], n["id"]), page=2)
check("GR-11", "page 2 of 120 top-level comments starts at the 51st and holds 50", (n_top, p2[0][0], len(p2)), (120, "t050", 50))
p3, _ = render(many, mp, lambda n: (n["created_at"], n["id"]), page=3)
check("GR-12", "page 3 holds the last 20", len(p3), 20)

# --- Gates and limits (GL-), brief §3a, D-23, D-24 ---
check("GL-01", "age 23:59:59 with 5 contributions is young", is_young(T0, 5, T0 + 86399), True)
check("GL-02", "age exactly 24:00:00 with 5 contributions is not young", is_young(T0, 5, T0 + 86400), False)
check("GL-03", "age 30 d with 4 contributions is young", is_young(T0, 4, T0 + 30 * 86400), True)
check("GL-04", "age 30 d with 5 contributions is not young", is_young(T0, 5, T0 + 30 * 86400), False)
check("GL-05", "downvote refused at 23:59:59 even with 3 contributions", downvote_allowed(T0, 3, T0 + 86399), False)
check("GL-06", "downvote allowed at exactly 24 h with 3 contributions", downvote_allowed(T0, 3, T0 + 86400), True)
check("GL-07", "downvote refused with 2 contributions at any age", downvote_allowed(T0, 2, T0 + 400 * 86400), False)
check("GL-08", "young comment limit: 2 in 60 s allowed, third refused", limit_check([T0, T0 + 1], "comment", True, T0 + 2), ("refuse", 58))
check("GL-09", "retryAfter = oldest counted hit + window - now = 58", limit_check([T0, T0 + 1], "comment", True, T0 + 2)[1], 58)
check("GL-10", "a hit exactly 60 s old has left the window", limit_check([T0, T0 + 1], "comment", True, T0 + 60), ("allow", None))
check("GL-11", "a hit 59 s old is still counted", limit_check([T0, T0 + 1], "comment", True, T0 + 59)[0], "refuse")
check("GL-12", "retryAfter floor is 1 s", limit_check([T0 - 59, T0 - 59], "comment", True, T0)[1], 1)
check("GL-13", "regular comment limit is 6: 5 hits allow", limit_check([T0 + i for i in range(5)], "comment", False, T0 + 5)[0], "allow")
check("GL-14", "regular comment limit is 6: 6 hits refuse", limit_check([T0 + i for i in range(6)], "comment", False, T0 + 6)[0], "refuse")

failed = [c for c in cases if not c[4]]
for cid, desc, got, want, ok in cases:
    print(f"{'ok  ' if ok else 'FAIL'} {cid} {desc}: got {got!r} want {want!r}")
if failed:
    print(f"FAILED {failed[0][0]}")
    sys.exit(1)
print(f"{len(cases)} cases OK")

"""Golden ranking answers. Prints each case and ends with OK, or exits 1 naming the first failure.

Expected values were derived from the closed-form formulas in docs/domain-brief.md §3 and are
frozen here. Never edit an expected value to make a test pass (D-10).
"""
import math, os, sys
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
check("GL-15", "young upload window: first upload allowed", limit_check([], "upload", True, T0), ("allow", None))
check("GL-16", "young upload window: second upload 10 s later allowed", limit_check([T0], "upload", True, T0 + 10), ("allow", None))
check("GL-17", "young upload window: third refused, retryAfter = T0 + 3600 - (T0 + 20) = 3580", limit_check([T0, T0 + 10], "upload", True, T0 + 20), ("refuse", 3580))
check("GL-18", "regular upload window is 10 per hour: 9 hits allow, 10 refuse",
      (limit_check([T0 + i for i in range(9)], "upload", False, T0 + 9)[0], limit_check([T0 + i for i in range(10)], "upload", False, T0 + 10)[0]), ("allow", "refuse"))

# PRD 6.4 (D-93): the profile+post comment window and max_depth_written (depth per T-2: top level is 0)
from limitslib import replay_comments, MAX_DEPTH_WRITTEN  # noqa: E402
check("GL-23", "thread window 10/3600 s: 9 hits on the post allow, 10 refuse with retryAfter 3590",
      (limit_check([T0 + i for i in range(9)], "comment", False, T0 + 9, "profile+post"), limit_check([T0 + i for i in range(10)], "comment", False, T0 + 10, "profile+post")), (("allow", None), ("refuse", 3590)))
check("GL-24", "young thread window is 3: 2 hits allow, 3 refuse",
      (limit_check([T0, T0 + 100], "comment", True, T0 + 200, "profile+post")[0], limit_check([T0, T0 + 100, T0 + 200], "comment", True, T0 + 300, "profile+post")[0]), ("allow", "refuse"))
check("GL-25", "the window is per post: an 11th comment in the hour on another post is allowed",
      replay_comments([(T0 + 70 * i, "a", "P1" if i < 10 else "P2", 0) for i in range(11)], {"a": T0 - 30 * 86400}, lambda u, t: 100)[:2], (11, 0))
check("GL-26", "max_depth_written 32: a reply at depth 32 is allowed, at 33 refused with no retryAfter",
      (MAX_DEPTH_WRITTEN, replay_comments([(T0, "a", "P", 32), (T0 + 100, "a", "P", 33)], {"a": T0 - 30 * 86400}, lambda u, t: 100)), (32, (1, 1, None)))

# PRD 6.2 (D-87): per-post count and the pixel cap, through tools/uploadlib.py
from uploadlib import parse as upload_parse, per_post_allowed  # noqa: E402
from build_upload_fixtures import ihdr, png  # noqa: E402
check("GL-19", "a post holding 3 attachments takes a fourth", per_post_allowed(3), True)
check("GL-20", "a post holding 4 attachments refuses a fifth", per_post_allowed(4), False)
check("GL-21", "5000 x 5000 = 25 000 000 px, exactly max_pixels, is allowed", upload_parse("image/png", png(ihdr(5000, 5000)))["verdict"], "allow")
check("GL-22", "1 x 25 000 001 px, one over max_pixels, is refused", (upload_parse("image/png", png(ihdr(1, 25_000_001)))["verdict"], upload_parse("image/png", png(ihdr(1, 25_000_001)))["reason"]), ("refuse", "too_many_pixels"))

# PRD 5.2 (D-75): one case per signal scenario, from fixtures/signals/scenarios.json through signallib.
from signallib import detect, load_scenarios  # noqa: E402
_sc = {x["id"]: x for x in (load_scenarios(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures")) or [])}
_sig = lambda sid: sorted((s["kind"], s["voters"]) for s in detect(_sc[sid]))  # noqa: E731
check("GS-01", "8 young accounts upvote within 300 s -> one RING, 8 voters", _sig("S-RING"), [("RING", 8)])
check("GS-02", "the same 8 young upvotes over 3 h -> no signal", _sig("S-RING-SLOW"), [])
check("GS-03", "4 young + 10 mature upvotes -> no signal (only young accounts count)", _sig("S-RING-MIXED"), [])
check("GS-04", "exactly 6 young upvotes, last at +599 s -> RING; last at +600 s -> none", (_sig("S-RING-EDGE-IN"), _sig("S-RING-EDGE-OUT")), ([("RING", 6)], []))
check("GS-05", "7 gate-passing accounts under 7 d downvote within 600 s -> one AGED_BRIGADE, 7", _sig("S-AGED"), [("AGED_BRIGADE", 7)])
check("GS-06", "7 accounts 30+ d old downvote within 600 s -> no signal", _sig("S-AGED-ORGANIC"), [])
check("GS-07", "7 gated downvotes (D-31) -> one BRIGADE, 7 (unchanged by 5.2)", _sig("S-GATED"), [("BRIGADE", 7)])
check("GS-08", "ring + aged brigade on one node -> one of each, not merged", _sig("S-BOTH"), [("AGED_BRIGADE", 5), ("RING", 6)])

# Pending (PRD 5.3, D-63): proposed, computed and printed, NOT asserted or counted until a D- entry adopts them.
pending = [
    ("GH-08", "at gravity 90000 the 50-vote vs 5-vote crossover is log10(50/5) x 90000 = 90000 s",
     round(math.log10(50 / 5) * 90_000, 7), 90_000.0),
    ("GW-09", "Best without the author's +1: 1/1 -> wilson(0,0)=0; 2/2 -> wilson(1,1); 1/2 -> wilson(0,1)",
     (wilson_lower(0, 0), round(wilson_lower(1, 1), 4), round(wilson_lower(0, 1), 4)), (0.0, 0.2065, 0.0)),
]

failed = [c for c in cases if not c[4]]
for cid, desc, got, want, ok in cases:
    print(f"{'ok  ' if ok else 'FAIL'} {cid} {desc}: got {got!r} want {want!r}")
if failed:
    print(f"FAILED {failed[0][0]}")
    sys.exit(1)
for cid, desc, got, want in pending:
    print(f"pend {cid} {desc}: got {got!r} (proposed {want!r}; not asserted)")
print(f"{len(cases)} cases OK")

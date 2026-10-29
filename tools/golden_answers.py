"""Golden ranking answers. Prints each case and ends with OK, or exits 1 naming the first failure.

Expected values were derived from the closed-form formulas in docs/domain-brief.md §3 and are
frozen here. Never edit an expected value to make a test pass (D-10).
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I drops the script dir
from rankinglib import hot, wilson_lower, top_window_includes

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

failed = [c for c in cases if not c[4]]
for cid, desc, got, want, ok in cases:
    print(f"{'ok  ' if ok else 'FAIL'} {cid} {desc}: got {got!r} want {want!r}")
if failed:
    print(f"FAILED {failed[0][0]}")
    sys.exit(1)
print(f"{len(cases)} cases OK")

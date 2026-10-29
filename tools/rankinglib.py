"""Commons ranking oracle. Stdlib only; run with python3 -I.

Test oracle, not product code. The TypeScript engine in src/ranking/ is written from
docs/domain-brief.md §3 and must agree with this file on every golden case (D-9).
"""
import math

# Constants mirror rules/ranking.json (D-8). Changing one needs a decisions entry.
HOT_EPOCH = 1_134_028_003      # seconds; reddit's historical epoch, kept so values are comparable to published examples
HOT_GRAVITY_SECONDS = 45_000   # one order of magnitude of score is worth 12.5 hours of age
WILSON_Z = 1.959963984540054   # two-sided 95%


def hot(ups: int, downs: int, created_epoch_s: int) -> float:
    """Log-scaled net score plus a creation-time term. Independent of 'now'."""
    s = ups - downs
    order = math.log10(max(abs(s), 1))
    sign = 1 if s > 0 else -1 if s < 0 else 0
    seconds = created_epoch_s - HOT_EPOCH
    return round(sign * order + seconds / HOT_GRAVITY_SECONDS, 7)


def wilson_lower(ups: int, n: int, z: float = WILSON_Z) -> float:
    """Lower bound of the Wilson score interval for the up-vote proportion. n = ups + downs."""
    if n == 0:
        return 0.0
    phat = ups / n
    z2 = z * z
    return (phat + z2 / (2 * n) - z * math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n)) / (1 + z2 / n)


def top_window_includes(created_epoch_s: int, now_epoch_s: int, window: str) -> bool:
    """Top is net score within a window [now - w, now]. 'all' has no lower bound."""
    w = {"day": 86_400, "week": 604_800, "all": None}[window]
    return created_epoch_s <= now_epoch_s and (w is None or created_epoch_s >= now_epoch_s - w)

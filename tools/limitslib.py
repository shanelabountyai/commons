"""Commons gates and limits oracle (brief §3a L-1..L-5, D-15, D-23, D-24). Stdlib only; python3 -I.

Test oracle, not product code. Times are integer epoch seconds. Constants come from rules/limits.json.
"""
import json
import os

RULES = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "rules", "limits.json")))
YOUNG = RULES["young_account"]
GATE = RULES["downvote_gate"]
WINDOWS = {w["action"]: w for w in RULES["windows"]}


def is_young(account_created_at: int, contributions: int, now: int) -> bool:
    """L-1: age < 24 h OR contributions < 5. Both boundaries are strict."""
    return (now - account_created_at) < YOUNG["max_age_hours"] * 3600 or contributions < YOUNG["max_contributions"]


def downvote_allowed(account_created_at: int, contributions: int, now: int) -> bool:
    """L-2: age >= 24 h AND contributions >= 3."""
    return (now - account_created_at) >= GATE["min_age_hours"] * 3600 and contributions >= GATE["min_contributions"]


def check(history, action: str, young: bool, now: int):
    """L-3/L-4. history: iterable of epoch seconds of COUNTED (allowed) hits for this user+action.
    Returns ("allow", None) or ("refuse", retry_after_seconds)."""
    w = WINDOWS[action]
    per = w["per_seconds"]
    limit = w["young_max"] if young else w["max"]
    counted = sorted(t for t in history if now - per < t <= now)
    if len(counted) < limit:
        return "allow", None
    return "refuse", max(1, counted[0] + per - now)


def replay(attempts, action: str, account_created_at: int, contributions_at):
    """attempts: sorted epoch seconds. contributions_at(t) -> int. Returns (allowed, refused, first_retry_after)."""
    hist = []
    allowed = refused = 0
    first_retry = None
    for t in attempts:
        young = is_young(account_created_at, contributions_at(t), t)
        verdict, retry = check(hist, action, young, t)
        if verdict == "allow":
            hist.append(t)
            allowed += 1
        else:
            refused += 1
            if first_retry is None:
                first_retry = retry
    return allowed, refused, first_retry

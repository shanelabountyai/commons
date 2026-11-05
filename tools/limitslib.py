"""Commons gates and limits oracle (brief §3a L-1..L-5, D-15, D-23, D-24). Stdlib only; python3 -I.

Test oracle, not product code. Times are integer epoch seconds. Constants come from rules/limits.json.
"""
import json
import os

RULES = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "rules", "limits.json")))
YOUNG = RULES["young_account"]
GATE = RULES["downvote_gate"]
WINDOWS = {w["action"]: w for w in RULES["windows"] if w.get("scope", "profile") == "profile"}
# PRD 6.4 (D-93): rows scoped to (profile, post); the history is the member's own comments on that post
SCOPED = {w["action"]: w for w in RULES["windows"] if w.get("scope") == "profile+post"}
MAX_DEPTH_WRITTEN = RULES["max_depth_written"]


def is_young(account_created_at: int, contributions: int, now: int) -> bool:
    """L-1: age < 24 h OR contributions < 5. Both boundaries are strict."""
    return (now - account_created_at) < YOUNG["max_age_hours"] * 3600 or contributions < YOUNG["max_contributions"]


def downvote_allowed(account_created_at: int, contributions: int, now: int) -> bool:
    """L-2: age >= 24 h AND contributions >= 3."""
    return (now - account_created_at) >= GATE["min_age_hours"] * 3600 and contributions >= GATE["min_contributions"]


def check(history, action: str, young: bool, now: int, scope: str = "profile"):
    """L-3/L-4. history: iterable of epoch seconds of COUNTED (allowed) hits for this user+action (and post, when
    scope is "profile+post"). Returns ("allow", None) or ("refuse", retry_after_seconds)."""
    w = (WINDOWS if scope == "profile" else SCOPED)[action]
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


def replay_comments(attempts, accounts, contributions_at, scopes=("profile", "profile+post")):
    """PRD 6.4 (D-93). attempts: sorted (t, user, post, depth) comment attempts, depth per T-2 (top level 0).
    A depth past max_depth_written is refused first, with no retry_after, and spends no slot. Then each scope's
    comment row in order; the first refusal wins. An allowed attempt counts in every scope's history.
    Returns (allowed, refused, first_retry_after)."""
    hist = {}
    allowed = refused = 0
    first_retry = None
    for t, user, post, d in attempts:
        if d > MAX_DEPTH_WRITTEN:
            refused += 1
            continue
        young = is_young(accounts[user], contributions_at(user, t), t)
        keys = [(s, user, None if s == "profile" else post) for s in scopes]
        verdict, retry = "allow", None
        for k in keys:
            verdict, retry = check(hist.get(k, []), "comment", young, t, k[0])
            if verdict == "refuse":
                break
        if verdict == "allow":
            for k in keys:
                hist.setdefault(k, []).append(t)
            allowed += 1
        else:
            refused += 1
            if first_retry is None:
                first_retry = retry
    return allowed, refused, first_retry


def replay_links(attempts, accounts, contributions_at):
    """PRD 7.2 (D-100). attempts: sorted (t, user, k) bodies holding k >= 1 markdown links. The body asks the profile
    `link` window once per link, its own earlier links counting at t; the first refusal refuses the whole body and
    records nothing. An allowed body adds k hits at t. Returns (allowed, refused, first_retry_after), counted in bodies."""
    hist = {}
    allowed = refused = 0
    first_retry = None
    for t, user, k in attempts:
        young = is_young(accounts[user], contributions_at(user, t), t)
        h = list(hist.get(user, []))
        verdict, retry = "allow", None
        for _ in range(k):
            verdict, retry = check(h, "link", young, t)
            if verdict == "refuse":
                break
            h.append(t)
        if verdict == "allow":
            hist[user] = h
            allowed += 1
        else:
            refused += 1
            if first_retry is None:
                first_retry = retry
    return allowed, refused, first_retry

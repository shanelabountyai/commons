"""Commons report-swarm oracle (PRD 5.4 B, D-31). Stdlib only; python3 -I.

Test oracle, not product code; src/limits/report-swarm.ts is written from docs/prd/5.4-mod-queue-v2.md, not from
this file. Constants come from rules/moderation.json report_swarm. A report at t by a reporter whose account is
younger than max_reporter_age_days at t, on a node by author A, qualifies. Over (t - window_seconds, t], the
distinct qualifying reporters of A's nodes are counted; at >= min_reporters a signal for A whose window_start is
inside the window has its count updated, otherwise a new one opens with window_start = the first qualifying
report in the window. One reporter on many nodes is one reporter (the report window in rules/limits.json covers
that). Signals never change anything (D-31).
"""
import json
import os

RULES = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "rules", "moderation.json")))["report_swarm"]
D = 86400


def detect(scenario):
    """scenario: {accounts: [{id, created_at}], nodes: [{id, author}], reports: [{row, reporter, node_id, reported_at}]}.
    Returns [{author, reporters, window_start}] sorted by (author, window_start)."""
    created = {a["id"]: a["created_at"] for a in scenario["accounts"]}
    author_of = {n["id"]: n["author"] for n in scenario["nodes"]}
    reports = sorted(scenario["reports"], key=lambda r: (r["reported_at"], r["row"]))
    max_age = RULES["max_reporter_age_days"] * D
    w = RULES["window_seconds"]
    seen = {}  # author -> [(reporter, t)]
    signals = []
    for r in reports:
        t = r["reported_at"]
        if t - created[r["reporter"]] >= max_age:
            continue
        a = author_of[r["node_id"]]
        seen.setdefault(a, []).append((r["reporter"], t))
        since = t - w
        inwin = [(rep, tt) for rep, tt in seen[a] if since < tt <= t]
        reporters = {rep for rep, _ in inwin}
        if len(reporters) < RULES["min_reporters"]:
            continue
        existing = [s for s in signals if s["author"] == a and s["window_start"] > since]
        if existing:
            existing[0]["reporters"] = len(reporters)
        else:
            signals.append({"author": a, "reporters": len(reporters), "window_start": min(tt for _, tt in inwin)})
    return sorted(signals, key=lambda s: (s["author"], s["window_start"]))


def expected_rows(scenarios):
    rows = []
    for sc in scenarios:
        for s in detect(sc):
            rows.append({"scenario": sc["id"], "author": s["author"], "reporters": s["reporters"], "window_start": s["window_start"]})
    return rows


def load_scenarios(fix_dir):
    p = os.path.join(fix_dir, "moderation", "scenarios.json")
    return json.load(open(p))["scenarios"] if os.path.exists(p) else None

"""Commons vote-signal oracle (PRD 5.2, D-31, D-75). Stdlib only; python3 -I.

Test oracle, not product code; src/votes/signals.ts is written from docs/prd/5.2-vote-signals-as-data.md, not from
this file. Votes are reduced with votelib (same V-1..V-5 as the expected files). A signal is checked each time a
qualifying event is cast, over the window (t - window_seconds, t]:

  BRIGADE       qualifying = GATED_DOWNVOTE                                  (D-31)
  RING          qualifying = APPLIED +1 by a voter young (L-1) at cast time (5.2)
  AGED_BRIGADE  qualifying = APPLIED -1 by a voter younger than max_account_age_days at cast time (5.2)

If the distinct voters in the window reach min_voters: when a signal of the same kind on the same node has a
window_start inside the window, its voter count is updated; otherwise a new signal opens with window_start = the
first qualifying event in the window. Signals never change counts.
"""
import json
import os

from limitslib import RULES, is_young
from votelib import reduce_votes

SIG = RULES["signals"]
D = 86400


def _qualifies(kind, outcome, value, account_created_at, contributions, t):
    if kind == "BRIGADE":
        return outcome == "GATED_DOWNVOTE"
    if kind == "RING":
        return outcome == "APPLIED" and value == 1 and is_young(account_created_at, contributions, t)
    if kind == "AGED_BRIGADE":
        return outcome == "APPLIED" and value == -1 and (t - account_created_at) < SIG["aged_brigade"]["max_account_age_days"] * D
    raise ValueError(kind)


KINDS = {"BRIGADE": "brigade", "RING": "ring", "AGED_BRIGADE": "aged_brigade"}


def detect(scenario):
    """scenario: {accounts: [{id, created_at, contributions: [t...]}], nodes: [{id, author}], events: [{row, voter,
    node_id, value, cast_at}]}. Returns [{kind, node, voters, window_start}] sorted by (node, kind, window_start)."""
    accounts = {a["id"]: a["created_at"] for a in scenario["accounts"]}
    contribs = {a["id"]: sorted(a.get("contributions", [])) for a in scenario["accounts"]}

    def contributions_at(user, t):
        return sum(1 for x in contribs.get(user, []) if x < t)

    nodes = {n["id"]: n["author"] for n in scenario["nodes"]}
    events = sorted(scenario["events"], key=lambda e: (e["cast_at"], e["row"]))
    _, outcomes = reduce_votes(nodes, events, contributions_at, accounts)
    outcome_of = dict(outcomes)
    signals = []
    seen = {k: [] for k in KINDS}  # kind -> [(node, voter, t)]
    for i, e in enumerate(events):
        o = outcome_of[i]
        for kind, key in KINDS.items():
            if not _qualifies(kind, o, e["value"], accounts[e["voter"]], contributions_at(e["voter"], e["cast_at"]), e["cast_at"]):
                continue
            seen[kind].append((e["node_id"], e["voter"], e["cast_at"]))
            w = SIG[key]["window_seconds"]
            since = e["cast_at"] - w
            inwin = [(v, t) for (n, v, t) in seen[kind] if n == e["node_id"] and since < t <= e["cast_at"]]
            voters = {v for v, _ in inwin}
            if len(voters) < SIG[key]["min_voters"]:
                continue
            existing = [s for s in signals if s["kind"] == kind and s["node"] == e["node_id"] and s["window_start"] > since]
            if existing:
                existing[0]["voters"] = len(voters)
            else:
                signals.append({"kind": kind, "node": e["node_id"], "voters": len(voters), "window_start": min(t for _, t in inwin)})
    return sorted(signals, key=lambda s: (s["node"], s["kind"], s["window_start"]))


def expected_rows(scenarios):
    rows = []
    for sc in scenarios:
        for s in detect(sc):
            rows.append({"scenario": sc["id"], "kind": s["kind"], "node": s["node"], "voters": s["voters"], "window_start": s["window_start"]})
    return rows


def load_scenarios(fix_dir):
    p = os.path.join(fix_dir, "signals", "scenarios.json")
    return json.load(open(p))["scenarios"] if os.path.exists(p) else None

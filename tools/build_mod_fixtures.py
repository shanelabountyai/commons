"""Report-swarm scenario fixtures (PRD 5.4 B). Stdlib only; python3 -I tools/build_mod_fixtures.py --seed 20261102

Writes fixtures/moderation/scenarios.json: small self-contained scenarios (one author with a few nodes, a handful of
reporter accounts, timestamped reports) that pin rules/moderation.json report_swarm. Additive: the frozen community
fixture is not touched (rule 8). Expected signals are computed by tools/modlib.py and written by
tools/reference_rank.py --write-expected, which also hashes both files into MANIFEST.json.
"""
import argparse
import json
import os
import random

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "moderation")
T = 1_793_836_800  # the community fixture's eval instant (T0 + 7 d), shared with fixtures/signals
H, D = 3600, 86400


def scenario(sid, note, nodes=5):
    sc = {"id": sid, "note": note, "accounts": [{"id": "author", "created_at": T - 400 * D}], "nodes": [], "reports": []}
    for i in range(nodes):
        sc["nodes"].append({"id": f"N{i}", "author": "author"})
    return sc


def acct(sc, aid, age_s):
    sc["accounts"].append({"id": aid, "created_at": T - age_s})
    return aid


def report(sc, reporter, nid, t):
    sc["reports"].append({"row": len(sc["reports"]), "reporter": reporter, "node_id": nid, "reported_at": t})


def build(seed):
    rng = random.Random(seed)
    out = []

    sc = scenario("S-SWARM", "4 accounts 1-3 days old each report 2 of one author's posts inside 6 h")
    for i in range(4):
        r = acct(sc, f"f{i}", (1 + i % 3) * D)
        for j in range(2):
            report(sc, r, f"N{(i + j) % 5}", T + i * 5000 + j * 600 + rng.randint(0, 30))
    out.append(sc)

    sc = scenario("S-SWARM-GROWS", "5 fresh accounts: the 4th report opens the signal, the 5th 20 h later updates its count to 5")
    for i in range(4):
        report(sc, acct(sc, f"f{i}", 2 * D), f"N{i}", T + i * 300)
    report(sc, acct(sc, "f4", 2 * D), "N4", T + 20 * H)
    out.append(sc)

    sc = scenario("S-ORGANIC", "6 accounts 60-200 days old report the same author inside 1 h: no signal")
    for i in range(6):
        report(sc, acct(sc, f"o{i}", (60 + i * 28) * D), f"N{i % 5}", T + i * 400)
    out.append(sc)

    sc = scenario("S-UNDER", "3 fresh accounts inside 1 h: one under the threshold")
    for i in range(3):
        report(sc, acct(sc, f"f{i}", 2 * D), f"N{i}", T + i * 900)
    out.append(sc)

    sc = scenario("S-ONE-MANY", "one account 1 day old reports 8 nodes in 2 h: one reporter is not a swarm", nodes=8)
    r = acct(sc, "f0", D)
    for i in range(8):
        report(sc, r, f"N{i}", T + i * 800)
    out.append(sc)

    sc = scenario("S-WINDOW-EDGE", "4 fresh accounts; the 4th report is exactly window_seconds after the first, which has left the window")
    for i, dt in enumerate([0, 3 * H, 9 * H, 24 * H]):
        report(sc, acct(sc, f"f{i}", 2 * D), f"N{i}", T + dt)
    out.append(sc)

    sc = scenario("S-AGE-EDGE", "3 fresh accounts and a 4th exactly max_reporter_age_days old at its report: not younger, no signal")
    for i in range(3):
        report(sc, acct(sc, f"f{i}", 2 * D), f"N{i}", T + i * 300)
    report(sc, acct(sc, "e", 7 * D - 1000), "N3", T + 1000)
    out.append(sc)

    sc = scenario("S-MIXED", "3 fresh accounts and 3 old ones inside 1 h: the old ones do not count")
    for i in range(3):
        report(sc, acct(sc, f"f{i}", 2 * D), f"N{i}", T + i * 300)
    for i in range(3):
        report(sc, acct(sc, f"o{i}", 90 * D), f"N{i}", T + 1000 + i * 300)
    out.append(sc)

    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261102)
    a = ap.parse_args()
    scs = build(a.seed)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "scenarios.json"), "w") as f:
        json.dump({"version": 1, "seed": a.seed, "instant": T, "scenarios": scs}, f, indent=1)
        f.write("\n")
    print(f"{len(scs)} scenarios -> fixtures/moderation/scenarios.json ({sum(len(s['reports']) for s in scs)} reports)")

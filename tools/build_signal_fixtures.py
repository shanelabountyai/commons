"""Vote-signal scenario fixtures (PRD 5.2, D-75). Stdlib only; python3 -I tools/build_signal_fixtures.py --seed 20261101

Writes fixtures/signals/scenarios.json: small self-contained scenarios (a few accounts, one or two nodes, timestamped
vote events) that pin the RING, AGED_BRIGADE and BRIGADE thresholds in rules/limits.json. Additive: the frozen
community fixture is not touched (rule 8). Expected signals are computed by tools/signallib.py and written by
tools/reference_rank.py --write-expected, which also hashes both files into MANIFEST.json.
"""
import argparse
import json
import os
import random

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "signals")
T = 1_793_836_800  # the community fixture's eval instant (T0 + 7 d), so the two sets share a clock
H, D = 3600, 86400


def scenario(sid, note, rng):
    return {"id": sid, "note": note, "accounts": [{"id": "author", "created_at": T - 400 * D, "contributions": [T - 300 * D + i for i in range(20)]}], "nodes": [], "events": [], "_rng": rng}


def acct(sc, aid, age_s, contributions):
    """contributions: count of authored items, spread over the account's life before T."""
    created = T - age_s
    step = max(1, (age_s - 60) // max(1, contributions))
    sc["accounts"].append({"id": aid, "created_at": created, "contributions": [created + 30 + i * step for i in range(contributions)]})
    return aid


def node(sc, nid):
    sc["nodes"].append({"id": nid, "author": "author"})
    return nid


def vote(sc, voter, nid, value, t):
    sc["events"].append({"row": len(sc["events"]), "voter": voter, "node_id": nid, "value": value, "cast_at": t})


def build(seed):
    rng = random.Random(seed)
    out = []

    sc = scenario("S-RING", "8 accounts 2 h old upvote one post within 300 s", rng)
    p = node(sc, "N-RING")
    for i in range(8):
        vote(sc, acct(sc, f"r{i}", 2 * H, 0), p, 1, T + i * 40 + rng.randint(0, 5))
    out.append(sc)

    sc = scenario("S-RING-SLOW", "the same 8 young upvotes spread over 3 h", rng)
    p = node(sc, "N-RING-SLOW")
    for i in range(8):
        vote(sc, acct(sc, f"r{i}", 2 * H, 0), p, 1, T + i * 1500)
    out.append(sc)

    sc = scenario("S-RING-MIXED", "4 young + 10 mature accounts upvote within 300 s", rng)
    p = node(sc, "N-RING-MIXED")
    for i in range(4):
        vote(sc, acct(sc, f"y{i}", 2 * H, 0), p, 1, T + i * 20)
    for i in range(10):
        vote(sc, acct(sc, f"m{i}", 90 * D, 12), p, 1, T + 100 + i * 15)
    out.append(sc)

    sc = scenario("S-RING-EDGE-IN", "exactly 6 young upvotes, the last 599 s after the first", rng)
    p = node(sc, "N-RING-EDGE-IN")
    times = [0, 100, 200, 300, 400, 599]
    for i, dt in enumerate(times):
        vote(sc, acct(sc, f"r{i}", 3 * H, 1), p, 1, T + dt)
    out.append(sc)

    sc = scenario("S-RING-EDGE-OUT", "exactly 6 young upvotes, the last 600 s after the first (the first has left the window)", rng)
    p = node(sc, "N-RING-EDGE-OUT")
    times = [0, 100, 200, 300, 400, 600]
    for i, dt in enumerate(times):
        vote(sc, acct(sc, f"r{i}", 3 * H, 1), p, 1, T + dt)
    out.append(sc)

    sc = scenario("S-AGED", "7 accounts 3-6 days old with 3 short replies each downvote one post within 600 s", rng)
    p = node(sc, "N-AGED")
    for i in range(7):
        vote(sc, acct(sc, f"a{i}", (3 + i % 4) * D, 3), p, -1, T + i * 70 + rng.randint(0, 9))
    out.append(sc)

    sc = scenario("S-AGED-ORGANIC", "7 accounts 30+ days old downvote one post within 600 s", rng)
    p = node(sc, "N-AGED-ORGANIC")
    for i in range(7):
        vote(sc, acct(sc, f"o{i}", (30 + i * 9) * D, 8), p, -1, T + i * 70)
    out.append(sc)

    sc = scenario("S-GATED", "7 accounts 1 h old downvote one post within 600 s (D-31, unchanged)", rng)
    p = node(sc, "N-GATED")
    for i in range(7):
        vote(sc, acct(sc, f"g{i}", H, 0), p, -1, T + i * 80)
    out.append(sc)

    sc = scenario("S-BOTH", "a ring and an aged brigade on the same post: one signal of each, not merged", rng)
    p = node(sc, "N-BOTH")
    for i in range(6):
        vote(sc, acct(sc, f"r{i}", 2 * H, 0), p, 1, T + i * 30)
    for i in range(5):
        vote(sc, acct(sc, f"a{i}", 4 * D, 3), p, -1, T + 200 + i * 40)
    out.append(sc)

    for s in out:
        del s["_rng"]
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261101)
    a = ap.parse_args()
    scs = build(a.seed)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "scenarios.json"), "w") as f:
        json.dump({"version": 1, "seed": a.seed, "instant": T, "scenarios": scs}, f, indent=1)
        f.write("\n")
    print(f"{len(scs)} scenarios -> fixtures/signals/scenarios.json ({sum(len(s['events']) for s in scs)} vote events)")

"""Commons vote-event reducer oracle (brief §2b V-1..V-5, D-12, D-15). Stdlib only; python3 -I.

Vote rows are events (voter, node_id, value in +1|-1, cast_at, note). Reduced in (cast_at, row order):
  V-1 the author's +1 is written at node creation and is fixed: any later event by the author on the own node
      is refused SELF_VOTE (so no self-downvote, no self-unvote).
  V-2 a -1 by a voter who fails L-2 at cast_at is refused GATED_DOWNVOTE and changes nothing.
  V-3 same value as the voter's current vote -> toggle off (current becomes 0).
  V-4 different value -> switch.
  V-5 counts = number of current +1 and -1 per node; ups includes the author's +1.
"""
from limitslib import downvote_allowed


def reduce_votes(nodes, votes, contributions_at, accounts):
    """nodes: {id: author}. votes: list in file order. accounts: {user: created_at}.
    Returns (counts {node: (ups, downs)}, outcomes [(row_index, outcome)]) where outcome in
    APPLIED|TOGGLED_OFF|SWITCHED|SELF_VOTE|GATED_DOWNVOTE|UNKNOWN_NODE."""
    current = {}  # (voter, node) -> +1|-1|0
    outcomes = []
    for nid, author in nodes.items():
        current[(author, nid)] = 1
    for i, v in sorted(enumerate(votes), key=lambda p: (p[1]["cast_at"], p[0])):
        voter, nid, val, t = v["voter"], v["node_id"], int(v["value"]), int(v["cast_at"])
        if nid not in nodes:
            outcomes.append((i, "UNKNOWN_NODE"))
            continue
        if nodes[nid] == voter:
            outcomes.append((i, "SELF_VOTE"))
            continue
        if val == -1 and not downvote_allowed(accounts[voter], contributions_at(voter, t), t):
            outcomes.append((i, "GATED_DOWNVOTE"))
            continue
        cur = current.get((voter, nid), 0)
        if cur == val:
            current[(voter, nid)] = 0
            outcomes.append((i, "TOGGLED_OFF"))
        elif cur == 0:
            current[(voter, nid)] = val
            outcomes.append((i, "APPLIED"))
        else:
            current[(voter, nid)] = val
            outcomes.append((i, "SWITCHED"))
    counts = {nid: [0, 0] for nid in nodes}
    for (voter, nid), val in current.items():
        if val == 1:
            counts[nid][0] += 1
        elif val == -1:
            counts[nid][1] += 1
    return {k: tuple(v) for k, v in counts.items()}, outcomes

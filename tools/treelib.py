"""Commons tree oracle (brief §2 T-1..T-7, D-13). Stdlib only; run with python3 -I.

Test oracle, not product code. src/tree/ is written from the brief and must agree with this on GR-.
Nodes are dicts: id, post_id, parent_id ('' for top level), created_at, status in visible|deleted|removed.
"""

SEG = 6
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
MAX_DEPTH_RENDERED = 6
PAGE_SIZE = 50


def seg(n: int) -> str:
    """Fixed-width base-36 segment for the 1-based ordinal n among siblings."""
    if n < 1 or n >= 36 ** SEG:
        raise ValueError("ordinal out of range")
    out = ""
    while n:
        out = ALPHABET[n % 36] + out
        n //= 36
    return out.rjust(SEG, "0")


def assign_paths(comments):
    """comments: list of node dicts for ONE post, any order. Returns {id: path}; ordinal = creation order
    among siblings (created_at, id). Depth = len(path)//SEG - 1."""
    by_parent = {}
    for c in comments:
        by_parent.setdefault(c["parent_id"], []).append(c)
    paths = {}

    def walk(parent_id, prefix):
        kids = sorted(by_parent.get(parent_id, []), key=lambda c: (c["created_at"], c["id"]))
        for n, c in enumerate(kids, 1):
            paths[c["id"]] = prefix + seg(n)
            walk(c["id"], paths[c["id"]])

    walk("", "")
    for c in comments:
        if c["id"] not in paths:
            raise ValueError(f"TREE_INVALID: {c['id']} parent {c['parent_id']} not in post")
    return paths


def depth(path: str) -> int:
    return len(path) // SEG - 1


def ancestors(path: str):
    """Paths of the ancestors, root-most first (excludes the node itself)."""
    return [path[: SEG * k] for k in range(1, len(path) // SEG)]


def has_visible_descendant(node_id, by_parent, status):
    stack = list(by_parent.get(node_id, []))
    while stack:
        c = stack.pop()
        if status[c] == "visible":
            return True
        stack.extend(by_parent.get(c, []))
    return False


def render(comments, paths, order_key, page=1, max_depth=MAX_DEPTH_RENDERED, page_size=PAGE_SIZE):
    """Rows for one thread page: (id, depth, rendered_as, continue_thread).
    rendered_as in body|deleted|removed. Omitted nodes (D-13 leaf rule) and nodes below the cut are absent.
    order_key(node) orders siblings; ties are broken by (created_at desc, id asc) by the caller's key.
    """
    status = {c["id"]: c["status"] for c in comments}
    by_id = {c["id"]: c for c in comments}
    by_parent = {}
    for c in comments:
        by_parent.setdefault(c["parent_id"], []).append(c["id"])

    def shown(nid):
        return status[nid] == "visible" or has_visible_descendant(nid, by_parent, status)

    def ordered(parent_id):
        return sorted((n for n in by_parent.get(parent_id, []) if shown(n)), key=lambda n: order_key(by_id[n]))

    top = ordered("")
    start = (page - 1) * page_size
    rows = []

    def emit(nid, d):
        kids = ordered(nid)
        cont = d == max_depth and len(kids) > 0
        rows.append((nid, d, {"visible": "body"}.get(status[nid], status[nid]), cont))
        if not cont:
            for k in kids:
                emit(k, d + 1)

    for nid in top[start : start + page_size]:
        emit(nid, 0)
    return rows, len(top)


def permalink(comments, paths, order_key, node_id, max_depth=MAX_DEPTH_RENDERED):
    """Ancestor ids root-most first, then the subtree rows of node_id rendered as depth 0 with the cut."""
    by_id = {c["id"]: c for c in comments}
    anc_paths = ancestors(paths[node_id])
    inv = {p: i for i, p in paths.items()}
    anc = [inv[p] for p in anc_paths]
    # re-root: treat node_id as the only top-level item
    sub = [c for c in comments if paths[c["id"]].startswith(paths[node_id])]
    rerooted = []
    for c in sub:
        d = dict(c)
        if c["id"] == node_id:
            d["parent_id"] = ""
        rerooted.append(d)
    rows, _ = render(rerooted, None, order_key, 1, max_depth, 1)
    return anc, rows

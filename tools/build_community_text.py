"""Community text, organic reports and reposts (PRD 7.1, D-98). Stdlib only; python3 -I tools/build_community_text.py --seed 20261104

Additive: reads users/posts/comments.csv read-only and draws from its own random.Random(seed), so build_fixtures.py's
stream and the 22 frozen files are untouched (rule 8). Writes fixtures/community/bodies.csv (title and body per node),
reports.csv (organic reports) and reposts.csv (the 10 wrong-board reposts: the duplicate check's false-positive side).
The rates below were fixed in PRD 7.1 §1 before any measurement. They are invented: a real community's are unknown.
tools/verify_fixtures.py rebuilds all three in memory and compares bytes.
"""
import argparse
import csv
import io
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "..", "fixtures")
OUT = os.path.join(FIX, "community")
NOW = 1_793_232_000 + 7 * 86400  # the community fixture's eval instant (T0 + 7 d)
H, D = 3600, 86400

SHORT_COMMENTS, LINK_POSTS, LINK_COMMENTS, REPOSTS, REPORTS_PER = 0.08, 0.15, 0.05, 10, 100  # PRD 7.1 §1
POST_LEN, COMMENT_LEN, SHORT_LEN = (200, 1500), (40, 600), (2, 20)

# 12 fictional hosts (RFC 2606 .example), weighted toward docs and wikis
HOSTS = [("docs.rackhand.example", 6), ("wiki.homelab.example", 6), ("docs.meshgate.example", 5), ("wiki.nasfolk.example", 5),
         ("docs.pifarm.example", 4), ("wiki.selfhostwiki.example", 4), ("kb.vlanworks.example", 3), ("manual.coldaisle.example", 3),
         ("forum.patchbay.example", 1), ("blog.idlewatts.example", 1), ("git.tinystack.example", 1), ("paste.lanparty.example", 1)]
REASONS = [("spam", 4), ("off_topic", 3), ("duplicate", 3), ("other", 2), ("harassment", 1), ("malware", 1), ("doxxing", 1)]

SHORT = ["+1", "Same here.", "Fixed it, thanks.", "This.", "Following.", "Bookmarked.", "Nice build!", "Seconding this.",
         "Same issue here.", "Thanks!", "Worked for me.", "ok", "Great writeup.", "Did you solve it?", "Any update?", "Saved."]
THING = {
    "selfhosting": ["Nextcloud container", "reverse proxy", "Jellyfin VM", "backup job", "photo library", "password vault", "Git server", "Matrix bridge"],
    "networking": ["VLAN trunk", "WireGuard tunnel", "OPNsense box", "managed switch", "DNS resolver", "mesh access point", "10G uplink", "guest SSID"],
    "hardware": ["ZFS pool", "HBA card", "UPS", "mini PC", "rack shelf", "SFP+ NIC", "used Xeon box", "drive cage"],
    "sbc": ["Pi 4", "Pi 5", "SD card", "NVMe hat", "PoE hat", "RISC-V board", "Pi cluster", "USB SSD"],
    "help": ["Docker host", "Proxmox node", "cron job", "TLS cert", "NFS share", "LXC container", "boot drive", "static lease"],
    "meta": ["flair list", "board rules", "mod queue", "wiki page", "search page", "weekly thread", "report button", "new-user gate"],
}
ISSUE = ["drops off the network", "runs hot at idle", "won't survive a reboot", "fills the disk overnight", "pegs one core",
         "times out under load", "loses its config", "throws checksum errors", "boots to a blank screen", "ignores the firewall rule",
         "draws more power than expected", "stalls after an update", "logs nothing useful", "is slow over the VPN"]
WHEN = ["after the last update", "since I moved it", "every few days", "only at night", "when the backup runs", "on cold boot",
        "after a power cut", "once a week", "under any real load", "since I changed the MTU"]
SENT = [
    "My {t} {i} {w}.", "I tried swapping the {t2} and it still {i}.", "The {t} sits on its own VLAN behind the {t2}.",
    "Idle draw is about {n} W with the {t} attached.", "I checked the logs and the {t} {i} {w}.",
    "Rolling back fixed it for about {n} hours.", "The {t2} was fine for {n} days before this started.",
    "Has anyone run a {t} next to a {t2} like this?", "I am on the current release and rebuilt the {t} twice.",
    "Moving the {t} off the {t2} made no difference.", "It took me {n} evenings to rule out the cabling.",
    "For reference, the {t} is about {n} months old.", "Next step is a clean install of the {t2}.",
    "Pinning the {t} to an older version stopped it.", "A cheap {t2} solved the same thing for me.",
    "Check whether the {t} {i} when the {t2} is unplugged.", "Mine {i} too, {w}.",
    "I would put the {t} on a UPS before chasing software.", "That {t2} is known to run warm; add airflow first.",
    "Good writeup, the part about the {t} saved me {n} hours.",
]
LINK = ["The guide I followed is [here]({u}).", "See [the {t} notes]({u}) for the steps.", "This page helped: [{t} setup]({u}).",
        "Docs: [{t}]({u})."]
PATHS = ["guides", "howto", "wiki", "notes", "kb", "faq"]


def read(name):
    with open(os.path.join(FIX, name), newline="") as f:
        return list(csv.DictReader(f))


def norm(s):
    return " ".join(s.lower().split())


def weighted(rng, pairs):
    return rng.choices([p for p, _ in pairs], [w for _, w in pairs])[0]


def sentence(rng, board):
    t, t2 = rng.sample(THING[board], 2)
    return rng.choice(SENT).format(t=t, t2=t2, i=rng.choice(ISSUE), w=rng.choice(WHEN), n=rng.randint(2, 90))


def link(rng, board):
    u = f"https://{weighted(rng, HOSTS)}/{rng.choice(PATHS)}/{rng.choice(THING[board]).lower().replace(' ', '-')}-{rng.randint(1, 999)}"
    return rng.choice(LINK).format(u=u, t=rng.choice(THING[board]))


def text(rng, board, lo, hi, with_link, paragraphs):
    tail = link(rng, board) if with_link else ""
    cap = hi - len(tail) - 20  # room for the joins and paragraph breaks
    target, out = rng.randint(lo, cap), []
    while len(" ".join(out)) < target:
        s = sentence(rng, board)
        if len(" ".join(out + [s])) > cap:
            break
        out.append(s)
    if tail:
        out.append(tail)
    if not paragraphs:
        return " ".join(out)
    paras, i = [], 0
    while i < len(out):
        k = rng.randint(2, 4)
        paras.append(" ".join(out[i:i + k]))
        i += k
    return "\n\n".join(paras)


def unique(rng, seen, make):
    while True:
        s = make()
        if norm(s) not in seen:
            seen.add(norm(s))
            return s


def build(seed):
    rng = random.Random(seed)
    users = {u["id"]: int(u["created_at"]) for u in read("users.csv")}
    posts = sorted(read("posts.csv"), key=lambda p: p["id"])
    comments = sorted(read("comments.csv"), key=lambda c: c["id"])
    board_of = {p["id"]: p["board"] for p in posts}

    # organic reposts: disjoint pairs, same author, another board, 1-72 h later
    cands = []
    for a in posts:
        for b in posts:
            dt = int(b["created_at"]) - int(a["created_at"])
            if a["author"] == b["author"] and a["board"] != b["board"] and H <= dt <= 72 * H:
                cands.append((b["id"], a["id"]))
    rng.shuffle(cands)
    pairs, used = [], set()
    for b, a in cands:
        if len(pairs) < REPOSTS and a not in used and b not in used:
            pairs.append((b, a))
            used |= {a, b}
    pairs.sort()
    assert len(pairs) == REPOSTS, len(pairs)
    repost_of = dict(pairs)

    # originals and reposts carry no link, so the realized link rate is exactly the drawn set
    link_posts = set(rng.sample([p["id"] for p in posts if p["id"] not in used], round(LINK_POSTS * len(posts))))
    cids = [c["id"] for c in comments]
    short = set(rng.sample(cids, round(SHORT_COMMENTS * len(cids))))
    link_comments = set(rng.sample([c for c in cids if c not in short], round(LINK_COMMENTS * len(cids))))

    titles, seen, rows = set(), set(), {}
    for p in posts:
        if p["id"] in repost_of:
            continue
        bd = p["board"]
        title = unique(rng, titles, lambda: f"{rng.choice(THING[bd])} {rng.choice(ISSUE)} {rng.choice(WHEN)}")
        body = unique(rng, seen, lambda: text(rng, bd, *POST_LEN, p["id"] in link_posts, True))
        rows[p["id"]] = (title[0].upper() + title[1:], body)
    for b, a in pairs:
        rows[b] = rows[a]
    for c in comments:
        if c["id"] in short:
            rows[c["id"]] = ("", rng.choice(SHORT))
        else:
            bd = board_of[c["post_id"]]
            rows[c["id"]] = ("", unique(rng, seen, lambda: text(rng, bd, *COMMENT_LEN, c["id"] in link_comments, False)))

    # organic reports: 1 per 100 nodes, plus 1-3 on each removed node; reporters older than the node, never its author
    nodes = [(p["id"], p["author"], int(p["created_at"]), p["status"]) for p in posts] + \
            [(c["id"], c["author"], int(c["created_at"]), c["status"]) for c in comments]
    accounts = sorted(users.items(), key=lambda kv: kv[0])
    reports, pairs_seen = [], set()

    def report(nid, author, created):
        pool = [u for u, t in accounts if t < created and u != author and (u, nid) not in pairs_seen]
        u = rng.choice(pool)
        pairs_seen.add((u, nid))
        reports.append((u, nid, weighted(rng, REASONS), created + rng.randint(60, min(3 * D, NOW - created))))

    for nid, author, created, _ in rng.sample(nodes, round(len(nodes) / REPORTS_PER)):
        report(nid, author, created)
    for nid, author, created, status in nodes:
        if status == "removed":
            for _ in range(rng.randint(1, 3)):
                report(nid, author, created)
    reports.sort(key=lambda r: (r[3], r[1], r[0]))

    def to_csv(header, data):
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(header)
        w.writerows(data)
        return buf.getvalue()

    return {
        "community/bodies.csv": to_csv(["node_id", "title", "body"], [(n[0], *rows[n[0]]) for n in nodes]),
        "community/reports.csv": to_csv(["reporter", "node_id", "reason", "reported_at"], reports),
        "community/reposts.csv": to_csv(["post_id", "original_id"], pairs),
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261104)
    a = ap.parse_args()
    files = build(a.seed)
    os.makedirs(OUT, exist_ok=True)
    for name, body in files.items():
        with open(os.path.join(FIX, name), "w", newline="") as f:
            f.write(body)
        print(f"{name}: {len(read(name))} rows")

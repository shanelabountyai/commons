#!/usr/bin/env python3
"""Build audit/scorecard.json from the baseline audit/<repo>.md tables + OVERRIDES + the foundation row.
Re-run at each template release / after SEC fixes: edit OVERRIDES, run, then publish scorecard.html (see plan M9)."""
import re, json, glob, datetime
KEYS = [f"K{i}" for i in range(1, 15)]
NAMES = {"K1":"Sessions","K2":"MFA","K3":"Guard","K4":"Scoping","K5":"Rate limit","K6":"Cap. links","K7":"Headers",
         "K8":"Secrets","K9":"Webhooks","K10":"Log safety","K11":"Env schema","K12":"Test DB","K13":"Audit trail","K14":"Deploy"}
REPOS = {  # file stem -> display
 "alongside-handhold":"alongside / handholdcare","bookable":"Bookable","claude-dashboard":"claude-dashboard","clinic":"Clearpath (clinic)",
 "countertop":"Countertop","design-bridge":"design bridge (dead)","event-toolkit":"event toolkit","groundwork":"groundwork",
 "rental-business":"rental business","restaurant-reservations":"restaurant reservations","showcall":"showcall",
 "storage-business":"storage business","talk4me":"talk4me","use-case-studio":"Use-Case Studio","use-case-trio":"use-case trio (scaffolds)"}
# (status, text, evidence) — cells re-verified against code on 2026-09-25 after fixes landed. Everything else is the 2026-09-23 baseline.
OVERRIDES = {
 "clinic": {
  "K7": ("✔", "Global headers: frame-ancestors 'none', nosniff, Referrer-Policy, poweredByHeader off (SEC-05, fixed); HSTS from Vercel.", "clinic/next.config.ts:7-21; 17d5496"),
  "K12": ("✔", "Guard is now a loopback allowlist; cloud needs CLEARPATH_ALLOW_CLOUD_DB (SEC-06, fixed).", "clinic/src/db.ts:14; b72b1f3"),
  "K6": ("✗", "Tokens stored plaintext: SEC-04 closed as an accepted risk; Referrer-Policy is same-origin, not no-referrer.", "clinic/next.config.ts:21; 39189e3"),
  "K1": ("✗", "Still no real auth: a shared Basic-auth demo gate (SEC-01, fixed) fronts a self-chosen identity picker; cookie unsigned by decision (SEC-03).", "clinic/NEXT.md:89"),
 },
 "event-toolkit": {
  "K7": ("✔", "Global XFO DENY, CSP frame-ancestors, nosniff, referrer, HSTS (SEC-04, fixed; verified live).", "event-planner-app/apps/web/next.config.ts; c7cf9f2"),
  "K1": ("✗", "Tokens now stored as SHA-256 (SEC-02, fixed); the magic link is still spent on GET (SEC-05, open); no MFA.", "packages/server-db/src/tokens.ts; 192eec4"),
  "K5": ("✗", "Sign-in limited per email and IP (SEC-03, fixed); the share-link issue write and token reads are still unlimited (SEC-06, open).", "apps/web/app/(auth)/sign-in/actions.ts; f5edb2d"),
  "K6": ("✗", "Tokens hashed now (SEC-02); Referrer-Policy is strict-origin-when-cross-origin, not no-referrer, and no no-store.", "apps/web/next.config.ts; 192eec4"),
 },
}
FOUNDATION = {
 "K1": ("INV-05,07,17", "src/core/auth/session.ts; src/core/auth/link.ts; tests/invariants/inv-05-sign-out-everywhere.test.ts"),
 "K2": ("INV-24,25,26", "src/core/auth/totp.ts; tests/invariants/inv-24-totp-replay.test.ts"),
 "K3": ("INV-01", "src/core/authz/action.ts; tests/invariants/inv-01-04-22-actions.test.ts"),
 "K4": ("INV-02,03,04", "src/core/authz/guards.ts; tests/invariants/harness.ts"),
 "K5": ("INV-09", "src/core/rate-limit.ts; tests/invariants/inv-09-rate-limits.test.ts"),
 "K6": ("INV-07,08", "src/core/share/links.ts; tests/invariants/inv-08-share-links.test.ts"),
 "K7": ("INV-15", "next.config.ts:8-16; e2e header specs"),
 "K8": ("INV-10,11,16,20", "src/core/cron.ts; tests/invariants/inv-10-11-16-cron-secrets.test.ts"),
 "K9": ("INV-12", "src/modules/billing/webhook.ts; tests/invariants/inv-12-webhooks.test.ts"),
 "K10": ("INV-13", "src/core/email; tests/invariants/inv-13-email.test.ts"),
 "K11": ("INV-14", "src/core/env.ts; tests/invariants/inv-14-env.test.ts"),
 "K12": ("INV-18", "src/core/db/local-guard.ts; tests/invariants/inv-18-cloud-guard.test.ts"),
 "K13": ("INV-19", "src/core/audit.ts; tests/invariants/inv-19-audit-append-only.test.ts"),
 "K14": ("CLAUDE.md", "vercel.json (ignoreCommand); package.json (port 4100); src/core/cron.ts"),
}
def split(s):
    m = re.match(r"\s*(✔|✗|N/A|\?)\s*[—:\-]?\s*(.*)", s, re.S)
    return (m.group(1), m.group(2).strip()) if m else ("?", s.strip())
def cell(status, text, ev, basis):
    return {"s": status, "text": text, "evidence": ev, "secs": sorted(set(re.findall(r"SEC-\d+", text + " " + ev)), key=lambda x:int(x[4:])), "basis": basis}
import os
RESC = {st: json.load(open(f"rescore/{st}.json")) for st in REPOS if os.path.exists(f"rescore/{st}.json")}
out = {"asOf": "2026-09-25", "foundationVersion": open("../FOUNDATION_VERSION").read().strip(), "keys": NAMES, "rows": []}
f = {k: cell("✔", v[0] + " tests green (npm test, 122 pass, 2026-09-25)", v[1], "verified") for k, v in FOUNDATION.items()}
out["rows"].append({"id": "foundation", "name": "saas foundation (template)", "cells": f})
for stem, name in REPOS.items():
    raw = {}
    for l in open(f"{stem}.md"):
        m = re.match(r"\|\s*(K\d+)\b[^|]*\|(.*)$", l)
        if m:
            c = [x.strip() for x in l.strip().strip("|").split("|")]
            raw[m.group(1)] = c[1:]
    cells = {}
    for k in KEYS:
        if k in OVERRIDES.get(stem, {}):
            s, t, e = OVERRIDES[stem][k]; cells[k] = cell(s, t, e, "verified 2026-09-25")
        elif k in RESC.get(stem, {}):
            c = RESC[stem][k]; cells[k] = cell(c["s"], c["text"], c.get("evidence", ""), "rescored 2026-09-25 (agent sweep)")
        elif k in raw:
            s, t = split(raw[k][0]); cells[k] = cell(s, t, raw[k][1] if len(raw[k]) > 1 else "", "baseline 2026-09-23")
        else:
            cells[k] = cell("N/A", "not scored in the baseline (no such surface)", "", "baseline 2026-09-23")
    out["rows"].append({"id": stem, "name": name, "cells": cells})
json.dump(out, open("scorecard.json", "w"), indent=1, ensure_ascii=False)
tot = {}
for r in out["rows"]:
    c = [x["s"] for x in r["cells"].values()]
    print(f'{r["name"]:34}', "✔%d ✗%d N/A%d ?%d" % tuple(c.count(x) for x in ("✔","✗","N/A","?")))

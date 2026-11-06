"""Upload header fixtures (PRD 6.2, D-87). Stdlib only; python3 -I tools/build_upload_fixtures.py --seed 20261103

Writes fixtures/uploads/cases.json: header-only byte strings as hex (no real images), each with the oracle's verdict
from tools/uploadlib.py and, where allowed, the sha256 and length of the stripped bytes. Written before any
TypeScript (rule 7). Additive: the community fixture is not touched (rule 8). Hashed into MANIFEST.json by
tools/reference_rank.py --write-expected; tools/verify_fixtures.py recomputes every verdict from the hex.
"""
import argparse
import hashlib
import json
import os
import random
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from uploadlib import MAX_PIXELS, parse, strip  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "uploads")


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))


def ihdr(w, h):
    return chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))


def png(*chunks):
    return b"\x89PNG\r\n\x1a\n" + b"".join(chunks)


def seg(marker, data):
    return bytes([0xFF, marker]) + struct.pack(">H", len(data) + 2) + data


def sof(marker, w, h):
    return seg(marker, struct.pack(">BHHB", 8, h, w, 3) + b"\x01\x22\x00\x02\x11\x01\x03\x11\x01")


SOS = seg(0xDA, b"\x03\x01\x00\x02\x11\x03\x11\x00\x3f\x00")
APP0 = seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")


def jpeg(*segs, scan=b""):
    return b"\xff\xd8" + b"".join(segs) + SOS + scan + b"\xff\xd9"


def riff_chunk(tag, data):
    return tag + struct.pack("<I", len(data)) + data + (b"\x00" if len(data) & 1 else b"")


def webp(*chunks):
    body = b"WEBP" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(body)) + body


def vp8(w, h, rng):
    return riff_chunk(b"VP8 ", b"\x30\x01\x00\x9d\x01\x2a" + struct.pack("<HH", w, h) + rng.randbytes(8))


def vp8l(w, h, rng):
    return riff_chunk(b"VP8L", b"\x2f" + struct.pack("<I", (w - 1) | ((h - 1) << 14)) + rng.randbytes(8))


def vp8x(w, h, flags=0):
    return riff_chunk(b"VP8X", bytes([flags, 0, 0, 0]) + (w - 1).to_bytes(3, "little") + (h - 1).to_bytes(3, "little"))


def build(seed):
    rng = random.Random(seed)
    idat = lambda: chunk(b"IDAT", rng.randbytes(16))  # noqa: E731
    iend = chunk(b"IEND", b"")
    gps = b"Exif\x00\x00MM\x00\x2a\x00\x00\x00\x08GPSLatitude 41.8781 N GPSLongitude 87.6298 W"
    xmp = b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta><exif:GPSLatitude>41,52.686N</exif:GPSLatitude></x:xmpmeta>"
    cases = []

    def case(cid, mime, data, note):
        cases.append({"id": cid, "mime": mime, "note": note, "hex": data.hex()})

    # PNG
    case("U-PNG-01", "image/png", png(ihdr(1, 1), idat(), iend), "1 x 1 allowed")
    case("U-PNG-02", "image/png", png(ihdr(20_000, 20_000), idat(), iend), "20 000 x 20 000 (4e8 px) refused")
    case("U-PNG-03", "image/png", png(chunk(b"tEXt", b"Comment\x00hi"), ihdr(10, 10), idat(), iend), "IHDR not the first chunk refused")
    case("U-PNG-04", "image/png", png(ihdr(10, 10))[:24], "IHDR cut after the width: truncated")
    case("U-PNG-05", "image/png", png(ihdr(5000, 5000), idat(), iend), "exactly max_pixels (25 000 000) allowed")
    case("U-PNG-06", "image/png", png(ihdr(1, 25_000_001), idat(), iend), "one pixel over max_pixels refused")
    case("U-PNG-07", "image/png", png(ihdr(0, 10), idat(), iend), "zero width refused")
    # JPEG
    dqt = seg(0xDB, b"\x00" + rng.randbytes(64))
    dht = seg(0xC4, b"\x00" + bytes(16) + b"")
    case("U-JPG-01", "image/jpeg", jpeg(APP0, sof(0xC0, 4000, 3000), scan=rng.randbytes(16)), "SOF0 4000 x 3000 (12 MP) allowed")
    case("U-JPG-02", "image/jpeg", jpeg(APP0, sof(0xC2, 6000, 5000)), "SOF2 progressive 6000 x 5000 (30 MP) refused")
    case("U-JPG-03", "image/jpeg", jpeg(seg(0xE1, b"Exif\x00\x00" + rng.randbytes(65533 - 6)), sof(0xC0, 640, 480)), "SOF after a 64 KB APP1 found; strip drops the APP1")
    case("U-JPG-04", "image/jpeg", jpeg(APP0, dqt, dht, sof(0xC0, 800, 600)), "DQT and DHT before the SOF")
    case("U-JPG-05", "image/jpeg", jpeg(APP0, dqt), "no SOF before the scan refused")
    case("U-JPG-06", "image/jpeg", jpeg(sof(0xC0, 100, 100), sof(0xC2, 20_000, 20_000)), "two SOFs refused (which one a decoder honours is not ours to guess)")
    case("U-JPG-07", "image/jpeg", jpeg(sof(0xC0, 100, 0)), "zero height (DNL-deferred) refused")
    case("U-JPG-08", "image/jpeg", b"\xff\xd8" + APP0 + sof(0xC0, 100, 100), "no SOS before the data ends: truncated")
    case("U-JPG-09", "image/jpeg", b"\xff\xd8" + APP0[:3], "segment length runs past the end: truncated")
    # WebP: below, at and above the cap in each of the three headers
    for tag, mk in (("VP8", vp8), ("VP8L", vp8l)):
        case(f"U-WEBP-{tag}-1", "image/webp", webp(mk(100, 100, rng)), f"{tag} 100 x 100 allowed")
        case(f"U-WEBP-{tag}-2", "image/webp", webp(mk(5000, 5000, rng)), f"{tag} 5000 x 5000 (at the cap) allowed")
        case(f"U-WEBP-{tag}-3", "image/webp", webp(mk(5000, 5001, rng)), f"{tag} 5000 x 5001 (over the cap) refused")
    case("U-WEBP-VP8X-1", "image/webp", webp(vp8x(100, 100), vp8(100, 100, rng)), "VP8X canvas 100 x 100 allowed")
    case("U-WEBP-VP8X-2", "image/webp", webp(vp8x(5000, 5000), vp8(100, 100, rng)), "VP8X canvas at the cap allowed")
    case("U-WEBP-VP8X-3", "image/webp", webp(vp8x(20_000, 20_000), vp8(100, 100, rng)), "VP8X 24-bit canvas 20 000 x 20 000 refused")
    case("U-WEBP-VP8-0", "image/webp", webp(vp8(0, 100, rng)), "VP8 zero width refused")
    case("U-WEBP-ALPH", "image/webp", webp(riff_chunk(b"ALPH", b"\x00\x00")), "first chunk is not VP8/VP8L/VP8X refused")
    # Strip (D-87 decision 4): metadata containers go; pixels and structure stay
    case("U-STRIP-PNG", "image/png", png(ihdr(64, 64), chunk(b"eXIf", gps[6:]), chunk(b"tEXt", b"Location\x00home"), chunk(b"iTXt", b"XML:com.adobe.xmp\x00\x00\x00\x00\x00" + xmp[29:]), chunk(b"zTXt", b"Raw\x00\x00" + zlib.compress(b"gps")), idat(), iend), "eXIf, tEXt, iTXt and zTXt dropped")
    case("U-STRIP-JPG", "image/jpeg", jpeg(APP0, seg(0xE1, gps), seg(0xE1, xmp), dqt, sof(0xC0, 64, 64), scan=b"\xff\xe1\x00\x04ab"), "APP1 Exif and XMP before SOS dropped; APP0 and the scan (even an FF E1 inside it) kept")
    case("U-STRIP-WEBP", "image/webp", webp(vp8x(64, 64, 0x10 | 0x08 | 0x04), vp8(64, 64, rng), riff_chunk(b"EXIF", gps[6:]), riff_chunk(b"XMP ", xmp[29:])), "EXIF and XMP chunks dropped, VP8X flags 0x1C -> 0x10, RIFF size rewritten")

    for c in cases:
        data = bytes.fromhex(c["hex"])
        c.update(parse(c["mime"], data))
        s = strip(c["mime"], data) if c["verdict"] == "allow" else None
        c["stripped_sha256"] = hashlib.sha256(s).hexdigest() if s is not None else None
        c["stripped_bytes"] = len(s) if s is not None else None
    return cases


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    a = ap.parse_args()
    cases = build(a.seed)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "cases.json"), "w") as f:
        json.dump({"version": 1, "seed": a.seed, "max_pixels": MAX_PIXELS, "cases": cases}, f, indent=1)
        f.write("\n")
    for c in cases:
        dims = f"{c['width']} x {c['height']}" if c["width"] is not None else "-"
        print(f"{c['id']:16s} {c['verdict']:6s} {c['reason'] or '':16s} {dims:22s} {len(c['hex']) // 2:6d} B -> {c['stripped_bytes'] or '-'}")
    print(f"{len(cases)} cases -> fixtures/uploads/cases.json ({sum(c['verdict'] == 'allow' for c in cases)} allowed)")

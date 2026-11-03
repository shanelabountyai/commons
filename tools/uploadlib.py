"""Upload header oracle (PRD 6.2, D-87). Stdlib only (struct); python3 -I.

Test oracle, not product code. Reads the dimensions an image's container header CLAIMS, with no decoder, and strips
metadata containers at the same level. The cap (rules/limits.json upload.max_pixels) applies to the claimed size: a
decoder that disagrees with its own header, and APNG frames, are not modelled.

parse(mime, data) -> {"width", "height", "verdict": "allow"|"refuse", "code", "reason"}
strip(mime, data) -> bytes   (only for data that parse() allowed)

Rules, per container:
  PNG   the signature, then IHDR as the first chunk with length 13; width and height are u32 BE.
  JPEG  SOI, then markers up to the first SOS. Each marker is 0xFF (fill 0xFF bytes skipped) and a code; RSTn and
        TEM stand alone; everything else carries a u16 BE length >= 2 that must fit in the data. The SOF codes are
        C0-C3, C5-C7, C9-CB, CD-CF: height at +5, width at +7. A second SOF, no SOF before SOS, or no SOS are refused.
  WebP  RIFF....WEBP, then the first chunk: 'VP8 ' (start code 9D 01 2A, 14-bit LE width/height at +6/+8 of the
        payload, after the 3-byte frame tag), 'VP8L' (0x2F, then 14+14 bits LE of width-1/height-1), or 'VP8X'
        (24-bit LE canvas width-1/height-1 at +4/+7 of the payload).
  Any   a zero width or height is refused; width x height > max_pixels is refused.

strip: PNG drops eXIf/tEXt/iTXt/zTXt chunks; JPEG drops every APP1 segment before SOS (Exif and XMP both live in
APP1); WebP drops EXIF and 'XMP ' chunks, clears the VP8X EXIF (0x08) and XMP (0x04) flags and rewrites the RIFF size.
Anything the walk cannot read as a whole chunk is copied through unchanged.
"""
import json
import os
import struct

RULES = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "rules", "limits.json")))
MAX_PIXELS = RULES["upload"]["max_pixels"]
MAX_PER_POST = RULES["upload"]["max_per_post"]

PNG_SIG = b"\x89PNG\r\n\x1a\n"
SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
STANDALONE = {0x01} | set(range(0xD0, 0xD8))
PNG_META = {b"eXIf", b"tEXt", b"iTXt", b"zTXt"}
WEBP_META = {b"EXIF", b"XMP "}


class Bad(Exception):
    pass


def _png(d):
    if len(d) < 16 or d[:8] != PNG_SIG:
        raise Bad("bad_signature")
    if d[12:16] != b"IHDR":
        raise Bad("ihdr_not_first")
    if struct.unpack(">I", d[8:12])[0] != 13 or len(d) < 29:
        raise Bad("truncated")
    return struct.unpack(">II", d[16:24])


def _jpeg(d):
    if d[:2] != b"\xff\xd8":
        raise Bad("bad_signature")
    i, size = 2, None
    while True:
        if i >= len(d):
            raise Bad("truncated")
        if d[i] != 0xFF:
            raise Bad("bad_marker")
        while i < len(d) and d[i] == 0xFF:
            i += 1
        if i >= len(d):
            raise Bad("truncated")
        m = d[i]
        i += 1
        if m in STANDALONE:
            continue
        if m == 0xDA:
            if size is None:
                raise Bad("no_sof")
            return size
        if m == 0xD9:
            raise Bad("no_sof" if size is None else "truncated")
        if i + 2 > len(d):
            raise Bad("truncated")
        n = struct.unpack(">H", d[i:i + 2])[0]
        if n < 2 or i + n > len(d):
            raise Bad("truncated")
        if m in SOF:
            if size is not None:
                raise Bad("two_sof")
            if n < 7:
                raise Bad("truncated")
            h, w = struct.unpack(">HH", d[i + 3:i + 7])
            size = (w, h)
        i += n


def _webp(d):
    if len(d) < 20 or d[:4] != b"RIFF" or d[8:12] != b"WEBP":
        raise Bad("bad_signature")
    tag, p = d[12:16], d[20:]
    if tag == b"VP8 ":
        if len(p) < 10:
            raise Bad("truncated")
        if p[3:6] != b"\x9d\x01\x2a":
            raise Bad("bad_marker")
        w, h = struct.unpack("<HH", p[6:10])
        return w & 0x3FFF, h & 0x3FFF
    if tag == b"VP8L":
        if len(p) < 5:
            raise Bad("truncated")
        if p[0] != 0x2F:
            raise Bad("bad_marker")
        bits = struct.unpack("<I", p[1:5])[0]
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if tag == b"VP8X":
        if len(p) < 10:
            raise Bad("truncated")
        return int.from_bytes(p[4:7], "little") + 1, int.from_bytes(p[7:10], "little") + 1
    raise Bad("unknown_chunk")


PARSERS = {"image/png": _png, "image/jpeg": _jpeg, "image/webp": _webp}


def parse(mime, data, max_pixels=MAX_PIXELS):
    try:
        w, h = PARSERS[mime](data)
    except Bad as e:
        return {"width": None, "height": None, "verdict": "refuse", "code": "INPUT_INVALID", "reason": str(e)}
    if w == 0 or h == 0:
        return {"width": w, "height": h, "verdict": "refuse", "code": "INPUT_INVALID", "reason": "zero_dimension"}
    if w * h > max_pixels:
        return {"width": w, "height": h, "verdict": "refuse", "code": "INPUT_INVALID", "reason": "too_many_pixels"}
    return {"width": w, "height": h, "verdict": "allow", "code": None, "reason": None}


def per_post_allowed(existing):
    """One more attachment is allowed while the post holds fewer than max_per_post."""
    return existing < MAX_PER_POST


def _strip_png(d):
    out, i = bytearray(d[:8]), 8
    while i + 12 <= len(d):
        n = struct.unpack(">I", d[i:i + 4])[0]
        end = i + 12 + n
        if end > len(d):
            break
        if d[i + 4:i + 8] not in PNG_META:
            out += d[i:end]
        i = end
    return bytes(out + d[i:])


def _strip_jpeg(d):
    out, i = bytearray(d[:2]), 2
    while i < len(d):
        j = i
        while j < len(d) and d[j] == 0xFF:
            j += 1
        if j >= len(d) or j == i:
            break
        m = d[j]
        if m in STANDALONE:
            out += d[i:j + 1]
            i = j + 1
            continue
        if m in (0xDA, 0xD9) or j + 3 > len(d):
            break
        end = j + 1 + struct.unpack(">H", d[j + 1:j + 3])[0]
        if end > len(d):
            break
        if m != 0xE1:
            out += d[i:end]
        i = end
    return bytes(out + d[i:])


def _strip_webp(d):
    out, i = bytearray(d[:12]), 12
    while i + 8 <= len(d):
        n = struct.unpack("<I", d[i + 4:i + 8])[0]
        end = i + 8 + n + (n & 1)
        if end > len(d):
            break
        tag = d[i:i + 4]
        if tag == b"VP8X" and n >= 1:
            out += d[i:i + 8] + bytes([d[i + 8] & ~0x0C & 0xFF]) + d[i + 9:end]
        elif tag not in WEBP_META:
            out += d[i:end]
        i = end
    out += d[i:]
    out[4:8] = struct.pack("<I", len(out) - 8)
    return bytes(out)


STRIPPERS = {"image/png": _strip_png, "image/jpeg": _strip_jpeg, "image/webp": _strip_webp}


def strip(mime, data):
    return STRIPPERS[mime](data)

#!/usr/bin/env python3
"""Read-only metadata risk audit; never print photo data or metadata values."""
from __future__ import annotations
import base64
import json
import re
import struct
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
PDF_EXT = {".pdf"}
MAX_BYTES = 20 * 1024 * 1024
findings = []
counts = Counter()

def tiff_tags(raw: bytes) -> set[str]:
    if raw.startswith(b"Exif\x00\x00"):
        raw = raw[6:]
    if len(raw) < 8 or raw[:2] not in (b"II", b"MM"):
        return set()
    endian = "<" if raw[:2] == b"II" else ">"
    def u16(pos):
        return struct.unpack_from(endian + "H", raw, pos)[0]
    def u32(pos):
        return struct.unpack_from(endian + "I", raw, pos)[0]
    if u16(2) != 42:
        return set()
    tags = set()
    seen = set()
    def parse_ifd(offset, depth=0):
        if offset in seen or depth > 3 or offset < 8 or offset + 2 > len(raw):
            return
        seen.add(offset)
        size = u16(offset)
        if size > 10000 or offset + 2 + 12 * size > len(raw):
            return
        for i in range(size):
            p = offset + 2 + 12 * i
            tag = u16(p)
            if tag == 0x8825:
                tags.add("GPS_IFD")
            if tag in (0xA431, 0xA435, 0xC62F):
                tags.add("device_serial_tag")
            if tag in (0x8769, 0x8825) and u32(p + 4) == 1:
                parse_ifd(u32(p + 8), depth + 1)
    try:
        parse_ifd(u32(4))
    except (struct.error, ValueError):
        return {"malformed_exif"}
    return tags

def exif_blocks(data: bytes, ext: str) -> list[bytes]:
    blocks = []
    if ext in (".jpg", ".jpeg") and data.startswith(b"\xff\xd8"):
        p = 2
        while p + 4 <= len(data):
            if data[p] != 0xFF:
                break
            while p < len(data) and data[p] == 0xFF:
                p += 1
            if p >= len(data):
                break
            marker = data[p]
            p += 1
            if marker in (0xD9, 0xDA):
                break
            if marker in (0x01, *range(0xD0, 0xD8)):
                continue
            if p + 2 > len(data):
                break
            length = int.from_bytes(data[p:p+2], "big")
            if length < 2 or p + length > len(data):
                break
            chunk = data[p+2:p+length]
            if marker == 0xE1 and (chunk.startswith(b"Exif\x00\x00") or b"xmp" in chunk[:200].lower()):
                blocks.append(chunk)
            p += length
    elif ext == ".webp" and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        p = 12
        while p + 8 <= len(data):
            kind = data[p:p+4]
            length = int.from_bytes(data[p+4:p+8], "little")
            if length < 0 or p + 8 + length > len(data):
                break
            if kind in (b"EXIF", b"XMP "):
                blocks.append(data[p+8:p+8+length])
            p += 8 + length + (length % 2)
    elif ext == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
        p = 8
        while p + 12 <= len(data):
            length = int.from_bytes(data[p:p+4], "big")
            kind = data[p+4:p+8]
            if length > MAX_BYTES or p + 12 + length > len(data):
                break
            if kind in (b"eXIf", b"iTXt", b"tEXt", b"zTXt"):
                blocks.append(data[p+8:p+8+length])
            p += 12 + length
    return blocks

def inspect_image(data: bytes, ext: str, label: str):
    counts["images_checked"] += 1
    blocks = exif_blocks(data, ext)
    if blocks:
        counts["images_with_metadata_blocks"] += 1
    risk = set()
    for b in blocks:
        risk.update(tiff_tags(b))
        if re.search(rb"(?:GPSLatitude|GPSLongitude|GPSCoordinates|exif:GPS|GPSPosition)", b, re.I):
            risk.add("gps_xmp_reference")
        if re.search(rb"(?:CameraSerialNumber|BodySerialNumber|LensSerialNumber)", b, re.I):
            risk.add("serial_xmp_reference")
    if risk:
        findings.append({"file": label, "categories": sorted(risk)})

def inspect_pdf(data: bytes, label: str):
    counts["pdfs_checked"] += 1
    indicators = []
    for tag in (b"Author", b"Creator", b"Producer", b"CreationDate", b"ModDate"):
        if re.search(rb"/" + tag + rb"\b", data):
            indicators.append(tag.decode("ascii"))
    if indicators:
        findings.append({"file":label, "categories":["pdf_metadata_keys"], "keys":indicators})

for file in ROOT.rglob("*"):
    if not file.is_file() or ".git" in file.parts:
        continue
    if file.stat().st_size > MAX_BYTES:
        counts["files_skipped_too_large"] += 1
        continue
    ext = file.suffix.lower()
    rel = file.relative_to(ROOT).as_posix()
    if ext in IMAGE_EXT | PDF_EXT:
        data = file.read_bytes()
        if ext in IMAGE_EXT:
            inspect_image(data, ext, rel)
        else:
            inspect_pdf(data, rel)
    elif ext == ".html":
        data = file.read_text(encoding="utf-8", errors="replace")
        embedded = re.finditer(r"data:image/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)", data, re.I)
        for i, m in enumerate(embedded, 1):
            if i > 10000:
                counts["embedded_images_skipped_cap"] += 1
                break
            try:
                encoded = re.sub(r"\s+", "", m.group(2))
                blob = base64.b64decode(encoded, validate=True)
                if len(blob) < MAX_BYTES:
                    inspect_image(blob, "." + m.group(1).lower(), rel + f" (embedded image #{i})")
            except (ValueError, base64.binascii.Error):
                counts["embedded_decode_errors"] += 1

print("PUBLIC MEDIA METADATA AUDIT — METADATA VALUES AND IMAGE DATA ARE NEVER PRINTED")
print(json.dumps({"counts":dict(counts),"findings":findings,
   "limitations":[
    "Only local JPEG/PNG/WebP files and base64 images plus simple PDF metadata key checks are covered.",
    "Visible content, faces, addresses, copyrights, historic image copies, and compressed/encoded PDF metadata require human review.",
    "Metadata blocks and PDF producer names are review signals, not necessarily vulnerabilities."
   ]}, indent=2))
if any(any(c in f["categories"] for c in ("GPS_IFD","gps_xmp_reference","device_serial_tag","serial_xmp_reference")) for f in findings):
    print("REVIEW REQUIRED: Some images include geolocation or hardware identifiers (values withheld).")
    raise SystemExit(1)

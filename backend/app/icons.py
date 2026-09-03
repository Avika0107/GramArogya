"""On-the-fly PWA icon generator (pure stdlib — no Pillow required).

Draws a green rounded square with a white medical cross and encodes it as a
valid PNG. Served by GET /asha/icons/icon-{size}.png so the ASHA PWA is
installable ("Add to Home Screen") with zero build steps.
"""

import struct
import zlib

_BG = (11, 110, 79, 255)     # GramArogya green
_FG = (255, 255, 255, 255)   # white cross


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def _pixel(x: float, y: float, size: float):
    """Return (r,g,b,a) for one pixel of the icon."""
    radius = size * 0.22
    # Rounded-square mask
    dx = max(radius - x, x - (size - radius), 0.0)
    dy = max(radius - y, y - (size - radius), 0.0)
    if dx * dx + dy * dy > radius * radius:
        return _BG
    # White cross (vertical + horizontal bars)
    if (size * 0.36 <= x <= size * 0.64) or (size * 0.36 <= y <= size * 0.64):
        return _FG
    return _BG


def icon_png(size: int) -> bytes:
    """Render a {size}x{size} RGBA PNG (supersampled 3x for smooth edges)."""
    size = max(32, min(1024, int(size)))
    ss = 3  # supersampling factor

    raw_rows = bytearray()
    for py in range(size * ss):
        raw_rows.append(0)  # filter type: None
        for px in range(size * ss):
            raw_rows += bytes(_pixel(px / ss, py / ss, float(size)))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw_rows), 9)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", idat)
        + _chunk(b"IEND", b"")
    )
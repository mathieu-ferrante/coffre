"""Génère les icônes PNG de l'app (sans dépendance) : cadenas blanc sur fond sarcelle."""
import math, struct, sys, zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"

def clamp(v, a=0.0, b=1.0):
    return a if v < a else b if v > b else v

def sd_round_rect(px, py, cx, cy, hx, hy, r):
    qx, qy = abs(px - cx) - hx + r, abs(py - cy) - hy + r
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r

def sd_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r

def sd_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)

def render(size, maskable):
    pix = 512 / size
    scale = 0.78 if maskable else 1.0  # zone de sécurité des icônes « maskable »
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            u, v = (x + 0.5) * pix, (y + 0.5) * pix
            t = v / 512
            bg = (int(20 + (15 - 20) * t), int(184 + (118 - 184) * t), int(166 + (110 - 166) * t))
            a_bg = 1.0 if maskable else clamp(0.5 - sd_round_rect(u, v, 256, 256, 256, 256, 112) / pix)
            # coordonnées du dessin (mise à l'échelle autour du centre)
            du, dv = 256 + (u - 256) / scale, 256 + (v - 256) / scale
            p = pix / scale
            body = sd_round_rect(du, dv, 256, 306, 132, 104, 30)
            if dv <= 214:
                shackle = abs(math.hypot(du - 256, dv - 214) - 84) - 17
            else:
                shackle = min(sd_segment(du, dv, 172, 214, 172, 240), sd_segment(du, dv, 340, 214, 340, 240)) - 17
            lock = min(body, shackle)
            hole = min(sd_circle(du, dv, 256, 290, 24), sd_round_rect(du, dv, 256, 330, 10, 34, 8))
            a_lock = clamp(0.5 - lock / p) * (1 - clamp(0.5 - hole / p))
            r = bg[0] * (1 - a_lock) + 255 * a_lock
            g = bg[1] * (1 - a_lock) + 255 * a_lock
            b = bg[2] * (1 - a_lock) + 255 * a_lock
            row += bytes((int(r), int(g), int(b), int(255 * a_bg)))
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    return png

OUT.mkdir(parents=True, exist_ok=True)
for name, size, mask in [("icon-192.png", 192, False), ("icon-512.png", 512, False), ("maskable-512.png", 512, True)]:
    (OUT / name).write_bytes(render(size, mask))
    print("ok", name)

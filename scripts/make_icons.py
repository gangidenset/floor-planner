"""アプリアイコン（PNG）を生成する。外部ライブラリ不要。

    python scripts/make_icons.py

青い背景に白い間取り（外壁・内壁・ドアの開き）と木目色のソファ。
maskable 用は全面塗り、通常用は角丸。絵は中央 80% のセーフゾーン内に収めている。
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'icons'

TOP = (0x3B, 0x82, 0xF6)
BOTTOM = (0x1F, 0x6F, 0xEB)
WHITE = (255, 255, 255)
SOFA = (0xE8, 0xC9, 0x9B)

STROKE = 0.05
# 外壁（左下にドアの切れ目）と内壁
WALLS = [
    ((0.22, 0.22), (0.78, 0.22)),
    ((0.78, 0.22), (0.78, 0.78)),
    ((0.78, 0.78), (0.44, 0.78)),
    ((0.22, 0.78), (0.22, 0.22)),
    ((0.22, 0.78), (0.26, 0.78)),
    ((0.52, 0.22), (0.52, 0.5)),
]
DOOR_HINGE = (0.26, 0.78)
DOOR_R = 0.18
DOOR_STROKE = 0.022
SOFA_RECT = (0.58, 0.58, 0.72, 0.72)


def dist_to_segment(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def in_door(x, y):
    hx, hy = DOOR_HINGE
    # 扉の板（蝶番から上へ）と、開く軌跡の円弧（右下の 1/4）
    if dist_to_segment(x, y, DOOR_HINGE, (hx, hy - DOOR_R)) <= DOOR_STROKE / 2:
        return True
    dx, dy = x - hx, y - hy
    if dx >= 0 and dy <= 0 and abs(math.hypot(dx, dy) - DOOR_R) <= DOOR_STROKE / 2:
        return True
    return False


def pixel(x, y):
    if any(dist_to_segment(x, y, a, b) <= STROKE / 2 for a, b in WALLS) or in_door(x, y):
        return WHITE
    x0, y0, x1, y1 = SOFA_RECT
    if x0 <= x <= x1 and y0 <= y <= y1:
        return SOFA
    return None


def in_rounded_rect(x, y, r):
    cx = min(max(x, r), 1 - r)
    cy = min(max(y, r), 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def render(size, rounded):
    ss = 4 if size <= 256 else 3  # スーパーサンプリングでアンチエイリアス
    rows = []
    for py in range(size):
        row = bytearray([0])  # PNG フィルタ: なし
        t = py / (size - 1)
        base = [TOP[i] + (BOTTOM[i] - TOP[i]) * t for i in range(3)]
        for px in range(size):
            acc = [0.0, 0.0, 0.0]
            bg = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size
                    y = (py + (sy + 0.5) / ss) / size
                    if rounded and not in_rounded_rect(x, y, 0.22):
                        continue
                    bg += 1
                    c = pixel(x, y) or base
                    for i in range(3):
                        acc[i] += c[i]
            if bg == 0:
                row += bytes(4)
                continue
            n = ss * ss
            row += bytes([round(acc[i] / bg) for i in range(3)] + [round(255 * bg / n)])
        rows.append(bytes(row))
    return png(size, size, b''.join(rows))


def png(w, h, raw):
    def chunk(kind, data):
        c = struct.pack('>I', len(data)) + kind + data
        return c + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


TARGETS = [
    ('icon-192.png', 192, True),
    ('icon-512.png', 512, True),
    ('icon-maskable-512.png', 512, False),
    ('apple-touch-icon.png', 180, False),  # iOS は自動で角丸にする
    ('favicon-32.png', 32, True),
]

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, rounded in TARGETS:
        (OUT / name).write_bytes(render(size, rounded))
        print('wrote', name)

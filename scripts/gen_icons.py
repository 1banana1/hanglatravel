#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 icons/icon.svg 渲染成 PWA 需要的 PNG 图标尺寸。

不依赖任何 SVG 渲染库：直接用手绘几何重画一遍（图形极简，四个圆角矩形 + 两根线 + 两个汉字）。
汉字是唯一的难点——用字体渲染。找不到中文字体就退化成只画色块。
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "icons")
OUT_DIR = os.path.abspath(OUT_DIR)

BG_TOP = (27, 31, 38)
BG_BOT = (14, 16, 19)
BORDER = (42, 47, 54)
GOLD = (230, 180, 34)
RED = (192, 57, 43)
GREY = (154, 163, 173)
INK = (18, 21, 26)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\Dengb.ttf",
    r"C:\Windows\Fonts\Deng.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
]


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return None


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_icon(size, maskable=False):
    """maskable=True 时把内容缩进安全区（中心 80% 圆内必须可见）。"""
    S = size
    img = Image.new("RGB", (S, S), BG_BOT)
    d = ImageDraw.Draw(img)

    # 背景竖向渐变
    for y in range(S):
        d.line([(0, y), (S, y)], fill=lerp(BG_TOP, BG_BOT, y / max(1, S - 1)))

    # maskable 图标：内容整体缩到 78%，四周留出裁切余量
    scale = 0.78 if maskable else 1.0
    off = (1 - scale) / 2 * S

    def sx(v):
        return off + v / 512 * S * scale

    def sy(v):
        return off + v / 512 * S * scale

    def box(x1, y1, x2, y2, r, fill):
        d.rounded_rectangle(
            [sx(x1), sy(y1), sx(x2), sy(y2)],
            radius=max(1, r / 512 * S * scale),
            fill=fill,
        )

    # 外框（maskable 版本不画，避免被裁掉一半显得脏）
    if not maskable:
        d.rounded_rectangle(
            [sx(26), sy(26), sx(486), sy(486)],
            radius=86 / 512 * S,
            outline=BORDER,
            width=max(1, round(6 / 512 * S)),
        )

    box(72, 186, 222, 326, 22, GOLD)
    box(290, 186, 440, 326, 22, RED)

    lw = max(1, round(14 / 512 * S * scale))
    d.line([(sx(246), sy(256)), (sx(286), sy(256))], fill=GREY, width=lw)
    d.line([(sx(274), sy(234)), (sx(300), sy(256)), (sx(274), sy(278))],
           fill=GREY, width=lw, joint="curve")

    font = load_font(max(8, round(96 / 512 * S * scale)))
    if font is not None:
        for ch, cx in (("夯", 147), ("拉", 365)):
            # 用 anchor="mm" 精确居中
            d.text((sx(cx), sy(256)), ch, font=font, fill=INK, anchor="mm")

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    jobs = [
        ("icon-180.png", 180, False),   # apple-touch-icon
        ("icon-192.png", 192, False),   # PWA 标准
        ("icon-512.png", 512, False),   # PWA 标准
        ("icon-512-maskable.png", 512, True),  # Android 自适应
    ]
    lines = []
    for name, size, maskable in jobs:
        im = draw_icon(size, maskable)
        path = os.path.join(OUT_DIR, name)
        im.save(path, "PNG", optimize=True)
        lines.append(f"{name}: {size}x{size}  {os.path.getsize(path)} bytes  maskable={maskable}")
    report = "\n".join(lines)
    with open(os.path.join(HERE, "_icon_report.txt"), "w", encoding="utf-8") as f:
        f.write(report + "\n")
    print(report)


if __name__ == "__main__":
    main()

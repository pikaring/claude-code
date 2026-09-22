# -*- coding: utf-8 -*-
"""
鉱山カードの絵柄から、アプリのアイコン一式をつくる。

・緑のラシャ（卓）の角丸の上に、雪をかぶった山と ダイヤモンドを おく
・app/images/icon-32 / 180 / 192 / 512.png と、紹介ページ用の
  assets/icon.png（512px）・assets/favicon.png（64px）を 書き出す

つかいかた:
    python3 tools/make_icons.py

必要なもの: pillow （pip install pillow）
"""
import os

from PIL import Image, ImageDraw

BASE = 1024                      # 下ごしらえの大きさ（ここから縮小する）
FELT = (11, 107, 52, 255)        # 卓のみどり（app の --felt と同じ）
FELT_DARK = (6, 77, 38, 255)
SNOW = (244, 241, 230, 255)      # 山の白
ROCK = (205, 214, 221, 255)      # 山の影
GOLD = (255, 209, 102, 255)      # ダイヤの金色の縁
GEM = (143, 227, 255, 255)       # ダイヤの水色

OUT = [
    ('app/images/icon-512.png', 512),
    ('app/images/icon-192.png', 192),
    ('app/images/icon-180.png', 180),
    ('app/images/icon-32.png', 32),
]


def rounded(size, radius, fill):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=fill)
    return im


def build():
    im = rounded(BASE, int(BASE * 0.22), FELT)
    d = ImageDraw.Draw(im)

    # 下半分を すこし 暗くして、卓の奥行きを 出す
    d.rounded_rectangle([0, int(BASE * 0.62), BASE - 1, BASE - 1],
                        radius=int(BASE * 0.22), fill=FELT_DARK)
    d.rectangle([0, int(BASE * 0.62), BASE - 1, int(BASE * 0.80)], fill=FELT_DARK)

    # 山（大）
    peak = (BASE * 0.50, BASE * 0.20)
    left = (BASE * 0.14, BASE * 0.70)
    right = (BASE * 0.86, BASE * 0.70)
    d.polygon([peak, right, left], fill=SNOW)
    # 右半分だけ すこし 暗くして、山の 向きを 出す（小さくしても つぶれない）
    d.polygon([peak, right, (BASE * 0.50, BASE * 0.70)], fill=ROCK)
    # 手前の 小さい山
    d.polygon([(BASE * 0.10, BASE * 0.70), (BASE * 0.30, BASE * 0.43),
               (BASE * 0.50, BASE * 0.70)], fill=(250, 248, 242, 255))

    # ダイヤモンド（下の帯の まんなか）
    cx, cy, w, h = BASE * 0.50, BASE * 0.845, BASE * 0.115, BASE * 0.105
    d.polygon([(cx, cy - h), (cx + w, cy), (cx, cy + h), (cx - w, cy)], fill=GEM)
    d.line([(cx, cy - h), (cx + w, cy), (cx, cy + h), (cx - w, cy), (cx, cy - h)],
           fill=GOLD, width=int(BASE * 0.012))
    d.line([(cx - w, cy), (cx + w, cy)], fill=GOLD, width=int(BASE * 0.008))
    d.line([(cx, cy - h), (cx, cy + h)], fill=GOLD, width=int(BASE * 0.008))
    return im


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    im = build()
    for rel, size in OUT:
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        im.resize((size, size), Image.LANCZOS).save(path, optimize=True)
        print('wrote', rel)
    for rel, size in [('assets/icon.png', 512), ('assets/favicon.png', 64)]:
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        im.resize((size, size), Image.LANCZOS).save(path, optimize=True)
        print('wrote', rel)


if __name__ == '__main__':
    main()

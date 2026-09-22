#!/usr/bin/env python3
"""画像生成AIが出したグリッド1枚を、カードの絵に切り分けるツール。

docs/asset-prompts.md のプロンプトで出したグリッド画像（無地の明るいグレー背景、
コマの区切り線あり）を受け取り、

  1. 区切り線を自動で見つけてコマに切り分け
  2. 背景のグレーを外側から塗りつぶして透過（キャラクターの内側は残す）
  3. 中身の外周で切りつめ、正方形に余白を足して 512x512 に統一

したPNGを書き出します。

つかいかた:

    pip install pillow numpy
    # 出力先ディレクトリ、グリッド画像、左上から右への順でファイル名を並べる
    python3 tools/make_cards.py app/images grid.webp \
        card-germ card-scout card-soldier2 - card-soldier3 - card-soldier4

  ファイル名に "-" を書いたコマは書き出しません（使わないコマ・空きコマ）。
"""

import sys
import os
from collections import deque

from PIL import Image
import numpy as np

SIZE = 512          # 出力の一辺
PAD_RATIO = 0.04    # 正方形化したあとに足す余白の比率
FULL_CLEAR = 28     # この差までは完全に透過
SOFT_CLEAR = 60     # この差までは半透明（輪郭のギザギザを抑える）


def find_lines(dark_ratio, frame_skip=8, min_ratio=0.9, max_width=0.03):
    """区切り線の位置（範囲）を拾う。

    区切り線は「その行／列のほぼ全長が暗い」細い帯。キャラクターの銃なども
    暗いが、全長は暗くならないので dark_ratio で見分けられる。
    """
    n = len(dark_ratio)
    idx = [i for i, v in enumerate(dark_ratio) if v >= min_ratio]
    groups = []
    for i in idx:
        if groups and i - groups[-1][-1] <= 2:
            groups[-1].append(i)
        else:
            groups.append([i])
    return [(g[0], g[-1]) for g in groups
            if (g[-1] - g[0] + 1) <= n * max_width
            and g[0] > frame_skip and g[-1] < n - frame_skip]


def spans(size, lines):
    """区切り線の間（＝コマ）の範囲を返す。"""
    out = []
    start = 0
    for a, b in lines:
        if a - start > size * 0.05:
            out.append((start, a))
        start = b + 1
    if size - start > size * 0.05:
        out.append((start, size))
    return out


DARK = 300  # RGB合計がこれ未満なら「暗い画素」


def cut_cells(path):
    im = Image.open(path).convert('RGB')
    arr = np.asarray(im).astype(int).sum(axis=2)
    h, w = arr.shape
    is_dark = arr < DARK
    col_spans = spans(w, find_lines(is_dark.mean(axis=0)))
    row_spans = spans(h, find_lines(is_dark.mean(axis=1)))
    cells = []
    for (y0, y1) in row_spans:
        for (x0, x1) in col_spans:
            # 区切り線と、画像のいちばん外側の枠線を確実に落とすための内側マージン
            inset_x = max(8, int((x1 - x0) * 0.015))
            inset_y = max(8, int((y1 - y0) * 0.015))
            cells.append(im.crop((x0 + inset_x, y0 + inset_y,
                                  x1 - inset_x, y1 - inset_y)))
    return cells, len(col_spans), len(row_spans)


def background_color(cell):
    """四隅の色の中央値を背景色とみなす。"""
    a = np.asarray(cell).astype(int)
    h, w, _ = a.shape
    k = max(3, min(h, w) // 40)
    corners = np.concatenate([
        a[:k, :k].reshape(-1, 3), a[:k, -k:].reshape(-1, 3),
        a[-k:, :k].reshape(-1, 3), a[-k:, -k:].reshape(-1, 3),
    ])
    return np.median(corners, axis=0)


def drop_background(cell):
    """外側とつながっている背景色だけを透過する（内側の同色は残す）。"""
    a = np.asarray(cell).astype(int)
    h, w, _ = a.shape
    bg = background_color(cell)
    dist = np.abs(a - bg).max(axis=2)          # 背景色との差
    soft = dist <= SOFT_CLEAR

    seen = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if soft[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if soft[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and soft[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))

    alpha = np.full((h, w), 255, dtype=np.uint8)
    # 完全に背景の画素は透明、輪郭のきわは差に応じて半透明にする
    ramp = np.clip((dist - FULL_CLEAR) / float(SOFT_CLEAR - FULL_CLEAR), 0, 1) * 255
    alpha[seen] = ramp[seen].astype(np.uint8)

    out = np.dstack([np.asarray(cell).astype(np.uint8), alpha])
    return Image.fromarray(out, 'RGBA')


def square(im):
    """中身で切りつめて、透明の余白で正方形にし、512pxに揃える。"""
    bbox = im.split()[-1].point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    side = int(max(im.size) * (1 + PAD_RATIO * 2))
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 1
    out_dir, grid_path, names = argv[0], argv[1], argv[2:]
    os.makedirs(out_dir, exist_ok=True)

    cells, cols, rows = cut_cells(grid_path)
    print('grid: {}列 x {}行 = {}コマ'.format(cols, rows, len(cells)))
    if len(names) > len(cells):
        print('コマ数({})よりファイル名({})が多いです'.format(len(cells), len(names)))
        return 1

    for cell, name in zip(cells, names):
        if name == '-':
            continue
        path = os.path.join(out_dir, name + '.png')
        square(drop_background(cell)).save(path, optimize=True)
        print('wrote', path)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

# slide-on-neko（ねこ ならべ / Slide on NEKO）

ねこの顔をスライドして、タテかヨコに **4匹** そろえる落ちものパズルです。
そろった猫は行列をつくって **画面の右へ走って逃げていきます**。

バックエンドなし（HTML / CSS / Vanilla JavaScript のみ）。最高得点と設定は LocalStorage に保存します。
見た目と操作感は前作 [tap-on-neko（ねこの ともだち）](https://github.com/pikaring/tap-on-neko) に合わせてあります。

**紹介ページ → https://pikaring.github.io/slide-on-neko/**
**あそぶ → https://pikaring.github.io/slide-on-neko/app/**

## ファイル

紹介ページ（`/`）とゲーム本体（`/app/`）に分かれています。

| ファイル | 役割 |
| --- | --- |
| `index.html` | 紹介ページ。ほかのツールと同じデザイン（`assets/site.css`） |
| `assets/site.css` | 紹介ページの見た目。アクセント色はみどり `#3f8f57` |
| `assets/icon.svg` | アイコンの元データ（仮。猫の絵ができたら差し替え） |
| `assets/icon.png` / `assets/favicon.png` | 紹介ページ・OG画像用 |
| `app/index.html` | ゲームの画面（ヘッダー／ばん／おおきなボタン／モーダル） |
| `app/style.css` | 大きなUI・高コントラスト・アニメーション |
| `app/main.js` | ゲームロジック・そろい判定・落下・連鎖・LocalStorage |
| `app/manifest.json` | ホーム画面に追加したときの設定（PWA） |
| `app/images/` | 猫の顔の画像を置く場所（いまはアイコンのみ） |
| `docs/asset-prompts.md` | 猫の顔を画像生成AIで作るときのプロンプト |

## 遊びかた

- 隣り合う猫をドラッグ、またはタップ2回で入れかえます。
- タテかヨコに同じ猫が **4匹** そろうと、猫たちが画面の右へ走って逃げます。
- 空いたマスには上から新しい猫が降ってきます。落ちてきた猫がまたそろうと連鎖になり、得点が倍々になります。
- そろわない入れかえは元に戻ります（手数は増えません）。
- 入れかえる手がなくなったら、猫たちが自動で並びなおします。
- 制限時間もゲームオーバーもありません。

得点は `逃げた猫の数 × 10 ＋ 5匹以上そろった分のボーナス` に連鎖数を掛けた値です。
保存キーは `nekonarabe.best`（最高得点）と `nekonarabe.kinds`（猫の種類数）。

## 猫の絵の差し替え

暫定の丸（黒丸・白丸）は仮の表示です。画像ができたら2ステップで差し替えられます。

1. 画像を `app/images/` に置く（**顔だけ**の正方形・背景透過PNG、512px目安）。
2. `app/main.js` 冒頭の `CAT_TYPES` の `image` にパスを書く。

```js
const CAT_TYPES = [
  { key: 'kuro',      name: 'くろねこ', image: 'images/face-kuro.png' },
  { key: 'chashiro',  name: 'ちゃしろ', image: 'images/face-chashiro.png' },
  { key: 'kijitora',  name: 'キジトラ', image: 'images/face-kijitora.png' },
  { key: 'hachiware', name: 'ハチワレ', image: 'images/face-hachiware.png' },
  { key: 'mike',      name: 'みけねこ', image: 'images/face-mike.png' },
];
```

- 画像は読み込みに成功したときだけ使われます。パスを間違えても、その種類だけ丸のまま遊べます。
- 1種類ずつ順に差し替えても崩れません。
- 3×3のスプライトシート（前作と同じ形式）を使うときは `sheet: true` を足すと左上のコマだけを表示します。
- プロンプトは `docs/asset-prompts.md` にあります。

## 調整できるところ

`app/main.js` の冒頭にまとまっています。

| 定数 | 既定値 | 意味 |
| --- | --- | --- |
| `COLS` / `ROWS` | 7 / 8 | 盤面の列数・行数 |
| `MIN_MATCH` | 4 | 何匹そろったら逃げるか |
| `SWAP_MS` / `FALL_MS` | 170 / 260 | 入れかえ・落下のアニメ時間（ms） |
| `RUN_MS` / `RUN_STAGGER` / `ESCAPE_HOLD` | 900 / 55 / 230 | 右へ走る時間・行列のずれ・盤を詰めはじめるまで（ms） |

`SWAP_MS` / `FALL_MS` / `RUN_MS` は `app/style.css` の `--swap-ms` / `--fall-ms` / `--run-ms` と対になっているので、変えるときは両方そろえてください。

## ライセンス

MIT License

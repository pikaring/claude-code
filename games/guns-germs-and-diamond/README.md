# 銃・病原菌・ダイヤモンド（guns-germs-and-diamond）

以前サークル「鷹巣堂」で制作・頒布していたアナログカードゲーム
**「銃・病原菌・ダイヤモンド」**（ゲームマーケット2020春 出展）を、
ブラウザだけで遊べるHTML/JavaScriptゲームとして復刻したものです。

- 紹介ページ: [`index.html`](./index.html)（原作の紹介・ルール概要・あそぶボタン）
- ゲーム本体: [`app/index.html`](./app/index.html)（CPU対戦。開くとすぐ始まります）

どちらもビルド不要・外部ライブラリ不要で、ブラウザで直接開くだけで動作します。
`cat-on-escape` などと同じく、紹介ページ（`/`）とゲーム本体（`/app/`）を分ける構成です。

## 参考にした原作記事

ルールはいそのたかみ氏（鷹巣堂）のブログ記事から再構成しました。

- [銃・病原菌・ダイヤモンド カテゴリー一覧](https://isonotakami.hatenadiary.jp/archive/category/%E9%8A%83%E3%83%BB%E7%97%85%E5%8E%9F%E8%8F%8C%E3%83%BB%E3%83%80%E3%82%A4%E3%83%A4%E3%83%A2%E3%83%B3%E3%83%89)
- [ゲームマーケット2020春の新作ゲームのご紹介](https://isonotakami.hatenadiary.jp/entry/2020/02/02/190000)
- [銃・病原菌・ダイヤモンド〜ルール説明編〜](https://isonotakami.hatenadiary.jp/entry/2020/02/08/190000)
- [銃・病原菌・ダイヤモンド〜リプレイ編〜](https://isonotakami.hatenadiary.jp/entry/2020/02/09/190000)
- [銃・病原菌・ダイヤモンド製作記〜その１〜](https://isonotakami.hatenadiary.jp/entry/2020/02/15/190000)
- [銃・病原菌・ダイヤモンド製作記〜その２〜](https://isonotakami.hatenadiary.jp/entry/2020/02/16/190000)
- [委託販売をはじめました](https://isonotakami.hatenadiary.jp/entry/2020/04/07/190000)

原作クレジットとブログへのリンクは紹介ページ（`index.html`）にまとめてあり、
ゲーム画面（`app/index.html`）側には表示していません。

## ルール（本ブラウザ版での実装）

お互い同じ手札 `0`〜`4` を1枚ずつ（計5枚）持ちます。

| カード | 名称 | 強さ |
|---|---|---|
| 0 | 病原菌 | 1（偵察兵）以外の全カードと引き分け。1には負ける。 |
| 1 | 偵察兵 | 病原菌（0）には勝つが、2〜4の兵士には負ける。 |
| 2〜4 | 兵士 | 数字が大きい方が勝ち。同数は引き分け。 |

- 場には産出量の異なる5つの鉱山が、常に **左から💎1・2・3・4・5の順** で並びます。
- 各ラウンドの開始時、両者は手札を **0〜4にリセット** します。
- **毎ラウンド、5つの鉱山すべてに1枚ずつ配置**します（鉱山は盤から消えません）。
  手札のカードをクリックすると、自分のカードがまだ乗っていない一番左の鉱山へ自動的に置かれます。
  置きなおしたいときは、その鉱山をクリックすると手札に戻ります。
- 自分が置いたカードは伏せずに絵と数字が見えたまま **手前側（下段）** に表示され、
  CPU側（上段）だけが「？」で隠れます。
- 配置が終わったら鉱山を左から順にオープンし、強いカードを出した方がその鉱山のダイヤモンドを獲得します。
- **鉱山は毎ラウンド復活します。** 取られた鉱山には、次のラウンドに同じ産出量の鉱山カードが
  1枚 配り直されます（💎5の鉱山を取っても、次のラウンドはそこが💎5の1枚に戻る）。
- **引き分けた鉱山はカードが積み重なります。** 💎4の鉱山が引き分けなら、
  次のラウンドはそこが💎4が2枚（合計8点）になります。
- ゲームは全3ラウンド。3ラウンド目でも引き分けだった鉱山のダイヤモンドは、
  どちらの手にも渡らず失われます。獲得ダイヤモンド合計が多い方の勝ちです。

## カードの絵

カードの絵は画像生成AI（Gemini）で作った5枚を `app/images/` に置いています。

| ファイル | カード |
| --- | --- |
| `app/images/card-germ.png` | 0 病原菌 |
| `app/images/card-scout.png` | 1 偵察兵 |
| `app/images/card-soldier2.png` | 2 兵士（新兵） |
| `app/images/card-soldier3.png` | 3 兵士（軍曹） |
| `app/images/card-soldier4.png` | 4 兵士（将校） |

差し替え口は `app/index.html` 冒頭の `CARD_TYPES` です。画像は **読みこめたときだけ** 使われ、
パスを間違えても数字表示のままで遊べます。

```js
var CARD_TYPES = {
  0: { label:'0', name:'病原菌', cls:'germ',  image:'images/card-germ.png' },
  1: { label:'1', name:'偵察兵', cls:'scout', image:'images/card-scout.png' },
  2: { label:'2', name:'兵士',   cls:'',      image:'images/card-soldier2.png' },
  3: { label:'3', name:'兵士',   cls:'',      image:'images/card-soldier3.png' },
  4: { label:'4', name:'兵士',   cls:'',      image:'images/card-soldier4.png' }
};
```

描き直すときの手順は [`docs/asset-prompts.md`](./docs/asset-prompts.md) にあります
（Gemini用プロンプト＋グリッド画像の切り分け）。切り分けは
[`tools/make_cards.py`](./tools/make_cards.py) が、区切り線の検出・背景の透過・
正方形512pxへの統一までまとめて行います。

```
pip install pillow numpy
python3 tools/make_cards.py app/images grid.webp \
    card-germ card-scout card-soldier2 - card-soldier3 - card-soldier4 -
```

## 実装メモ

- `app/index.html` に HTML / CSS / JavaScript をすべて内包しており、外部依存はありません
  （絵は `app/images/` のPNGのみ）。
- 対戦相手はCPUのみです（2人対戦モードはありません）。タイトル画面はなく、開くとすぐ始まります。
- 鉱山ごとの結果は文章では書かず、枠の色と勝ち札／負け札の明暗で示しています
  （経過は画面下のログに1行ずつ出ます）。
- CPUのAIは、積み増しされた鉱山を優先しつつ病原菌・偵察兵を配分する簡易ヒューリスティックです
  （最適戦略ではなく、カジュアルに遊べる強さを狙っています）。

## 今後の余地

`cat-on-escape` のように専用リポジトリ＋GitHub Pagesで公開する場合は、
このフォルダをそのまま新リポジトリのルートに移せば
`index.html`（紹介ページ）／`app/index.html`（ゲーム本体）構成が成立します。
本リポジトリ内ではGitHub Pagesの設定やアクセス解析などの外部連携は行っていません。

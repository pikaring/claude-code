# このリポジトリの きまり

pikaring の ツール群（tap-on-kotoba / tap-on-neko / reach-on-sanma / all-in-texas /
ride-on-qc / eat-on-gpx / rock-on-mj / cat-on-escape / guns-germs-and-diamond）は、
**見た目も 作りも そろえる**方針です。新しいページや 節を つくるときは、
**先にある ページを 見て 同じ形に 合わせてください**。迷ったら tap-on-neko と
reach-on-sanma が 基準です。

## 紹介ページ（`/index.html`）に かならず 入れるもの

| もの | 形 |
| --- | --- |
| デザイン | `assets/site.css`（共通。アクセント色だけ 変える。ここは 鉱山の 真鍮色 `#b07d2b`） |
| 節の ならび | `hero` → `specs` → `goods`（本・グッズ）→ 中身の節 → `faq` → `cta` → `family` → `footer` |
| ポータルへの リンク | `family` の節に 1つだけ（`https://pikaring.github.io/`） |
| アクセスカウンター | フッターに `<span class="counter">累計アクセス <b id="counter-value">―</b> 回</span>` と GAS を 呼ぶ script |
| アソシエイトの 表示 | フッターに `<span class="disclosure">…</span>` |
| 原作の クレジット | フッターに 1行（鷹巣堂のアナログゲームが 原作。ゲーム画面には 出さない） |
| フッター | `GitHub` / `README` / `MIT License · pikaring · 依存ライブラリなし` |
| OG | `og:title` / `og:description` / `og:url` / `og:image`（`assets/icon.png`） |

## 本・グッズ（Amazonアソシエイト）

- カードは `<div class="good" data-asin="ASIN">`、リンクは `https://www.amazon.co.jp/dp/ASIN?tag=redcomet-22`
  （`target="_blank" rel="sponsored noopener"`、文言は「Amazonで見る ↗」）
- 表紙画像と価格は `assets/goods.json` から 後づけ。`tools/fetch_goods.py` が Creators API で 取り、
  `.github/workflows/goods.yml` が 毎日 3:00 JST に 更新する
- Secrets：`CREATORS_CLIENT_ID` / `CREATORS_CLIENT_SECRET`（未登録でも ワークフローは 失敗しない）
- ASIN が わからない ときは 当てずっぽうで 書かない。Creators API の `searchItems` で 実在を 確かめる
- いま 載せているのは 4冊：銃・病原菌・鉄（上）／放課後さいころ倶楽部（1）／
  ライナー・クニツィアのダイス・トランプゲーム集／コボルドのボードゲームデザイン

## アプリ（`/app/`）

- 卓（緑のラシャ）の上に、上段＝相手の札・中段＝鉱山カード・下段＝自分の札を 並べる
- 原作の カード名（Germs / Scout / Commandos / Cavalry / Battalion）に そろえる
- 画像は 読みこめた ときだけ 使い、だめなら 数字だけで 遊べるようにする
- ゲーム画面には 原作クレジットや 紹介文を 出さない（紹介ページの 役目）
- 対戦相手は all-in-texas の `PERSONAS` と 同じ5人。`tight` / `aggr` / `bluff` の 値も そろえる
- アイコンは `tools/make_icons.py` が 鉱山カードの 絵柄から つくる

## 検索エンジン向け（共通）

| もの | 形 |
| --- | --- |
| `sitemap.xml` | サイトの 根に 置く。紹介ページと `/app/` の 2本。`<loc>` と `<lastmod>` だけ |
| `rel="canonical"` | 紹介ページと `/app/` の `<head>` に 1つずつ。末尾は `/` |
| JSON-LD | `<head>` の 末尾に 1つ。`WebApplication` + `GameApplication` |
| `description` | 探すときの ことばを 入れる。JSON-LD の `description` と 同じ 文にする |

- `robots.txt` は **`pikaring.github.io` リポジトリの 根に 1つだけ**。
  サイトを 増やしたら そこの `Sitemap:` 行を 足す
- FAQ の 構造化データは 入れない

## アクセス解析（GA4）

- 測定ID は `G-3FCFQY4W85`。ほかのサイトと 同じ プロパティ
- 入れるのは **紹介ページ（`/index.html`）だけ**。`/app/` には 入れない
- 置きどころは `<head>` の、`location.replace('app/')` より **後ろ**、JSON-LD より **手前**

## GitHub Pages

Settings → Pages → Source: `Deploy from a branch` → Branch: `main` / `/ (root)`

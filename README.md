# Qommons AI 利用状況レポート(毎朝8時 JST 自動実行)

毎朝 8:00(日本時間)に Claude の定期タスク(Routine)が起動し、以下を行います。

1. Qommons AI にメール+パスワードでログイン(Playwright によるブラウザ自動操作)
2. 利用者ログ(QuickSight ダッシュボード)から当月1日〜当日の利用ログ CSV をダウンロード
3. CSV を集計して簡易レポート(Markdown)を `reports/YYYY-MM-DD.md` に生成
4. `build_report.py` で「QommonsAI利用集計.xlsx」形式の詳細集計ブックを再構築
   (`reports/QommonsAI利用集計_YYYY-MM.xlsx` として保存、最新月は
   リポジトリ直下の `QommonsAI利用集計.xlsx` にも複製)
5. このリポジトリ(非公開)の `main` にコミット・プッシュし、要点をプッシュ通知・ファイル送付

## 実行環境の前提

Claude Code on the web の環境(Environment)設定:

| 項目 | 内容 |
|---|---|
| ネットワーク | `qommons.ai` と QuickSight(`*.quicksight.aws.amazon.com`)に到達できること(フルアクセスで可) |
| `QOMMONS_EMAIL` | ログイン用メールアドレス(環境変数) |
| `QOMMONS_PASSWORD` | パスワード(環境変数) |
| `QOMMONS_URL` | (任意)ログインページ URL。既定は `https://qommons.ai/login` |

認証情報はリポジトリ・レポート・ログには一切書き込みません。
利用ログ CSV(職員の発話内容を含む)もコミットしません(`.gitignore` 済み)。

## 手動実行

```sh
npm init -y && npm i playwright   # 初回のみ(ブラウザ本体はプリインストール済み)
node fetch_logs.mjs
```

成功すると `downloads/qommons-log-YYYY-MM-DD.csv` が保存されます。
失敗時は `debug/` にスクリーンショットとページ HTML が残ります。

## 実機確認済みのフロー(2026-07-20)

1. `/login`: `input[name=username]` / `input[name=password]` → 「ログイン」ボタン(CAPTCHA・2FAなし)
2. `/log-dashboard`(利用者ログ)は Amazon QuickSight の iframe 埋め込み。
   iframe 内からのダウンロードはヘッドレスで検知できないため、埋め込み URL を
   リクエスト横取りで取得し、トップレベルページとして開く
3. Controls 展開 → `input[aria-label="Enter a date"]` ×2 に開始日・終了日を入力
4. 「利用ログ」テーブルにホバー → `[aria-label="Menu options, 利用ログ, Table"]`
   → 「Export to CSV」

CSV の列: `ユーザー名, 利用日時, ai_name_new, model_name, 入出力内容`

## リモート実行環境向けの対応(スクリプトが自動処理)

- 外向き HTTPS はプロキシ経由 → Chromium にプロキシを明示指定
- プロキシの TLS 再終端 → CA を NSS ストアへ毎回登録(libnss3-tools を自動インストール)
- プロキシが Chromium の TLS1.3 ClientHello を処理できない → TLS1.2 上限を指定

## 詳細集計ブック(QommonsAI利用集計.xlsx)の自動再構築

`build_report.py` は、2026-07-20 にユーザーから提供された既存の集計ブック
(「利用ログ.xlsx」から手動生成されていたもの)と同じ構成を、生ログ CSV +
登録者マスタから機械的に再現する。

```sh
python3 build_report.py [CSVパス]   # 省略時は downloads/ の最新ファイル
```

### 使うファイル

| ファイル | 役割 |
|---|---|
| `registrants.csv` | メール↔氏名・部署の登録者マスタ。HRの異動があれば手動で更新する |
| `report_settings.json` | 業務削減効果試算の前提値(人件費・労働時間など)。編集可 |
| `reports/QommonsAI利用集計_YYYY-MM.xlsx` | 生成される月次の集計ブック(コミット対象) |
| `QommonsAI利用集計.xlsx` | 常に最新月を指す複製(デスクトップに保存する際はこれを使う) |

### 再現できているシート(2026-07-20 に実データで検証済み、既存ファイルとの誤差1%未満)

部署別集計・個人別集計(削減時間含む)・課別文字数TOP3・対応表・
モデル/機能別集計・時間帯/曜日別集計・利用者推移・入出力の文字数分布/
ファイル添付率/機能別平均文字数。

個人別「削減時間」の式: `(入力文字数×0.012分 + 出力文字数×0.002分) ÷ 60` [時間]
(実データから逆算して確認済み)。

### 既知の制限(自動化できていない/近似の箇所)

- **業務削減効果_試算シートの「１つの文脈での質問数(C)」**:
  生ログに会話スレッドIDが無く、この値の再計算方法が不明。
  `report_settings.json` の `context_questions_per_thread`(初期値 4.109、
  提供された既存ファイルの値をそのまま引き継ぎ)を毎回そのまま使う。
  正しい算出方法が分かれば `build_report.py` の該当ロジックに反映する。
- **頻出フレーズ Top30**: 簡易な N-gram 頻度集計による参考値。
  既存ファイルの元アルゴリズムとは一致しない可能性がある。
- **登録者マスタに無いメールアドレス**(新規採用者や `NNNNNN@北海道_函館市`
  形式の一部アカウントなど)は部署「(未登録)」として集計される。
  `system@city.hakodate.hokkaido.jp` は総務部情報システム課として固定的に
  扱う(既存ファイルの注記と同じ扱い)。
- 添付ファイル付きプロンプトの入力文字数は、生ログのJSON構造から
  `message` フィールドを抽出して数えているが、既存ファイルとの数値差が
  ごく僅か(部署合計で1%未満)残っている。原因は未特定(添付関連の
  取り扱い方法の細部の違いと推測)。

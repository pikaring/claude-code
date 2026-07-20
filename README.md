# Qommons AI 利用状況レポート(毎朝8時 JST 自動実行)

毎朝 8:00(日本時間)に Claude の定期タスク(Routine)が起動し、以下を行います。

1. Qommons AI にメール+パスワードでログイン(Playwright によるブラウザ自動操作)
2. 利用者ログ(QuickSight ダッシュボード)から当月1日〜当日の利用ログ CSV をダウンロード
3. CSV を集計して利用状況レポート(Markdown)を `reports/YYYY-MM-DD.md` に生成
4. このリポジトリ(非公開)の `main` にコミット・プッシュし、要点をプッシュ通知

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

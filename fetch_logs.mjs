// Qommons AI 利用ログ CSV 自動ダウンロードスクリプト
//
// 使い方:
//   node qommons-report/fetch_logs.mjs
//
// 必要な環境変数:
//   QOMMONS_EMAIL    ログイン用メールアドレス
//   QOMMONS_PASSWORD ログイン用パスワード
//   QOMMONS_URL      (任意) ログインページ URL。既定: https://qommons.ai/login
//
// 出力:
//   qommons-report/downloads/qommons-log-YYYY-MM-DD.csv(当月1日〜当日 JST)
//   失敗時は qommons-report/debug/ にスクリーンショットと HTML を保存して exit 1。
//
// 実機で確認済みのフロー (2026-07-20):
//   1. /login で input[name=username] / input[name=password] → 「ログイン」ボタン
//   2. /log-dashboard(利用者ログ)は Amazon QuickSight ダッシュボードの iframe 埋め込み。
//      iframe 内からのダウンロードはヘッドレスで拾えないため、iframe の埋め込み URL を
//      リクエスト横取りで取得し(URL は使い捨てなので iframe 側は abort)、トップレベルで開く。
//   3. Controls を展開 → input[aria-label="Enter a date"] ×2 に開始日・終了日を入力
//   4. 「利用ログ」テーブルにホバー → [aria-label="Menu options, 利用ログ, Table"]
//      → menuitem「Export to CSV」でダウンロード
//
// 環境まわり(リモート実行環境向け):
//   - 外向き HTTPS はプロキシ経由(HTTPS_PROXY)。Chromium には明示指定が必要
//   - プロキシが TLS を再終端するため CA を NSS ストアに登録(毎コンテナで必要)
//   - プロキシは Chromium の TLS1.3 ClientHello を処理できないため TLS1.2 上限を指定

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const LOGIN_URL = process.env.QOMMONS_URL || 'https://qommons.ai/login';
const EMAIL = process.env.QOMMONS_EMAIL;
const PASSWORD = process.env.QOMMONS_PASSWORD;

const here = path.dirname(new URL(import.meta.url).pathname);
const downloadsDir = path.join(here, 'downloads');
const debugDir = path.join(here, 'debug');
fs.mkdirSync(downloadsDir, { recursive: true });
fs.mkdirSync(debugDir, { recursive: true });

if (!EMAIL || !PASSWORD) {
  console.error('ERROR: QOMMONS_EMAIL / QOMMONS_PASSWORD が設定されていません。');
  process.exit(2);
}

const executablePath = process.env.QOMMONS_CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

const launchArgs = ['--ssl-version-max=tls1.2'];
if (proxy && fs.existsSync('/root/.ccr/agent-proxy-ca.crt')) {
  try {
    execSync('which certutil || { apt-get update -qq && apt-get install -y -qq libnss3-tools; }', { stdio: 'pipe', timeout: 180000 });
    execSync('mkdir -p $HOME/.pki/nssdb && (certutil -d sql:$HOME/.pki/nssdb -L -n ccr-agent-proxy 2>/dev/null || certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n ccr-agent-proxy -i /root/.ccr/agent-proxy-ca.crt)', { stdio: 'pipe', timeout: 30000 });
  } catch (e) {
    console.error(`WARN: CA 証明書の NSS 登録に失敗: ${e.message}`);
  }
}

async function dumpDebug(page, tag) {
  try {
    await page.screenshot({ path: path.join(debugDir, `${tag}.png`), fullPage: true });
    fs.writeFileSync(path.join(debugDir, `${tag}.html`), await page.content());
    console.error(`debug: ${tag}.png / ${tag}.html を保存しました (${debugDir})`);
  } catch (e) {
    console.error(`debug dump failed: ${e.message}`);
  }
}

const browser = await chromium.launch({ executablePath, proxy, args: launchArgs });
const context = await browser.newContext({ acceptDownloads: true, locale: 'ja-JP' });
const page = await context.newPage();

try {
  // 1. ログイン
  // .fill() だとReact側のonChangeが検知せず「ログイン」ボタンがdisabledの
  // ままになることがあった(2026-08-07の本番実行で発生)。1文字ずつ入力する
  // pressSequentially に切り替え、ボタンが有効化されるまで待ってからクリックする。
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  const emailInput = page.locator('input[name="username"], input[type="email"], input[placeholder*="メール"]').first();
  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
  await emailInput.click({ timeout: 15000 });
  await emailInput.pressSequentially(EMAIL, { delay: 30 });
  await passwordInput.click();
  await passwordInput.pressSequentially(PASSWORD, { delay: 30 });
  const loginButton = page.getByRole('button', { name: /ログイン|log ?in/i }).first();
  await loginButton.evaluate(el => !el.disabled, { timeout: 15000 }).catch(() => {});
  const enabled = await loginButton.isEnabled().catch(() => false);
  if (!enabled) {
    // 念のためもう一度、値をクリアしてから入力し直す
    await emailInput.fill('');
    await emailInput.pressSequentially(EMAIL, { delay: 50 });
    await passwordInput.fill('');
    await passwordInput.pressSequentially(PASSWORD, { delay: 50 });
    await page.waitForTimeout(1000);
  }
  await loginButton.click({ timeout: 15000 });
  await page.waitForTimeout(5000);

  if (page.url().includes('/login')) {
    await dumpDebug(page, 'login-failed');
    throw new Error(`ログインに失敗した可能性があります(現在URL: ${page.url()})`);
  }

  // 2. 利用者ログ(QuickSight 埋め込み)の URL を横取りし、iframe 側は中断
  let embedUrl = null;
  await page.route('**quicksight.aws.amazon.com/embed/**', route => {
    if (!embedUrl) { embedUrl = route.request().url(); route.abort('aborted'); }
    else route.continue();
  });
  await page.goto('https://qommons.ai/log-dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 30 && !embedUrl; i++) await page.waitForTimeout(1000);
  if (!embedUrl) {
    await dumpDebug(page, 'no-embed-url');
    throw new Error('QuickSight 埋め込み URL を取得できませんでした(/log-dashboard の構成が変わった可能性)');
  }
  await page.unroute('**quicksight.aws.amazon.com/embed/**');

  // 3. QuickSight をトップレベルで開く
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const pad = n => String(n).padStart(2, '0');
  // QOMMONS_START_DATE / QOMMONS_END_DATE / QOMMONS_FILE_DATE を設定すると、
  // 当月以外の期間(例: 過去月の再取得)を明示指定できる。未設定時は従来通り
  // 当月1日〜当日(JST)。
  const start = process.env.QOMMONS_START_DATE || `${now.getFullYear()}/${pad(now.getMonth() + 1)}/01 00:00:00`;
  const end = process.env.QOMMONS_END_DATE || `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} 23:59:59`;
  const fileDate = process.env.QOMMONS_FILE_DATE || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // 月末に近づき対象件数が増えると、QuickSight側のクエリが
  // "Getting data for this visualization took too long" で失敗し、
  // Export to CSV が disabled のまま(=何度リトライしても無駄)になることがある
  // (2026-07-27 の本番実行で発生)。この場合はページを再読み込みして
  // 日付設定からやり直す。
  const tooLongError = page.getByText('Getting data for this visualization took too long');
  let tableReady = false;
  for (let loadAttempt = 1; loadAttempt <= 3 && !tableReady; loadAttempt++) {
    if (loadAttempt === 1) {
      await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    } else {
      console.error(`テーブルのクエリタイムアウトを検知。ページを再読み込みして再試行します(${loadAttempt}回目)。`);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    }
    await page.waitForTimeout(15000);

    // Controls を展開して日付を当月1日〜当日(JST)に設定
    await page.locator('[aria-label="Controls"]').click().catch(() => {});
    await page.waitForTimeout(2000);
    const dates = page.locator('input[aria-label="Enter a date"]');
    await dates.nth(0).waitFor({ state: 'visible', timeout: 15000 });
    await dates.nth(0).fill(start); await dates.nth(0).press('Enter');
    await page.waitForTimeout(2000);
    await dates.nth(1).fill(end); await dates.nth(1).press('Enter');
    console.log(`期間設定: ${start} 〜 ${end}`);
    await page.waitForTimeout(20000); // データ再読み込み待ち(月末は通常より長めに待つ)

    // テーブルに実データ行が表示される(=エクスポート操作が可能になる)まで待つ。
    // 「利用ログ」テーブル本体は座標が変わりやすいため、行データらしきテキスト
    // (メールアドレス形式のセル)が現れるまでポーリングする。
    const tableLoaded = page.locator('text=/@city\\.hakodate\\.hokkaido\\.jp/').first();
    const raceResult = await Promise.race([
      tableLoaded.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'loaded').catch(() => 'timeout'),
      tooLongError.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'query_timeout').catch(() => 'timeout'),
    ]);
    if (raceResult === 'loaded') {
      tableReady = true;
    } else if (raceResult === 'query_timeout') {
      continue; // ページ再読み込みして再試行
    } else {
      console.error('WARN: テーブル行の読み込み確認がタイムアウトしました。そのまま続行します。');
      tableReady = true; // 判定不能。従来通りとりあえず先に進む
    }
  }
  await page.waitForTimeout(2000);

  // 5. 「利用ログ」テーブルにホバー → メニュー → Export to CSV
  const vis = page.locator('text=Table, 利用ログ').first();
  const menuBtn = page.locator('[aria-label="Menu options, 利用ログ, Table"]');

  // QuickSightのツールバー(3点リーダー)はマウスホバー中しか表示されない。
  // ループの外で1回だけホバーすると、前の試行のEscapeキーやクリックで
  // マウスが離れた際にツールバーが消え、次の試行でメニューボタンの
  // クリックがタイムアウトすることがあった(2026-07-24 の本番実行で発生)。
  // 各試行の冒頭で毎回ホバーし直す。
  async function hoverVisual() {
    const box = await vis.boundingBox().catch(() => null);
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.waitForTimeout(1500);
  }
  await hoverVisual();
  await menuBtn.waitFor({ state: 'visible', timeout: 20000 });

  // メニュー項目が無効(データ未読み込み)な場合があるため、開き直しながら数回試す。
  let download;
  let lastErr;
  for (let attempt = 1; attempt <= 3 && !download; attempt++) {
    // 前の試行で使った waitForEvent の Promise が残っていると、この試行が
    // 終わった後にバックグラウンドでタイムアウト→未処理rejectionでプロセスが
    // クラッシュすることがあった(2026-07-23 の本番実行で発生)。必ず
    // .catch() を付けて破棄し、次の試行に進む。
    let dl;
    try {
      if (attempt > 1) await hoverVisual();
      await menuBtn.click();
      await page.waitForTimeout(1500);
      const exportItem = page.locator('[role="menuitem"]:has-text("Export to CSV")').first();
      await exportItem.waitFor({ state: 'visible', timeout: 10000 });
      dl = page.waitForEvent('download', { timeout: 120000 }); // 件数が多いと生成に時間がかかる
      await exportItem.click({ timeout: 10000 });
      download = await dl;
    } catch (e) {
      lastErr = e;
      if (dl) dl.catch(() => {}); // 未処理rejection化を防ぐ
      console.error(`Export to CSV 試行${attempt}回目 失敗: ${e.message.split('\n')[0]}`);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(8000);
    }
  }
  if (!download) throw lastErr || new Error('Export to CSV に繰り返し失敗しました');
  const outPath = path.join(downloadsDir, `qommons-log-${fileDate}.csv`);
  await download.saveAs(outPath);
  console.log(`DOWNLOADED: ${outPath}`);
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  await dumpDebug(page, 'error');
  process.exitCode = 1;
} finally {
  await browser.close();
}

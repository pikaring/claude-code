// Qommons AI 組織メンバー一覧(登録者マスタ)自動ダウンロードスクリプト
//
// 使い方:
//   node fetch_registrants.mjs
//
// 必要な環境変数:
//   QOMMONS_EMAIL    ログイン用メールアドレス
//   QOMMONS_PASSWORD ログイン用パスワード
//   QOMMONS_URL      (任意) ログインページ URL。既定: https://qommons.ai/login
//
// 出力:
//   downloads/qommons-member-template-YYYY-MM-DD.xlsx
//   失敗時は debug/ にスクリーンショットを保存して exit 1。
//
// 実機で確認済みのフロー (2026-08-07):
//   1. /login でログイン(入力欄は pressSequentially で1文字ずつ入力しないと
//      React側のonChangeが検知されずログインボタンが disabled のままになることがある)
//   2. 画面左下のアカウント名(部署名表示)をクリック → 「組織管理」→ /management へ遷移
//   3. 右上「管理」ボタン → 「メンバー登録」→ モーダルの
//      「ダウンロード：20,000件テンプレート」リンクをクリック
//   4. ダウンロードされる Excel の「ユーザー」シートには、テンプレートという名前だが
//      実際は現在の登録メンバー全員が事前入力された状態で入っている
//      (メールアドレス/職員番号ログインID・氏名・カナ・アクセスレベル・部署名・
//      本パスワード設定状況(完了/未完了) など、registrants.csv と同じ情報が揃う)。
//
// このスクリプトは Excel をダウンロードするだけで、registrants.csv への反映は行わない
// (差分確認のうえ手動/別途スクリプトで更新すること)。

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
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  const userField = page.locator('input[name="username"], input[type="email"], input[placeholder*="メール"]').first();
  await userField.click();
  await userField.pressSequentially(EMAIL, { delay: 30, timeout: 15000 });
  const passField = page.locator('input[name="password"], input[type="password"]').first();
  await passField.click();
  await passField.pressSequentially(PASSWORD, { delay: 30 });
  const loginBtn = page.getByRole('button', { name: /ログイン|log ?in/i }).first();
  await loginBtn.waitFor({ state: 'visible', timeout: 15000 });
  for (let i = 0; i < 30 && !(await loginBtn.isEnabled()); i++) await page.waitForTimeout(500);
  await loginBtn.click();
  await page.waitForTimeout(5000);

  if (page.url().includes('/login')) {
    await dumpDebug(page, 'registrants-login-failed');
    throw new Error(`ログインに失敗した可能性があります(現在URL: ${page.url()})`);
  }

  // 2. 組織管理へ移動。左下のアカウントメニュー(部署名表示、アカウントごとに文言が
  //    異なる)をクリックしてメニューを開く。部署名の文言に依存しないよう、画面
  //    左下(サイドバー最下部)にあるクリック可能要素を座標ベースで特定する。
  const viewport = page.viewportSize() || { width: 1280, height: 720 };
  await page.mouse.click(120, viewport.height - 45);
  await page.waitForTimeout(1000);
  if (!(await page.locator('text=組織管理').count())) {
    await dumpDebug(page, 'registrants-no-account-menu');
    throw new Error('アカウントメニュー(組織管理へのリンク)が開けませんでした');
  }
  await page.locator('text=組織管理').first().click({ timeout: 15000 });
  await page.waitForTimeout(3000);
  if (!page.url().includes('/management')) {
    await dumpDebug(page, 'registrants-no-management-page');
    throw new Error(`組織管理ページへの遷移に失敗しました(現在URL: ${page.url()})`);
  }

  // 3. 「管理」→「メンバー登録」→ テンプレートダウンロード
  await page.getByText('管理', { exact: true }).last().click({ timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.getByText('メンバー登録', { exact: true }).click({ timeout: 15000 });
  await page.waitForTimeout(2000);

  const dlPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.getByText('ダウンロード：20,000件テンプレート').click({ timeout: 15000 });
  const download = await dlPromise;

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const pad = n => String(n).padStart(2, '0');
  const fileDate = process.env.QOMMONS_FILE_DATE || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const outPath = path.join(downloadsDir, `qommons-member-template-${fileDate}.xlsx`);
  await download.saveAs(outPath);
  console.log(`DOWNLOADED: ${outPath}`);
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  await dumpDebug(page, 'registrants-error');
  process.exitCode = 1;
} finally {
  await browser.close();
}

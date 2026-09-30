// Qommons AI 利用ログ CSV 自動取得スクリプト
//
// 使い方:
//   node fetch_logs.mjs
//
// 必要な環境変数:
//   QOMMONS_EMAIL    ログイン用メールアドレス
//   QOMMONS_PASSWORD ログイン用パスワード
//   QOMMONS_URL      (任意) ログインページ URL。既定: https://qommons.ai/login
//   QOMMONS_START_DATE / QOMMONS_END_DATE / QOMMONS_FILE_DATE (任意) 期間とファイル名の日付。
//     既定は当月1日〜当日(JST)。形式は "YYYY/MM/DD HH:MM:SS" / "YYYY-MM-DD"
//   QOMMONS_PREFECTURE / QOMMONS_MUNICIPALITY (任意) 既定: 北海道 / 北海道_函館市
//
// 出力:
//   downloads/qommons-log-YYYY-MM-DD.csv       従来(QuickSight時代)と同じ5列形式
//     ユーザー名, 利用日時(YYYY-MM-DD HH:MM:SS), ai_name_new, model_name, 入出力内容
//   downloads/qommons-log-YYYY-MM-DD.meta.json 日別の取得件数・重複除去の診断情報
//   失敗時は debug/ にスクリーンショットと HTML を保存して exit 1。
//
// 2026-10-01 画面変更への対応:
//   /log-dashboard が QuickSight 埋め込みから自社ダッシュボード
//   (iframe name="qd-logs", https://dashboard.qommons.ai/dashboard-server/logs)に変わった。
//   画面の「CSV > 全 N 件をダウンロード」は新しい順に最大1万件で打ち切られ、入出力内容も
//   1万文字で切られるため使わない。代わりに画面が内部で使っている
//   POST /dashboard-server/api/logs/entries(pageSize 上限100、深いページも取得可)を
//   iframe 内から日単位で全ページ取得する(1リクエスト約1秒、4並列)。
//
//   ★新APIは一部の発言を「同じ発言×複数モデル名」で何十〜何百行にも重複して返す
//   (2026-09-20 の検証で実40件が576件に膨張。旧データと照合すると、重複除去後の件数は
//   旧データと一致し、1行しかない発言のモデル名は正しかった)。そのため
//   (ユーザー名, 利用日時, 入出力内容) で重複除去し、モデル名が1種類ならそれを採用する。
//   複数種類に分かれた発言は、旧データとの照合(9/20・9/24・9/25 の計14件)ですべて
//   Claude Opus 4.8 だったため Claude Opus 4.8 とみなす(件数は meta.json の multiModel)。
//
//   ★入出力内容の長さ: 旧QuickSightのCSVは約2,000文字、新APIは10,000文字で切られる。
//   文字数ベースの指標は 2026-09 分の再取得以降、それ以前の月より大きく出る。
//   旧形式との互換のため、モデルIDは表示名に変換し、user 発言には "user#" を付ける。
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

  // 2. 利用者ログ(dashboard.qommons.ai の iframe)を開き、セッションが張られるのを待つ
  await page.goto('https://qommons.ai/log-dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let fr = null;
  for (let i = 0; i < 60 && !fr; i++) {
    fr = page.frames().find(f => f.url().includes('dashboard.qommons.ai/dashboard-server/logs')) || null;
    if (!fr) await page.waitForTimeout(1000);
  }
  if (!fr) {
    await dumpDebug(page, 'no-log-frame');
    throw new Error('利用者ログの iframe(dashboard.qommons.ai)が見つかりません(画面構成が変わった可能性)');
  }
  await fr.locator('input[type=date]').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);

  // 3. 期間(JST)
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const start = process.env.QOMMONS_START_DATE || `${now.getFullYear()}/${pad(now.getMonth() + 1)}/01 00:00:00`;
  const end = process.env.QOMMONS_END_DATE || `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} 23:59:59`;
  const fileDate = process.env.QOMMONS_FILE_DATE || ymd(now);
  const prefecture = process.env.QOMMONS_PREFECTURE || '北海道';
  const municipality = process.env.QOMMONS_MUNICIPALITY || '北海道_函館市';
  const toDate = s => { const [y, m, d] = s.slice(0, 10).split(/[\/-]/).map(Number); return new Date(y, m - 1, d); };
  const days = [];
  for (let d = toDate(start); d <= toDate(end); d.setDate(d.getDate() + 1)) days.push(ymd(d));
  console.log(`期間設定: ${days[0]} 〜 ${days[days.length - 1]}(${days.length}日)`);

  // 4. 日単位で全ページを取得
  const MODEL_NAMES = {
    'claude-4-6-sonnet': 'Claude Sonnet 4.6', 'claude-4-8-opus': 'Claude Opus 4.8',
    'claude-4-5-haiku': 'Claude Haiku 4.5', 'claude-5-sonnet': 'Claude Sonnet 5', 'claude-5-opus': 'Claude Opus 5',
    'gpt-5.4-azure': 'GPT-5.4', 'gpt-5.4-mini': 'GPT-5.4 mini', 'gpt-5.5': 'GPT-5.5',
    'gpt-5.6-sol': 'GPT-5.6 Sol', 'gpt-5.6-terra': 'GPT-5.6 Terra', 'gpt-5.6-luna': 'GPT-5.6 Luna',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro', 'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite',
    'gemini-2.5-pro': 'Gemini 2.5 Pro', 'gemini-3.5-flash': 'Gemini 3.5 Flash',
    'gemini-3.6-flash': 'Gemini 3.6 Flash', 'gemini-3.7-flash': 'Gemini 3.7 Flash',
    'plamo-3.0-prime': 'PLaMo 3.0 Prime',
  };
  const fetchDay = (day) => fr.evaluate(async ({ day, prefecture, municipality }) => {
    const filters = { from: day, to: day, prefecture, municipality };
    const get = async (page) => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          const r = await fetch('/dashboard-server/api/logs/entries', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ filters, page, pageSize: 100 }),
          });
          if (r.ok) { const j = await r.json(); return j.data; }
        } catch (e) {}
        await new Promise(res => setTimeout(res, 2000 * attempt));
      }
      throw new Error(`entries 取得失敗 ${day} page ${page}`);
    };
    const first = await get(1);
    const total = first.totalCount;
    const pages = Math.ceil(total / 100);
    const out = new Array(pages); out[0] = first.entries;
    let next = 2;
    const worker = async () => { while (next <= pages) { const p = next++; out[p - 1] = (await get(p)).entries; } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { total, entries: out.flat() };
  }, { day, prefecture, municipality });

  const csvEsc = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [];
  const meta = { generatedAt: new Date().toISOString(), prefecture, municipality, days: {} };
  for (const day of days) {
    let res = await fetchDay(day);
    if (res.entries.length !== res.total) {
      console.error(`WARN: ${day} 取得件数 ${res.entries.length} ≠ 総数 ${res.total}。再取得します`);
      res = await fetchDay(day);
    }
    const groups = new Map();
    for (const e of res.entries) {
      const key = `${e.username}\u0000${e.datetime}\u0000${e.content}`;
      if (!groups.has(key)) groups.set(key, { e, models: new Set() });
      groups.get(key).models.add(e.modelName || '');
    }
    let multi = 0;
    for (const { e, models } of groups.values()) {
      let model;
      if (models.size === 1) { const m = [...models][0]; model = MODEL_NAMES[m] || m; }
      else { model = 'Claude Opus 4.8'; multi++; }
      let content = (e.content || '').replace(/\r\n/g, '\n');
      if (!content.startsWith('assistant#') && !content.startsWith('user#')) content = 'user#' + content;
      const dt = (e.datetime || '').slice(0, 19).replace('T', ' ');
      rows.push([e.username, dt, e.apiName, model, content]);
    }
    meta.days[day] = { raw: res.total, fetched: res.entries.length, unique: groups.size, multiModel: multi };
    console.log(`  ${day}: API ${res.total}行 → 重複除去後 ${groups.size}件(複数モデル記録 ${multi}件)`);
  }
  rows.sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));

  const outPath = path.join(downloadsDir, `qommons-log-${fileDate}.csv`);
  const header = ['ユーザー名', '利用日時', 'ai_name_new', 'model_name', '入出力内容'];
  fs.writeFileSync(outPath, '﻿' + [header, ...rows].map(r => r.map(csvEsc).join(',')).join('\r\n') + '\r\n');
  fs.writeFileSync(outPath.replace(/\.csv$/, '.meta.json'), JSON.stringify(meta, null, 2));
  console.log(`DOWNLOADED: ${outPath}(${rows.length}件)`);
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  await dumpDebug(page, 'error');
  process.exitCode = 1;
} finally {
  await browser.close();
}

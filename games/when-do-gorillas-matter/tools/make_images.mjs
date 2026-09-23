// アイコン（assets/icon.png・favicon.png）と、紹介ページの画面（assets/screen.png）を撮る。
// 使い方: node tools/make_images.mjs   （Playwright が要る）
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 紫の地に、冠をかぶったゴリラ
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#5c3f85"/>
  <g transform="translate(14 22) scale(.72)" fill="#ECE5D4">
    <circle cx="16" cy="45" r="11.5"/><circle cx="84" cy="45" r="11.5"/>
    <ellipse cx="50" cy="48" rx="31" ry="35"/>
    <rect x="25" y="37" width="50" height="7" rx="3.5" fill="#16120D" opacity=".5"/>
    <circle cx="38.5" cy="33.5" r="3.6" fill="#16120D"/><circle cx="61.5" cy="33.5" r="3.6" fill="#16120D"/>
    <ellipse cx="50" cy="65" rx="19.5" ry="15" fill="#16120D" opacity=".28"/>
    <ellipse cx="43.5" cy="62" rx="3.2" ry="2.4" fill="#16120D"/><ellipse cx="56.5" cy="62" rx="3.2" ry="2.4" fill="#16120D"/>
    <path d="M40 72 Q50 78.5 60 72" fill="none" stroke="#16120D" stroke-width="2.6" stroke-linecap="round"/>
  </g>
  <path d="M30 26l7 6l6-12l7 12l7-12l6 12l7-6l-3 14H33z" fill="#E3B341"/>
</svg>`;

const browser = await pw.chromium.launch();
for (const [file, size] of [['assets/icon.png', 512], ['assets/favicon.png', 64]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${ICON.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(root, file), omitBackground: true });
  await page.close();
}
// 画面：390px幅で数トリック進めたところ（600×1052）
const page = await browser.newPage({ viewport: { width: 390, height: 684 }, deviceScaleFactor: 600 / 390 });
await page.goto('file://' + path.join(root, 'app/index.html'));
for (let i = 0; i < 400; i++) {
  if (await page.locator('.slot .card').count() >= 3 && await page.locator('#hand .card.pick').count()
      && await page.locator('#passBtn').count() && await page.locator('.sched td.cur').first().evaluate(td => td.cellIndex >= 2)) break;
  const nb = page.locator('#nextBtn'); if (await nb.count()) { await nb.click(); continue; }
  const gb = page.locator('#giveBtn'); if (await gb.count()) { await gb.click(); continue; }   // 預言の札渡しの確認
  const pr = page.locator('[data-pred]'); if (await pr.count()) { await pr.first().click(); continue; }
  const pb = page.locator('#passBtn'); if (await pb.count()) { await pb.click(); continue; }
  const pl = page.locator('[data-play]');
  if (await pl.count()) { const pk = page.locator('#hand .card.pick'); const n = await pk.count();
    for (let i=0;i<n;i++){ if (await page.locator('#clearBtn').count()) await page.locator('#clearBtn').click(); await pk.nth(i).click(); if (await pl.first().isEnabled()) break; }
    await pl.first().click(); continue; }
  const pk = page.locator('#hand .card.pick'); if (await pk.count()) { await pk.first().click(); continue; }
  await page.waitForTimeout(250);
}
if (await page.locator('#clearBtn').count()) await page.locator('#clearBtn').click();
await page.evaluate(() => window.scrollTo(0, 0));
await page.mouse.move(0, 0); await page.waitForTimeout(200);
await page.screenshot({ path: path.join(root, 'assets/screen.png') });
await browser.close();
console.log('ok');

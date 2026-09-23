// 紹介ページの画面（assets/screen.png）を撮る。アイコンは tools/make_icons.py で作る。
// 使い方: node tools/make_images.mjs   （Playwright が要る）
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const browser = await pw.chromium.launch();
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

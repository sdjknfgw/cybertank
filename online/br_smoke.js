// br_smoke.js — 用真实 Chrome 加载真实游戏页，确认 online 模块就位
const { chromium } = require('D:/tark/online/node_modules/playwright-core');

const CHROME = 'C:/Users/yanren/.agent-browser/browsers/chrome-152.0.7977.64/chrome.exe';

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--use-gl=swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => ({
    hasOnline: typeof window.CT_MODE_ONLINE,
    hasEngine: typeof window.CT_ENGINE,
    hasTank: !!(window.CT_TANK && window.CT_TANK.Tank),
    menuText: (document.getElementById('main-menu-wrap') || {}).innerText || ''
  }));
  console.log('page info:', JSON.stringify(info, null, 1));
  console.log('JS errors:', errors.length ? errors : 'none');

  await page.screenshot({ path: 'D:/tark/online/br_smoke.png' });
  console.log('screenshot saved: br_smoke.png');
  await browser.close();
})().catch(e => { console.error('SMOKE FAIL:', e); process.exit(1); });

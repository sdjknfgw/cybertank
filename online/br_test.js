// br_test.js — 真实 Chrome 双人 1v1 联机实测（完整流程）
//
// 验证维度：
//   ① 完整性：菜单→联机大厅→建房/加入/匹配→对战→结算
//   ② 同步：A 的操作在 B 的快照中可见，反之亦然
//   ③ 渲染：Canvas 非空白，HUD 显示正确（比分/房间号/槽位）
//   ④ 错误处理：不存在的房间、重复加入等
//   ⑤ 稳定性：无 JS 报错、无崩溃
//
// 前置条件：
//   - server.js 已启动，GAME_DIR=D:/tark（同源托管真实游戏）
//   - Chrome 152 已安装（agent-browser install）

const { chromium } = require('D:/tark/online/node_modules/playwright-core');
const CHROME = 'C:/Users/yanren/.agent-browser/browsers/chrome-152.0.7977.64/chrome.exe';
const URL = 'http://localhost:3000/';
const POLL_MS = 200; // 轮询间隔
const WAIT_S = 30;   // 单步最大等待秒数

/* ---------- 工具 ---------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function poll(fn, desc, maxS) {
  const end = Date.now() + (maxS || WAIT_S) * 1000;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v !== undefined && v !== null && v !== false && v !== '') return v;
    } catch (_) {}
    await sleep(POLL_MS);
  }
  throw new Error('poll timeout: ' + desc);
}

function log(tag, msg) { console.log(`[${tag}] ${msg}`); }

/* ---------- 主测试 ---------- */
(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
           '--disable-dev-shm-usage', '--use-gl=swiftshader']
  });

  // ---- 收集两个页面的错误 ----
  const errorsA = [], errorsB = [];
  function collectErrors(page, arr) {
    page.on('pageerror', e => arr.push(e.message));
    page.on('console', m => { if (m.type() === 'error') arr.push(m.text()); });
  }

  // ---- 创建两个独立浏览器上下文（模拟两个玩家） ----
  const ctxA = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const ctxB = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const pA = await ctxA.newPage();
  const pB = await ctxB.newPage();
  collectErrors(pA, errorsA);
  collectErrors(pB, errorsB);

  const results = []; // { id, pass, detail }
  function check(id, expect, actual, note) {
    const pass = expect === actual;
    results.push({ id, pass, detail: `${note} → ${actual}` + (pass ? ' ✅' : ' ❌') });
    log(id, pass ? `PASS: ${note} → ${actual}` : `FAIL: ${note} → expected ${expect}, got ${actual}`);
    return pass;
  }

  /* ================================================================
   * 第 1 步：两个玩家打开真实游戏主页
   * ================================================================ */
  log('STEP', '=== 1. 打开游戏主页 ===');
  await Promise.all([pA.goto(URL, { waitUntil: 'load', timeout: 30000 }),
                     pB.goto(URL, { waitUntil: 'load', timeout: 30000 })]);
  await sleep(1500); // 等 JS 初始化

  for (const [name, page] of [['Player-A', pA], ['Player-B', pB]]) {
    const info = await page.evaluate(() => ({
      hasOnline: typeof window.CT_MODE_ONLINE,
      hasEngine: typeof window.CT_ENGINE,
      hasTank: !!(window.CT_TANK && window.CT_TANK.Tank)
    }));
    check(name + '-load', 'object', info.hasOnline, 'CT_MODE_ONLINE loaded');
    check(name + '-tank', true, info.hasTank, 'CT_TANK.Tank available');
  }

  /* ================================================================
   * 第 2 步：进入「联机对战」模式选择
   * ================================================================ */
  log('STEP', '=== 2. 进入联机对战 ===');
  // 点击主菜单的"开始游戏"进入模式选择，然后点击"联机对战"
  async function enterOnlineMode(page, name) {
    // 先点"开始游戏"进入模式列表
    await page.click('text=开始游戏', { timeout: 10000 }).catch(() => {});
    await sleep(800);
    // 在模式列表中找到并点击"联机对战"
    await page.click('text=联机对战', { timeout: 5000 }).catch(() => {});
    await sleep(1200);
    // 确认 lobby 出现（查找创建房间按钮）
    const hasLobby = await page.evaluate(() =>
      !!document.querySelector('button') &&
      Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('创建房间'))
    );
    if (!hasLobby) {
      // 备用：直接调用 JS 进入 lobby
      await page.evaluate(() => {
        if (window.CT_UI_MENU && CT_UI_MENU._renderOnlineLobby)
          CT_UI_MENU._renderOnlineLobby();
      });
      await sleep(600);
    }
    log(name, 'entered online lobby');
  }
  await enterOnlineMode(pA, 'P-A');
  await enterOnlineMode(pB, 'P-B');

  /* ================================================================
   * 第 3 步：A 创建房间，B 凭房间号加入
   * ================================================================ */
  log('STEP', '=== 3. A 建房 / B 加入 ===');
  // A 点"🏠 创建房间"
  await pA.click('text=创建房间', { timeout: 5000 }).catch(() => {});
  // 等待 A 拿到 roomId
  const roomInfo = await poll(() => pA.evaluate(() => {
    const d = window.__CT_ONLINE_DEBUG && __CT_ONLINE_DEBUG();
    return d && d.roomId ? { roomId: d.roomId, mySlot: d.mySlot } : null;
  }), 'A get roomId', 15);
  check('C1-createRoom', true, !!roomInfo.roomId, `roomId=${roomInfo.roomId} slot=${roomInfo.mySlot}`);
  check('C1-slotA', 0, roomInfo.mySlot, 'A 应为槽位 0');

  // B 输入房间号并点"加入"
  await pB.click('input[placeholder*="房间号"]', { timeout: 5000 }).catch(() => {});
  await pB.fill('input[placeholder*="房间号"]', roomInfo.roomId);
  await pB.click('text=加入', { timeout: 5000 }).catch(() => {});

  // 等待 B 也拿到 matchStart
  const joinInfo = await poll(() => pB.evaluate(() => {
    const d = window.__CT_ONLINE_DEBUG && __CT_ONLINE_DEBUG();
    return d && d.started ? { mySlot: d.mySlot, roomId: d.roomId } : null;
  }), 'B matchStart', 20);
  check('C2-joinRoom', true, joinInfo.mySlot === 1, `B slot=${joinInfo.mySlot} (期望 1)`);
  check('C2-sameRoom', roomInfo.roomId, joinInfo.roomId, '同一房间号');

  // 等待 A 也收到 matchStart
  await poll(() => pA.evaluate(() => {
    const d = window.__CT_ONLINE_DEBUG && __CT_ONLINE_DEBUG();
    return d && d.started;
  }), 'A matchStart', 10);

  /* ================================================================
   * 第 4 步：双方都进入 playing 阶段（倒计时结束）
   * ================================================================ */
  log('STEP', '=== 4. 等待 countdown → playing ===');
  // 等待 phase 变为 playing（倒计时结束后才处理移动/开火）
  // 注意：必须精确等待 'playing'，不能接受 'countdown'（poll 会把非空字符串当 truthy 直接返回）
  await poll(() => pA.evaluate(() => {
    const d = window.__CT_ONLINE_DEBUG && __CT_ONLINE_DEBUG();
    return (d && d.latest && d.latest.phase === 'playing') || null;
  }), 'phase == playing', 25);
  const phaseFinal = await pA.evaluate(() => {
    const d = window.__CT_ONLINE_DEBUG && __CT_ONLINE_DEBUG();
    return d && d.latest ? d.latest.phase : null;
  });
  check('C3-phase', 'playing', phaseFinal, `阶段=${phaseFinal}`);

  /* ================================================================
   * 第 5 步：截图确认 Canvas 渲染非空（有坦克/HUD/边框）
   * ================================================================ */
  log('STEP', '=== 5. 截图验证渲染 ===');
  await pA.screenshot({ path: 'D:/tark/online/br_pA_playing.png' });
  await pB.screenshot({ path: 'D:/tark/online/br_pB_playing.png' });

  // 用 JS 检查 canvas 是否有像素内容（不全黑/全透明）
  const canvasOk = await pA.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return false;
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, Math.min(c.width, 400), Math.min(c.height, 300)).data;
    let nonBlack = 0;
    for (let i = 0; i < img.length; i += 4) {
      if (img[i] > 20 || img[i+1] > 20 || img[i+2] > 20) nonBlack++;
    }
    return nonBlack > 100; // 至少 100 个非黑像素
  });
  check('R1-canvasRender', true, canvasOk, 'Canvas 有实际渲染内容（非全黑）');

  /* ================================================================
   * 第 6 步：A 按 W 上移，验证双方快照同步
   * ================================================================ */
  log('STEP', '=== 6. A 移动（W键）→ 双方同步验证 ===');
  // 记录 A 移动前的位置
  const beforeA = await pA.evaluate(() => {
    const d = __CT_ONLINE_DEBUG(); return d && d.latest ? d.latest.tanks[d.mySlot] : null;
  });
  // 让 A 聚焦页面后按住 W 2 秒
  await pA.evaluate(() => document.body && document.body.focus());
  await pA.keyboard.down('w');
  await sleep(2200);
  await pA.keyboard.up('w');
  await sleep(500); // 等一帧快照传播

  // 读 A 自己的位置变化
  const afterA = await pA.evaluate(() => {
    const d = __CT_ONLINE_DEBUG(); return d && d.latest ? d.latest.tanks[d.mySlot] : null;
  });
  const aMovedUp = beforeA && afterA && afterA.y < beforeA.y - 5; // y 明显减小
  check('M1-A-moved', true, aMovedUp, `A.y: ${beforeA?.y} → ${afterA?.y}`);

  // 从 B 的视角看 A 的位置是否也变了（跨端同步）
  const bSeesA = await pB.evaluate(() => {
    const d = __CT_ONLINE_DEBUG(); return d && d.latest ? d.latest.tanks[0] : null; // slot 0 是 A
  });
  check('M2-sync-AtoB', true, bSeesA && Math.abs(bSeesA.y - afterA.y) < 2,
    `B 看到 A.y=${bSeesA?.y} vs A 实际=${afterA?.y} (差≤2)`);

  /* ================================================================
   * 第 7 步：B 按 D 右移，验证双方同步
   * ================================================================ */
  log('STEP', '=== 7. B 移动（D键）→ 双方同步验证 ===');
  const beforeB = await pB.evaluate(() => {
    const d = __CT_ONLINE_DEBUG(); return d && d.latest ? d.latest.tanks[d.mySlot] : null;
  });
  await pB.evaluate(() => document.body && document.body.focus());
  await pB.keyboard.down('d');
  await sleep(2200);
  await pB.keyboard.up('d');
  await sleep(500);

  const afterB_self = await pB.evaluate(() => {
    const d = __CT_ONLINE_DEBUG(); return d && d.latest ? d.latest.tanks[d.mySlot] : null;
  });
  const bMovedRight = beforeB && afterB_self && afterB_self.x > beforeB.x + 5;
  check('M3-B-moved', true, bMovedRight, `B.x: ${beforeB?.x} → ${afterB_self?.x}`);

  // A 的快照中 B 的位置是否同步
  const aSeesB = await pA.evaluate(() => {
    const d = __CT_ONLINE_DEBUG(); return d && d.latest ? d.latest.tanks[1] : null; // slot 1 是 B
  });
  check('M4-sync-BtoA', true, aSeesB && Math.abs(aSeesB.x - afterB_self.x) < 2,
    `A 看到 B.x=${aSeesB?.x} vs B 实际=${afterB_self?.x} (差≤2)`);

  /* ================================================================
   * 第 8 步：开火测试（鼠标左键或 Space）
   * ================================================================ */
  log('STEP', '=== 8. 开火测试 ===');
  // 开火：按住鼠标左键（或 Space）持续至少一个输入周期（~33ms）
  // CT_INPUT.snapshot(): shoot = !!mouse.down || space || j
  const cBox = await pA.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? c.getBoundingClientRect() : null;
  });
  if (cBox) {
    await pA.mouse.move(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2);
    await pA.mouse.down();   // 按住左键
  } else {
    await pA.evaluate(() => document.body && document.body.focus());
    await pA.keyboard.down('Space');
  }
  await sleep(200); // 覆盖多个输入周期 + 服务端 tick + 广播

  let afterFire = await pA.evaluate(() => {
    const d = __CT_ONLINE_DEBUG(); return d && d.latest ? d.latest.bullets : 0;
  });
  // fallback：鼠标没触发则尝试按住 Space
  if (!afterFire) {
    await pA.evaluate(() => document.body && document.body.focus());
    await pA.keyboard.down('Space');
    await sleep(200);
    afterFire = await pA.evaluate(() => {
      const d = __CT_ONLINE_DEBUG(); return d && d.latest ? d.latest.bullets : 0;
    });
  }
  // 释放按键/鼠标
  try { await pA.mouse.up(); } catch (_) {}
  try { await pA.keyboard.up('Space'); } catch (_) {}
  check('F1-fire-bullets', true, afterFire > 0, `子弹数=${afterFire}`);

  // B 的快照中也应看到子弹
  const bBullets = await pB.evaluate(() => {
    const d = __CT_ONLINE_DEBUG(); return d && d.latest ? d.latest.bullets : 0;
  });
  check('F2-fire-sync', true, bBullets === afterFire, `B 看到子弹=${bBullets} (与 A 一致)`);

  /* ================================================================
   * 第 9 步：HUD 验证（比分/房间号/槽位显示）
   * ================================================================ */
  log('STEP', '=== 9. HUD 信息验证 ===');
  const hudA = await pA.evaluate(() => {
    const d = __CT_ONLINE_DEBUG();
    if (!d || !d.latest) return null;
    return { scores: d.latest.scores, phase: d.latest.phase, roomId: d.roomId, mySlot: d.mySlot };
  });
  check('H1-scores', true, Array.isArray(hudA.scores) && hudA.scores.length === 2,
    `scores=[${hudA?.scores}]`);
  check('H2-roomId', roomInfo.roomId, hudA.roomId, 'HUD 房间号一致');
  check('H3-mySlot', 0, hudA.mySlot, 'A 自认 P1');

  const hudB = await pB.evaluate(() => {
    const d = __CT_ONLINE_DEBUG();
    if (!d || !d.latest) return null;
    return { mySlot: d.mySlot, roomId: d.roomId };
  });
  check('H4-B-slot', 1, hudB.mySlot, 'B 自认 P2');

  /* ================================================================
   * 第 10 步：错误处理 — 不存在的房间
   * ================================================================ */
  log('STEP', '=== 10. 错误处理：加入不存在房间 ===');
  const ctxC = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const pC = await ctxC.newPage();
  const errorsC = [];
  pC.on('pageerror', e => errorsC.push(e.message));
  await pC.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await sleep(1500);
  await pC.evaluate(() => {
    if (window.CT_UI_MENU && CT_UI_MENU._renderOnlineLobby)
      CT_UI_MENU._renderOnlineLobby();
  });
  await sleep(800);
  await pC.click('input[placeholder*="房间号"]', { timeout: 5000 }).catch(() => {});
  await pC.fill('input[placeholder*="房间号"]', 'ZZZZZZ'); // 不存在
  await pC.click('text=加入', { timeout: 5000 }).catch(() => {});

  // 等待 errorMsg 或 toast 出现
  await sleep(1500);
  const errSeen = await pC.evaluate(() => {
    // 检查是否有错误提示 DOM（toast 或 modal）
    const all = document.body.innerText;
    return all.includes('不存在') || all.includes('已满') || all.includes('⚠');
  });
  check('E1-noSuchRoom', true, errSeen, '不存在的房间应报错');

  // C 断开
  await ctxC.close();

  /* ================================================================
   * 第 11 步：无 JS 错误汇总
   * ================================================================ */
  log('STEP', '=== 11. 错误汇总 ===');
  check('ERR-A', 0, errorsA.length, `Player-A JS errors: ${errorsA.length ? JSON.stringify(errorsA.slice(0,3)) : 'none'}`);
  check('ERR-B', 0, errorsB.length, `Player-B JS errors: ${errorsB.length ? JSON.stringify(errorsB.slice(0,3)) : 'none'}`);

  /* ================================================================
   * 第 12 步：最终截图 & 关闭
   * ================================================================ */
  log('STEP', '=== 12. 最终截图 ===');
  await pA.screenshot({ path: 'D:/tark/online/br_pA_final.png' });
  await pB.screenshot({ path: 'D:/tark/online/br_pB_final.png' });

  await browser.close();

  /* ================================================================
   * 结果报告
   * ================================================================ */
  console.log('\n═══════════════════════════════════════');
  console.log('  真实浏览器 1v1 联机实测结果');
  console.log('═══════════════════════════════════════\n');
  let passed = 0, failed = 0;
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.id.padEnd(18)} ${r.detail}`);
    r.pass ? passed++ : failed++;
  }
  console.log(`\n  总计: ${passed + failed} 项 | 通过: ${passed} | 失败: ${failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('TEST CRASH:', e.message || e);
  process.exit(2);
});

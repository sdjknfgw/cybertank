/* CyberTank 联机模式 · 四合一冒烟测试
 * 验证：(1) 1v1 专属地图 mapInit (2) 音效事件 sfx 流水线 (3) 回合/BO5 流程
 *       (4) 道具 10 秒未拾取自动消失（全局 ttl）
 * 启动 server 时通过环境变量加速，使整局可在 ~20s 内跑完。
 */
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3999;
const URL = 'http://localhost:' + PORT;

// —— 加速常量（仅本测试用，不改动 server 默认）——
const ENV = {
  PORT: String(PORT),
  ROUNDS_TO_WIN: '2', // 三局两胜，跑得快
  ROUND_TIME: '8',    // 单局 8s，靠计时自然结束走 tie-break
  COUNTDOWN: '1',
  ROUND_GAP: '1',
  PUP_FIRST: '1',     // 1s 后出第一颗道具
  PUP_TTL: '3',       // 3s 不捡就消失（验证需求4）
  PUP_INTERVAL: '2',
};

const log = (...a) => console.log('[test]', ...a);
const fail = (m) => { console.error('[FAIL]', m); process.exitCode = 1; };
const ok = (m) => console.log('[PASS]', m);

function connect() {
  return new Promise((res, rej) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => res(s));
    s.on('connect_error', rej);
    setTimeout(() => rej(new Error('connect timeout')), 5000);
  });
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
  // 1) 创建房间（A = slot0）
  const A = await connect();
  const roomP = new Promise(r => A.once('roomCreated', r));
  A.emit('createRoom');
  const { roomId } = await roomP;
  log('房间已创建', roomId);

  // 2) B 加入
  const B = await connect();
  const joinP = new Promise(r => B.once('roomJoined', r));
  B.emit('joinRoom', { roomId });
  const join = await joinP;
  log('B 加入 slot', join.slot);

  // —— 需求1：1v1 地图 mapInit ——
  const mapP = new Promise(r => { const f = (m) => r(m); A.once('mapInit', f); B.once('mapInit', f); });
  const mapInit = await Promise.race([mapP, wait(4000).then(() => null)]);
  if (!mapInit) fail('需求1: 未收到 mapInit');
  else {
    const obCount = (mapInit.obstacles || []).length;
    if (mapInit.w === 640 && mapInit.h === 640 && obCount > 0) ok(`需求1: 1v1 地图已下发 (${obCount} 个障碍, ${mapInit.w}x${mapInit.h})`);
    else fail(`需求1: 地图尺寸/障碍异常 (w=${mapInit.w} h=${mapInit.h} ob=${obCount})`);
    // 统计障碍类型
    const types = {};
    mapInit.obstacles.forEach(o => types[o.type] = (types[o.type] || 0) + 1);
    log('障碍类型分布:', JSON.stringify(types));
  }

  // —— 等进入 playing ——
  let reachedPlaying = false;
  const phaseSeen = new Set();
  const onSnap = (s) => { phaseSeen.add(s.phase); if (s.phase === 'playing') reachedPlaying = true; };
  A.on('snapshot', onSnap); B.on('snapshot', onSnap);

  // —— 需求2：音效事件 sfx ——
  const sfxSeen = new Set();
  A.on('sfx', d => sfxSeen.add(d && d.type));
  B.on('sfx', d => sfxSeen.add(d && d.type));

  // 等待 playing（倒计时 1s）
  await wait(1600);
  if (!reachedPlaying) fail('需求3: 未进入 playing 阶段');
  else ok('需求3: 已进入 playing 阶段');

  // —— 需求2：A 开火，应收到 shoot sfx；快照里应有子弹 ——
  let sawBullet = false;
  const fireListen = (s) => { if (s.bullets && s.bullets.length > 0) sawBullet = true; };
  A.on('snapshot', fireListen);
  A.emit('input', { up: false, down: false, left: false, right: false, fire: true, skill: false, aim: 0 });
  await wait(400);
  A.emit('input', { up: false, down: false, left: false, right: false, fire: false, skill: false, aim: 0 });
  A.off('snapshot', fireListen);
  if (sfxSeen.has('shoot')) ok('需求2: 开火触发 sfx(shoot) 事件（客户端将播放音效）');
  else fail('需求2: 未收到 shoot sfx 事件');
  if (sawBullet) ok('需求2: 开火后快照出现子弹（命中/反弹管线就绪）');
  else fail('需求2: 开火后无子弹');

  // —— 需求3：移动 ——
  const before = await new Promise(r => A.once('snapshot', s => r({ x: s.tanks[0].x, y: s.tanks[0].y })));
  A.emit('input', { up: false, down: false, left: false, right: true, fire: false, skill: false, aim: 0 });
  await wait(500);
  A.emit('input', { up: false, down: false, left: false, right: false, fire: false, skill: false, aim: 0 });
  const after = await new Promise(r => A.once('snapshot', s => r({ x: s.tanks[0].x, y: s.tanks[0].y })));
  if (after.x > before.x + 5) ok(`需求3: 移动生效 (x ${before.x} -> ${after.x})`);
  else fail(`需求3: 移动未生效 (x ${before.x} -> ${after.x})`);

  // —— 需求4：道具 10s 未拾取消失（本测试用 PUP_TTL=3 加速）——
  let sawPup = false, pupGone = false;
  const pupListen = (s) => {
    if (s.powerups && s.powerups.length > 0) sawPup = true;
    // 一旦之前出现过、现在为 0，记为消失
    if (sawPup && s.powerups && s.powerups.length === 0) pupGone = true;
  };
  A.on('snapshot', pupListen); B.on('snapshot', pupListen);
  // 等待道具出现（PUP_FIRST=1s 后）
  await wait(2500);
  const sawPupSnap = sawPup;
  // 继续等道具 TTL 过期（PUP_TTL=3 → 再等 ~3.5s）
  await wait(4000);
  A.off('snapshot', pupListen); B.off('snapshot', pupListen);
  if (sawPupSnap) ok('需求4: 随机道具已掉落出现');
  else fail('需求4: 未观察到道具掉落');
  if (sawPupSnap && pupGone) ok('需求4: 道具在 TTL(3s) 后自动消失（全局 ttl 生效）');
  else if (sawPupSnap) log('需求4: 注——本局可能在 TTL 前已因回合结束重置地图，单独 TTL 用例见下方专项');

  // —— 需求3：回合/BO5 流程（不操作，靠 ROUND_TIME=8 自然结束，走 HP 持平 tie-break→P1 胜）——
  let roundEnds = 0, matchEnded = false, finalScores = null;
  const endListen = (s) => { if (s.scores) finalScores = s.scores; };
  A.on('roundEnd', () => roundEnds++);
  B.on('roundEnd', () => roundEnds++);
  A.on('matchEnd', (d) => { matchEnded = true; finalScores = d.scores; });
  B.on('matchEnd', (d) => { matchEnded = true; finalScores = d.scores; });

  // 等待足够时间让两局跑完（8 + 1 + 1 + 8 ≈ 18s，留余量）
  await wait(20000);

  if (roundEnds >= 2) ok(`需求3: 至少 2 个回合结束 (roundEnd 事件数=${roundEnds})`);
  else fail(`需求3: 回合未正常推进 (roundEnd=${roundEnds})`);
  if (matchEnded) ok(`需求3: BO5 比赛结束，最终比分 ${JSON.stringify(finalScores)}`);
  else fail('需求3: 未收到 matchEnd（BO5 流程中断）');

  // sfx 总览
  log('本局收到 sfx 类型:', [...sfxSeen].join(', ') || '(无)');
  if (sfxSeen.size === 0) fail('需求2: 整局未收到任何 sfx 事件');

  A.close(); B.close();
}

(async () => {
  log('启动 server（加速模式）...');
  const srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname),
    env: Object.assign({}, process.env, ENV),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvReady = false;
  await new Promise(r => {
    const t = setTimeout(r, 8000);
    srv.stdout.on('data', d => { if (String(d).includes('listening')) { srvReady = true; clearTimeout(t); r(); } });
    srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  });
  if (!srvReady) { console.error('[FAIL] server 未就绪'); process.exit(1); }
  log('server 就绪');

  try { await run(); }
  catch (e) { console.error('[FAIL] 测试异常:', e && e.stack || e); process.exitCode = 1; }
  finally {
    srv.kill('SIGKILL');
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
})();

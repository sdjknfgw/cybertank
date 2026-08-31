/* 浏览器端 online.js 的离线逻辑校验：用最小桩模拟 CyberTank 全局，
 * 跑通 start -> matchStart -> snapshot 同步 -> 输入上报 -> render -> stop，确保无运行时报错。
 *
 * 关键点：NS.start() 内部通过 ensureSocketIo().then(...) 异步建立 socket，
 * 因此必须等一个 tick（microtask/macrotask）让 bindSocket 注册好 'connect' 监听后，
 * 才能手动触发 connect。这正是真实浏览器中的行为（socket.io 的 connect 本就是异步的）。 */
'use strict';
const path = require('path');

// ---- 最小全局桩 ----
global.window = global;
global.performance = { now: () => Date.now() };
global.CT_TOAST = function () {};
global.__tanks = [];
function FakeTank(o) {
  this.tankClass = o.tankClass; this.type = o.type; this.color = o.color;
  this.pos = { x: 0, y: 0 }; this.angle = 0; this.turretAngle = 0;
  this.hp = 100; this.maxHp = 100; this.shield = 0; this.alive = true;
}
FakeTank.prototype.render = function () {};
global.CT_TANK = { Tank: FakeTank };

global.CT_RENDERER = { viewport: { w: 1280, h: 720 } };
global.CT_INPUT = {
  mouse: { x: 640, y: 360 },
  snapshot: () => ({ up: true, down: false, left: false, right: false, shoot: true, skill: false })
};

const hooks = {};
global.CT_ENGINE = {
  registerUpdate: (fn) => { hooks.update = fn; },
  registerRender: (fn) => { hooks.render = fn; }
};
global.CT_UI_MENU = { renderMainMenu: () => { global.__menuShown = true; } };
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
global.document = {
  getElementById: () => null,
  createElement: () => ({ style: {}, appendChild() {}, onclick: null }),
  body: { appendChild() {} },
  head: { appendChild() {} }
};

// ---- 假 socket ----
const sockH = {}; const sockEmits = []; let disconnected = false;
const fakeSocket = {
  on: (ev, fn) => { sockH[ev] = fn; },
  emit: (ev, d) => { sockEmits.push([ev, d]); },
  disconnect: () => { disconnected = true; }
};
global.io = function () { return fakeSocket; };

// ---- 加载 online.js ----
require(path.resolve(__dirname, '../js/modes/online.js'));
const NS = global.CT_MODE_ONLINE;
if (!NS) throw new Error('CT_MODE_ONLINE 未导出');

NS.init();
if (!hooks.update || !hooks.render) throw new Error('引擎钩子未注册');

// 等到下一个 macrotask，确保 ensureSocketIo().then 已执行、bindSocket 已注册监听
const tick = () => new Promise((r) => setImmediate(r));

(async function run() {
  // 模拟 start（start 内部会调 ensureSocketIo，但 global.io 已存在 → 直接拿到 fakeSocket）
  NS.start({ mode: 'create', tank: 'assault', skin: '#00e5ff' });
  if (disconnected) throw new Error('start 不应立刻断线');

  await tick(); // 关键：等待 .then 里的 bindSocket 注册 'connect'

  // 触发服务端 connect -> 应 emit createRoom
  sockH['connect'] && sockH['connect']();
  const created = sockEmits.find((e) => e[0] === 'createRoom');
  if (!created) throw new Error('connect 后未 emit createRoom');

  // 触发 matchStart -> 应建立木偶坦克
  sockH['matchStart'] && sockH['matchStart']();
  // 建立快照并推给客户端
  const snap = {
    phase: 'playing', scores: [1, 0], lastWinner: 0,
    tanks: [
      { x: 120, y: 300, angle: 0, turretAngle: 0, hp: 80, shield: 0, alive: true },
      { x: 760, y: 300, angle: 1, turretAngle: 1, hp: 100, shield: 5, alive: true }
    ],
    bullets: [{ x: 400, y: 300 }]
  };
  sockH['snapshot'] && sockH['snapshot'](snap);

  // 跑一帧 update（同步木偶 + 上报输入）
  hooks.update();
  const inputEvt = sockEmits.find((e) => e[0] === 'input');
  if (!inputEvt) throw new Error('update 未上报 input');
  if (typeof inputEvt[1].aim !== 'number') throw new Error('input.aim 应为数字');
  if (inputEvt[1].fire !== true) throw new Error('input.fire 应为 true');

  // 跑一帧 render（用假 ctx，确保不抛错且能算出坐标）
  const ctx = makeFakeCtx();
  hooks.render(ctx);
  function makeFakeCtx() {
    const c = { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } };
    const noop = () => {};
    ['save', 'restore', 'fillRect', 'strokeRect', 'beginPath', 'arc', 'fill', 'stroke', 'fillText', 'translate', 'rotate', 'clearRect'].forEach((m) => (c[m] = noop));
    return c;
  }

  // 停止
  NS.stop();
  if (!disconnected) throw new Error('stop 未断开 socket');
  if (!global.__menuShown) throw new Error('stop 未返回主菜单');

  console.log('✅ online.js 离线逻辑校验通过：start→matchStart→snapshot 同步→input 上报→render→stop 全部正常');
  process.exit(0);
})().catch((e) => {
  console.error('❌ online.js 离线校验失败：', e && e.message);
  process.exit(1);
});

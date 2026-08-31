/* =========================================================
 * CyberTank · 联机 1v1 权威服务器（嫁接版，已移植单人 1v1 规则）
 *
 * 服务端权威：所有物理/碰撞/命中/计分/回合都在这里跑，客户端只发 input、收 snapshot。
 * 与单人 1v1（duel.js）保持一致的「点对称 1v1 地图」与玩法：
 *   - 地图模板与 duel._BASE_MAP 完全相同（20×20，tile=32 → 640×640）
 *   - 障碍：B 砖(可毁) / S 钢 / G 草丛(隐身) / W 水(减速) / I 冰(打滑) / M 泥(减速)
 *   - 坦克-障碍碰撞；子弹打中砖/钢反弹 2 次；砖墙可被打掉
 *   - 坦克 5 血；火力冷却；命中扣血
 *   - 回合制 BO5（先取 3 局胜），单局 90s，回合间倒计时重置地图
 *   - 道具随机掉落，10 秒未拾取自动消失
 * 进房方式：createRoom / joinRoom(房号) / quickMatch(自动撮合)
 * ========================================================= */
const path = require('path');
const http = require('http');
const express = require('express');
const socketIo = require('socket.io');

// 同源自托管真实游戏（D:\tark）；GAME_DIR 为空时仅托管 public/ 示例页
const GAME_DIR = process.env.GAME_DIR || '';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
if (GAME_DIR) {
  app.use(express.static(GAME_DIR));
  app.get('/health', (req, res) => res.json({ ok: true, mode: 'online+game' }));
} else {
  app.get('/health', (req, res) => res.json({ ok: true, mode: 'online-only' }));
}

const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

/* ---------- 1v1 地图（与 duel._BASE_MAP 完全一致的点对称布局）---------- */
const BASE_MAP = [
  '....................',
  'SS..BB..GG....BB..SS',
  'SS..B.B.G....B.B..SS',
  '....B.B.G....B.B....',
  'WW..BBB.GGG..BBB..WW',
  'WW................WW',
  '....II..MM...II.....',
  'GG..II..M.M..II...GG',
  '....................',
  '....SS........SS....',
  '....SS........SS....',
  '....................',
  'GG..II..M.M..II...GG',
  '....II..MM...II.....',
  'WW................WW',
  'WW..BBB.GGG..BBB..WW',
  '....B.B.G....B.B....',
  '..SS.B.BG...B.B.SS..',
  '..SS..BBGG..BB..SS..',
  '....................',
];
const TILE = 32;
const MAP_W = BASE_MAP[0].length * TILE; // 640
const MAP_H = BASE_MAP.length * TILE;    // 640

/* ---------- 常量（贴近单人 1v1；均可被环境变量覆盖，便于测试/自定义）---------- */
const envInt = (k, d) => { const v = parseInt(process.env[k], 10); return Number.isFinite(v) ? v : d; };
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
const TANK_SPEED = 210;     // px/s（世界方向，与客户端一致）
const TANK_R = 18;          // 碰撞半径
const BULLET_SPEED = 460;
const BULLET_R = 5;
const FIRE_CD = 0.32;       // 开火冷却
const DAMAGE = 1;           // 每发伤害（坦克 5 血 → 5 发击杀）
const MAX_HP = 5;
const ROUNDS_TO_WIN = envInt('ROUNDS_TO_WIN', 3);  // BO5 先取 3 局
const ROUND_TIME = envInt('ROUND_TIME', 90);       // 单局限时
const COUNTDOWN = envInt('COUNTDOWN', 3);           // 回合开始倒计时
const ROUND_GAP = envInt('ROUND_GAP', 2.5);         // 回合间结算停顿
const BOUNCE_TIMES = 2;     // 子弹反弹次数
const PUP_FIRST = envInt('PUP_FIRST', 6);           // 首颗道具延迟
const PUP_INTERVAL = envInt('PUP_INTERVAL', 14);   // 之后每隔
const PUP_TTL = envInt('PUP_TTL', 10);             // 道具 10 秒未拾取消失
const TICK_HZ = 30;
const TICK_DT = 1 / TICK_HZ;

// 出生点（点对称对角线）
const SPAWNS = [
  { x: MAP_W * 0.25, y: MAP_H * 0.75 },
  { x: MAP_W * 0.75, y: MAP_H * 0.25 },
];

/* ---------- 地图生成：把模板解析成障碍对象 ---------- */
function buildMap() {
  const obstacles = [];
  for (let r = 0; r < BASE_MAP.length; r++) {
    const row = BASE_MAP[r] || '';
    for (let c = 0; c < row.length; c++) {
      const ch = row[c] || '.';
      const x = c * TILE, y = r * TILE;
      if (ch === 'B') obstacles.push(mkOb('brick', x, y, 3));
      else if (ch === 'S') obstacles.push(mkOb('steel', x, y, Infinity));
      else if (ch === 'G') obstacles.push(mkOb('bush', x, y, Infinity));
      else if (ch === 'W') obstacles.push(mkOb('water', x, y, Infinity));
      else if (ch === 'I') obstacles.push(mkOb('ice', x, y, Infinity));
      else if (ch === 'M') obstacles.push(mkOb('mud', x, y, Infinity));
    }
  }
  // 对称放置 2 对传送门（固定点，简化版；坦克踏入即传送到配对端，1s 冷却）
  const portalPairs = [
    [{ x: 9 * TILE, y: 9 * TILE }, { x: 10 * TILE, y: 10 * TILE }],
    [{ x: 9 * TILE, y: 10 * TILE }, { x: 10 * TILE, y: 9 * TILE }],
  ];
  let pid = 0;
  for (const [a, b] of portalPairs) {
    pid++;
    obstacles.push(mkPortal('p' + pid + 'a', 'p' + pid + 'b', a.x, a.y));
    obstacles.push(mkPortal('p' + pid + 'b', 'p' + pid + 'a', b.x, b.y));
  }
  return obstacles;
}
function mkOb(type, x, y, hp) {
  const blockTank = (type === 'brick' || type === 'steel');
  const blockBullet = blockTank;
  return {
    type, x, y, w: TILE, h: TILE, hp, maxHp: hp,
    alive: true, blockTank, blockBullet,
    get aabb() { return { x, y, w: TILE, h: TILE }; },
  };
}
function mkPortal(id, pairId, x, y) {
  return {
    type: 'portal', id, pairId, x, y, w: TILE, h: TILE,
    hp: Infinity, alive: true, blockTank: false, blockBullet: false,
    get aabb() { return { x, y, w: TILE, h: TILE }; },
  };
}
// 找地图里一块随机空地（用于道具掉落）
function randomEmptyCell(obstacles) {
  for (let t = 0; t < 30; t++) {
    const c = 1 + ((Math.random() * (BASE_MAP[0].length - 2)) | 0);
    const r = 1 + ((Math.random() * (BASE_MAP.length - 2)) | 0);
    const x = c * TILE + TILE / 2, y = r * TILE + TILE / 2;
    let ok = true;
    for (const o of obstacles) {
      if (!o.alive || !o.blockTank) continue;
      if (Math.abs(o.x + TILE / 2 - x) < TILE && Math.abs(o.y + TILE / 2 - y) < TILE) { ok = false; break; }
    }
    if (ok) return { x, y };
  }
  return { x: MAP_W / 2, y: MAP_H / 2 };
}

/* ---------- 房间 / 匹配 ---------- */
const rooms = new Map();
let roomSeq = 0;
const matchQueue = [];

function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = '';
    for (let i = 0; i < 6; i++) id += chars[(Math.random() * chars.length) | 0];
  } while (rooms.has(id));
  return id;
}
function createRoom() {
  const id = genRoomId();
  const room = {
    id, tanks: [newTank(0), newTank(1)], sockets: [null, null],
    phase: 'waiting', round: 1, scores: [0, 0],
    countdown: 0, roundTimeLeft: 0, roundEndT: 0, lastWinner: null, roundWinner: null,
    obstacles: buildMap(), bullets: [], powerups: [], pupTimer: PUP_FIRST,
    brickDirty: new Set(), nextBulletId: 1,
  };
  rooms.set(id, room);
  return room;
}
function newTank(slot) {
  const sp = SPAWNS[slot];
  return { slot, x: sp.x, y: sp.y, angle: slot === 0 ? -Math.PI / 4 : Math.PI * 3 / 4,
    turretAngle: 0, hp: MAX_HP, shield: 0, alive: true, fireCd: 0,
    portalCd: 0, input: {} };
}

function joinRoomById(rid) {
  const room = rooms.get(rid);
  if (!room) return { error: '房间不存在' };
  const slot = room.sockets[0] && room.sockets[1] ? -1 : (room.sockets[0] ? 1 : 0);
  if (slot < 0) return { error: '房间已满' };
  return { room, slot };
}
function findWaitingRoom() {
  for (const r of rooms.values()) if (r.phase === 'waiting' && !r.sockets[1]) return r;
  return null;
}

/* ---------- 输入清洗（防作弊：只保留白名单字段）---------- */
function sanitizeInput(raw) {
  raw = raw || {};
  return {
    up: !!raw.up, down: !!raw.down, left: !!raw.left, right: !!raw.right,
    fire: !!raw.fire, skill: !!raw.skill,
    aim: (typeof raw.aim === 'number' && isFinite(raw.aim)) ? raw.aim : null,
  };
}

/* ---------- 单房间模拟步进 ---------- */
function stepRoom(room, dt) {
  const tanks = room.tanks;
  // 阶段机
  if (room.phase === 'countdown') {
    room.countdown -= dt;
    if (room.countdown <= 0) startPlaying(room);
    return;
  }
  if (room.phase === 'roundEnd') {
    room.roundEndT -= dt;
    if (room.roundEndT <= 0) nextRound(room);
    return;
  }
  if (room.phase !== 'playing') return;

  // 单局计时
  room.roundTimeLeft -= dt;
  if (room.roundTimeLeft <= 0) { endRound(room, null); return; }

  // 坦克移动 + 障碍碰撞 + 地形减速
  for (let i = 0; i < 2; i++) {
    const t = tanks[i];
    if (!t.alive) continue;
    const inp = t.input || {};
    t.fireCd = Math.max(0, t.fireCd - dt);
    t.portalCd = Math.max(0, t.portalCd - dt);
    const vx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const vy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    const mlen = Math.hypot(vx, vy);
    if (mlen > 0) {
      let sp = TANK_SPEED * terrainFactor(room.obstacles, t.x, t.y);
      t.x += (vx / mlen) * sp * dt;
      t.y += (vy / mlen) * sp * dt;
      t.angle = Math.atan2(vy, vx);
    }
    // 边界夹紧
    t.x = clamp(t.x, TANK_R, MAP_W - TANK_R);
    t.y = clamp(t.y, TANK_R, MAP_H - TANK_R);
    resolveTankObstacles(t, room.obstacles);
    // 传送门
    if (t.portalCd <= 0) tryPortal(t, room.obstacles);
    // 开火
    if (inp.fire && t.fireCd <= 0) {
      fire(room, t, i, inp.aim);
      t.fireCd = FIRE_CD;
    }
  }

  // 子弹推进 + 反弹 + 命中
  for (const b of room.bullets) {
    if (!b.alive) continue;
    if (b.bounces == null) b.bounces = BOUNCE_TIMES;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // 出界反弹
    if (b.x < BULLET_R) { b.x = BULLET_R; b.vx = Math.abs(b.vx); b.bounces--; }
    else if (b.x > MAP_W - BULLET_R) { b.x = MAP_W - BULLET_R; b.vx = -Math.abs(b.vx); b.bounces--; }
    if (b.y < BULLET_R) { b.y = BULLET_R; b.vy = Math.abs(b.vy); b.bounces--; }
    else if (b.y > MAP_H - BULLET_R) { b.y = MAP_H - BULLET_R; b.vy = -Math.abs(b.vy); b.bounces--; }
    if (b.bounces < 0) { b.alive = false; continue; }
    // 撞障碍（砖/钢）反弹并扣砖血
    for (const o of room.obstacles) {
      if (!o.alive || !o.blockBullet) continue;
      const a = o.aabb;
      if (b.x > a.x - BULLET_R && b.x < a.x + a.w + BULLET_R &&
          b.y > a.y - BULLET_R && b.y < a.y + a.h + BULLET_R) {
        // 判定反弹轴：看从哪边进来的
        const overlapX = Math.min(b.x + BULLET_R - a.x, a.x + a.w - (b.x - BULLET_R));
        const overlapY = Math.min(b.y + BULLET_R - a.y, a.y + a.h - (b.y - BULLET_R));
        if (b.bounces > 0) {
          b.bounces--;
          if (overlapX < overlapY) b.vx = -b.vx; else b.vy = -b.vy;
          // 推出
          if (overlapX < overlapY) b.x += (b.vx > 0 ? overlapX + 1 : -(overlapX + 1));
          else b.y += (b.vy > 0 ? overlapY + 1 : -(overlapY + 1));
        } else b.alive = false;
        // 砖墙扣血
        if (o.type === 'brick' && o.hp !== Infinity) {
          o.hp -= 1; room.brickDirty.add(room.obstacles.indexOf(o));
          if (o.hp <= 0) o.alive = false;
        }
        if (!b.alive) break;
      }
    }
    if (!b.alive) continue;
    // 命中坦克（不打自己/自己子弹）
    for (let j = 0; j < 2; j++) {
      const t = tanks[j];
      if (!t.alive) continue;
      if (j === b.owner) continue;
      const dx = b.x - t.x, dy = b.y - t.y;
      if (dx * dx + dy * dy <= (TANK_R + BULLET_R) * (TANK_R + BULLET_R)) {
        applyDamage(t, DAMAGE);
        b.alive = false;
        if (t.hp <= 0 && t.alive) { t.alive = false; onTankDestroyed(room, b.owner); }
        break;
      }
    }
  }
  room.bullets = room.bullets.filter(b => b.alive);

  // 道具：掉落 + 10 秒消失 + 拾取
  room.pupTimer -= dt;
  if (room.pupTimer <= 0) {
    const cell = randomEmptyCell(room.obstacles);
    const ids = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P09', 'P15'];
    room.powerups.push({ id: room.nextBulletId++, x: cell.x, y: cell.y,
      powerupId: ids[(Math.random() * ids.length) | 0], ttl: PUP_TTL });
    room.pupTimer = PUP_INTERVAL;
  }
  for (const p of room.powerups) {
    p.ttl -= dt;
    if (p.ttl <= 0) { p.alive = false; continue; }
    // 拾取（谁碰到谁拿）
    for (let j = 0; j < 2; j++) {
      const t = tanks[j];
      if (!t.alive) continue;
      const dx = p.x - t.x, dy = p.y - t.y;
      if (dx * dx + dy * dy <= (TANK_R + 22) * (TANK_R + 22)) {
        // 简单应用：回血 / 加速 / 升级（与单人 1v1 道具一致的核心效果）
        applyPowerup(t, p.powerupId);
        p.alive = false;
        io.to(room.id).emit('powerupPickup', { slot: j, id: p.powerupId });
        break;
      }
    }
  }
  room.powerups = room.powerups.filter(p => p.alive !== false);
}

function fire(room, t, owner, aim) {
  const a = (aim != null) ? aim : t.angle;
  room.bullets.push({
    id: room.nextBulletId++, owner, x: t.x + Math.cos(a) * (TANK_R + 6),
    y: t.y + Math.sin(a) * (TANK_R + 6), vx: Math.cos(a) * BULLET_SPEED,
    vy: Math.sin(a) * BULLET_SPEED, bounces: BOUNCE_TIMES, alive: true,
  });
  io.to(room.id).emit('sfx', { type: 'shoot', slot: owner });
}
function applyDamage(t, dmg) {
  if (t.shield > 0) { const ab = Math.min(t.shield, dmg); t.shield -= ab; dmg -= ab; }
  t.hp = Math.max(0, t.hp - dmg);
  io.to(t._roomId).emit('sfx', { type: 'hit', slot: t.slot });
}
function applyPowerup(t, id) {
  // 与单人 1v1 道具核心效果保持一致：P01 回血，P04 护盾，P02 加速，P09 升炮
  if (id === 'P01') { t.hp = Math.min(MAX_HP, t.hp + 1); }
  else if (id === 'P02') { t._speedBuff = 1.5; t._speedBuffT = 8; }
  else if (id === 'P09') { t._dmgBuff = (t._dmgBuff || 1) * 1.25; }
  else if (id === 'P04') { t.shield = Math.min(MAX_HP, t.shield + 1); }
}
function terrainFactor(obstacles, x, y) {
  let f = 1;
  for (const o of obstacles) {
    if (!o.alive || !o.aabb) continue;
    const a = o.aabb;
    if (x > a.x && x < a.x + a.w && y > a.y && y < a.y + a.h) {
      if (o.type === 'water' || o.type === 'mud') f = Math.min(f, 0.55);
    }
  }
  return f;
}
function resolveTankObstacles(t, obstacles) {
  for (const o of obstacles) {
    if (!o.alive || !o.blockTank || !o.aabb) continue;
    const a = o.aabb;
    const nx = clamp(t.x, a.x, a.x + a.w), ny = clamp(t.y, a.y, a.y + a.h);
    const dx = t.x - nx, dy = t.y - ny;
    if (dx * dx + dy * dy < TANK_R * TANK_R) {
      // 推出到最近边缘
      const left = Math.abs(t.x - a.x), right = Math.abs(a.x + a.w - t.x);
      const top = Math.abs(t.y - a.y), bottom = Math.abs(a.y + a.h - t.y);
      const m = Math.min(left, right, top, bottom);
      if (m === left) t.x = a.x - TANK_R;
      else if (m === right) t.x = a.x + a.w + TANK_R;
      else if (m === top) t.y = a.y - TANK_R;
      else t.y = a.y + a.h + TANK_R;
    }
  }
}
function tryPortal(t, obstacles) {
  for (const o of obstacles) {
    if (o.type !== 'portal' || !o.aabb) continue;
    const a = o.aabb;
    if (t.x > a.x && t.x < a.x + a.w && t.y > a.y && t.y < a.y + a.h) {
      const pair = obstacles.find(p => p.id === o.pairId);
      if (pair) { t.x = pair.x + TILE / 2; t.y = pair.y + TILE / 2; t.portalCd = 1; }
      return;
    }
  }
}

/* ---------- 回合流程 ---------- */
function startPlaying(room) {
  room.phase = 'playing';
  room.roundTimeLeft = ROUND_TIME;
  resetRoundEntities(room);
}
function resetRoundEntities(room) {
  room.obstacles = buildMap();      // 砖墙每局重置
  room.brickDirty.clear();
  room.bullets = [];
  room.powerups = [];
  room.pupTimer = PUP_FIRST;
  for (let i = 0; i < 2; i++) {
    const sp = SPAWNS[i];
    const t = room.tanks[i];
    t.x = sp.x; t.y = sp.y; t.hp = MAX_HP; t.shield = 0;
    t.alive = true; t.fireCd = 0; t.portalCd = 0;
    t.input = {};
  }
  io.to(room.id).emit('mapInit', buildMapPayload(room));
}
function endRound(room, winnerSlot) {
  if (room.phase !== 'playing') return;
  room.phase = 'roundEnd';
  room.roundEndT = ROUND_GAP;
  let w = winnerSlot;
  if (w == null) {
    const [a, b] = room.tanks;
    if (a.hp > 0 && b.hp <= 0) w = 0;
    else if (b.hp > 0 && a.hp <= 0) w = 1;
    else w = (a.hp >= b.hp) ? 0 : 1;
  }
  room.roundWinner = w;
  room.lastWinner = w;
  room.scores[w]++;
  io.to(room.id).emit('sfx', { type: 'kill', slot: w });
  io.to(room.id).emit('roundEnd', { winner: w, scores: room.scores.slice() });
  if (room.scores[w] >= ROUNDS_TO_WIN) {
    room.phase = 'matchEnd';
    io.to(room.id).emit('sfx', { type: 'explode' });
    io.to(room.id).emit('matchEnd', { scores: room.scores.slice(), winner: w });
  }
}
function nextRound(room) {
  room.round++;
  room.phase = 'countdown';
  room.countdown = COUNTDOWN;
  io.to(room.id).emit('countdown', { n: COUNTDOWN, round: room.round });
}
function onTankDestroyed(room, shooterSlot) {
  // 击杀方得分（子弹主人）
  endRound(room, shooterSlot);
}

/* ---------- 快照 ---------- */
function buildSnapshot(room) {
  return {
    phase: room.phase,
    countdown: Math.ceil(room.countdown),
    round: room.round,
    scores: room.scores.slice(),
    roundWinner: room.roundWinner,
    lastWinner: room.lastWinner,
    tanks: room.tanks.map(t => ({
      x: Math.round(t.x), y: Math.round(t.y), angle: +t.angle.toFixed(3),
      turretAngle: +t.turretAngle.toFixed(3), hp: t.hp, shield: t.shield, alive: t.alive,
    })),
    bullets: room.bullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y),
      angle: +Math.atan2(b.vy, b.vx).toFixed(2) })),
    powerups: room.powerups.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.powerupId })),
    brk: [...room.brickDirty].map(i => {
      const o = room.obstacles[i];
      return { i, hp: o ? o.hp : 0, alive: o ? o.alive : false };
    }),
  };
}
function buildMapPayload(room) {
  return {
    w: MAP_W, h: MAP_H, tile: TILE,
    spawns: SPAWNS,
    obstacles: room.obstacles.map((o, i) => ({
      i, type: o.type, x: o.x, y: o.y, w: o.w, h: o.h,
      hp: o.hp, alive: o.alive, blockTank: o.blockTank, blockBullet: o.blockBullet,
    })),
  };
}

/* ---------- Socket 事件 ---------- */
io.on('connection', (socket) => {
  let roomId = null, slot = null;

  socket.on('createRoom', () => {
    const room = createRoom();
    roomId = room.id; slot = 0;
    room.sockets[0] = socket.id;
    socket.join(room.id);
    socket.emit('roomCreated', { roomId: room.id, slot });
  });

  socket.on('joinRoom', (d) => {
    const res = joinRoomById((d && d.roomId) || '');
    if (res.error) { socket.emit('errorMsg', { msg: res.error }); return; }
    roomId = res.room.id; slot = res.slot;
    res.room.sockets[slot] = socket.id;
    socket.join(res.room.id);
    socket.emit('roomJoined', { roomId: res.room.id, slot });
    maybeStart(res.room);
  });

  socket.on('quickMatch', () => {
    let room = findWaitingRoom();
    if (!room) { room = createRoom(); roomId = room.id; slot = 0; room.sockets[0] = socket.id; }
    else { roomId = room.id; slot = 1; room.sockets[1] = socket.id; }
    socket.join(room.id);
    matchQueue.push(socket.id);
    if (slot === 1) socket.emit('roomJoined', { roomId: room.id, slot });
    else socket.emit('roomCreated', { roomId: room.id, slot });
    maybeStart(room);
  });

  socket.on('input', (raw) => {
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || slot == null) return;
    room.tanks[slot].input = sanitizeInput(raw);
  });

  socket.on('leave', () => cleanup());
  socket.on('disconnect', () => cleanup());

  function cleanup() {
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (room) {
      const idx = room.sockets.indexOf(socket.id);
      if (idx >= 0) room.sockets[idx] = null;
      io.to(room.id).emit('opponentLeft', {});
      // 空房回收
      if (!room.sockets[0] && !room.sockets[1]) rooms.delete(room.id);
    }
    const q = matchQueue.indexOf(socket.id);
    if (q >= 0) matchQueue.splice(q, 1);
    roomId = null; slot = null;
  }

  function maybeStart(room) {
    if (room.sockets[0] && room.sockets[1]) {
      room.phase = 'countdown';
      room.countdown = COUNTDOWN;
      room.round = 1; room.scores = [0, 0];
      resetRoundEntities(room);
      io.to(room.id).emit('matchStart', { round: 1 });
      io.to(room.id).emit('countdown', { n: COUNTDOWN, round: 1 });
    } else {
      socket.emit('queued', { position: matchQueue.length });
    }
  }
});

// 每帧推进所有房间
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.phase === 'waiting') continue;
    // 绑定 roomId 供 sfx
    room.tanks[0]._roomId = room.id; room.tanks[1]._roomId = room.id;
    stepRoom(room, TICK_DT);
    room.brickDirty.clear();
    const snap = buildSnapshot(room);
    io.to(room.id).emit('snapshot', snap);
  }
}, 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`[online] listening on :${PORT}  (map ${MAP_W}x${MAP_H}, ${BASE_MAP.length} tiles)`));

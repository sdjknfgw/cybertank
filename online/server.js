/**
 * server.js —— CyberTank 1v1 联机服务端（权威模拟）
 * ------------------------------------------------------------
 * 技术栈：Node.js + Express（静态托管）+ Socket.IO（实时通信）
 * 两者均为免费、轻量依赖，无付费 SDK。
 *
 * 设计要点（对应需求约束）：
 *  1) 服务端持有「权威游戏状态」：客户端只能上报「输入指令」，
 *     绝不能直接修改血量/位置等状态 —— 从根源上降低作弊风险。
 *  2) 固定步长（TICK_HZ）模拟，每步结束后向房间内两人广播快照。
 *  3) 两种进入方式：
 *     a. 房间模式：createRoom 生成房间号，joinRoom 凭号加入；
 *     b. 公开匹配：quickMatch 进入等待队列，凑满 2 人自动成房。
 *  4) 所有来自客户端的输入都在服务端做「清洗 / 限频 / 边界夹紧」，
 *     非法数据被丢弃或修正，不会污染模拟。
 */

'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

// ============================================================
// 0. 基础配置
// ============================================================
const PORT = process.env.PORT || 3000;
const TICK_HZ = 30;                 // 服务器模拟频率（每秒步数）
const TICK_DT = 1 / TICK_HZ;        // 每步时间（秒）

// 竞技场与游戏规则（全部由服务端定义，客户端不可篡改）
const ARENA = { w: 880, h: 600 };   // 画布逻辑尺寸（与前端渲染保持一致）
const TANK_R = 18;                  // 坦克碰撞半径
const TANK_SPEED = 175;             // 移动速度 px/s
const BULLET_SPEED = 480;           // 子弹速度 px/s
const BULLET_R = 5;
const FIRE_CD = 0.32;               // 开火冷却（秒）—— 服务端限频核心
const DAMAGE = 12;                  // 单发伤害
const MAX_HP = 100;
const SHIELD_MAX = 50;              // 技能护盾值
const SKILL_CD = 6;                 // 技能冷却（秒）
const SKILL_DUR = 2;                // 护盾持续时间（秒）
const ROUNDS_TO_WIN = 3;            // BO5：先到 3 胜即赢下整场
const COUNTDOWN = 3;                // 每回合开局倒计时（秒）
const ROUND_END_DELAY = 2.0;        // 回合结束后到下一回合的间隔（秒）

// ============================================================
// 1. 工具函数
// ============================================================
function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

// 把角度规范到 [0, 2π)，防止客户端传入超长/负数导致异常
function normAngle(a) {
  a = a % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a;
}

// 输入模板与「清洗」：把任意客户端数据变成安全的布尔/数值
const EMPTY_INPUT = { up: false, down: false, left: false, right: false, fire: false, skill: false, aim: 0 };

function sanitizeInput(raw) {
  raw = raw || {};
  return {
    up: !!raw.up,
    down: !!raw.down,
    left: !!raw.left,
    right: !!raw.right,
    fire: !!raw.fire,
    skill: !!raw.skill,
    aim: normAngle(Number(raw.aim) || 0), // 只接受数字角度，否则归零
  };
}

// ============================================================
// 2. HTTP + Socket.IO 初始化
// ============================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // 开发期允许任何来源跨域；公网部署时务必改成你的前端域名，见指南第 6 节
  cors: { origin: '*' },
});

// 可选：通过 GAME_DIR 同源托管「真实游戏目录」（默认仅托管 public 示例页）
// 设置 GAME_DIR 后，浏览器访问 http://<host>:<port>/ 即加载真实 CyberTank，
// 且联机 socket.io 与页面同源，避免跨域。不影响默认行为（不设置则只用 public）。
if (process.env.GAME_DIR) {
  app.use(express.static(process.env.GAME_DIR));
}
// 托管前端联机示例页面（public/index.html）
app.use(express.static(path.join(__dirname, 'public')));

// 简单健康检查，方便确认服务已启动
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, queue: matchQueue.length }));

// ============================================================
// 3. 房间与匹配队列数据
// ============================================================
/** @type {Map<string, Room>} 房间号 -> 房间对象 */
const rooms = new Map();
/** 公开匹配等待队列：存放 socket.id */
const matchQueue = [];

// 生成 6 位「无易混字符」房间号（去掉 0/O/1/I 等）
function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(id));
  return id;
}

// 新建一辆坦克的状态（仅数据，不含渲染）
function newTankState() {
  return {
    x: 0, y: 0,
    angle: 0,         // 车体朝向（移动方向）
    turretAngle: 0,   // 炮塔朝向（瞄准方向，由客户端 aim 决定）
    hp: MAX_HP,
    shield: 0,
    shieldTimer: 0,
    fireCd: 0,
    skillCd: 0,
    alive: true,
    hitFlash: 0,      // 受击闪烁计时，仅用于前端表现
  };
}

// 新建房间
function createRoom(creatorId) {
  const id = genRoomId();
  const room = {
    id,
    players: [null, null], // 固定两个槽位：0 = 先手(建房者)，1 = 后手(加入者)
    state: 'waiting',      // waiting -> countdown -> playing -> roundEnd -> (countdown|finished)
    scores: [0, 0],        // 双方已胜回合
    tick: 0,
    countdown: 0,
    roundEndTimer: 0,
    lastWinner: -1,
    tanks: [newTankState(), newTankState()],
    bullets: [],
  };
  rooms.set(id, room);
  return room;
}

// 把坦克摆到对角出生点，车头朝场地中心
function placeTanks(room) {
  const [a, b] = room.tanks;
  a.x = ARENA.w * 0.18; a.y = ARENA.h * 0.5; a.angle = 0;        a.turretAngle = 0;
  b.x = ARENA.w * 0.82; b.y = ARENA.h * 0.5; b.angle = Math.PI;  b.turretAngle = Math.PI;
  for (const t of room.tanks) {
    t.hp = MAX_HP; t.shield = 0; t.shieldTimer = 0; t.fireCd = 0; t.skillCd = 0;
    t.alive = true; t.hitFlash = 0;
  }
  room.bullets = [];
}

// ============================================================
// 4. 权威模拟（核心：服务端跑物理与命中判定）
// ============================================================
function applyDamage(t, dmg) {
  if (t.shield > 0) {                 // 先扣护盾，再扣血
    const absorbed = Math.min(t.shield, dmg);
    t.shield -= absorbed;
    dmg -= absorbed;
  }
  t.hp -= dmg;
  t.hitFlash = 0.12;
}

// 某辆坦克被摧毁：给对手加分，进入回合结算
function onTankDestroyed(room, winnerSlot) {
  room.scores[winnerSlot] += 1;
  room.lastWinner = winnerSlot;
  room.state = 'roundEnd';
  room.roundEndTimer = ROUND_END_DELAY;
}

// 推进一个房间一步
function stepRoom(room, dt) {
  // 倒计时阶段：只读秒，不动实体
  if (room.state === 'countdown') {
    room.countdown -= dt;
    if (room.countdown <= 0) room.state = 'playing';
    return;
  }
  if (room.state !== 'playing') return;

  const p0 = room.players[0], p1 = room.players[1];
  const inputs = [p0 ? p0.lastInput : EMPTY_INPUT, p1 ? p1.lastInput : EMPTY_INPUT];

  // 逐坦克更新
  for (let i = 0; i < 2; i++) {
    const t = room.tanks[i];
    const inp = inputs[i];
    if (!t.alive) continue;

    // 平移式移动（与 CyberTank 本体操作一致：W上 S下 A左 D右 即世界方向；鼠标控制炮口）
    const vx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const vy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    const mlen = Math.hypot(vx, vy);
    if (mlen > 0) {
      t.x += (vx / mlen) * TANK_SPEED * dt;
      t.y += (vy / mlen) * TANK_SPEED * dt;
      t.angle = Math.atan2(vy, vx); // 车身朝移动方向
    }
    // 边界夹紧：服务端权威，客户端无法越界（防穿墙作弊）
    t.x = clamp(t.x, TANK_R, ARENA.w - TANK_R);
    t.y = clamp(t.y, TANK_R, ARENA.h - TANK_R);

    // 炮塔瞄准：直接采用服务端收到的（已清洗）输入
    t.turretAngle = inp.aim;

    // 冷却递减
    t.fireCd = Math.max(0, t.fireCd - dt);
    t.skillCd = Math.max(0, t.skillCd - dt);
    if (t.shieldTimer > 0) {
      t.shieldTimer -= dt;
      if (t.shieldTimer <= 0) t.shield = 0;
    }
    if (t.hitFlash > 0) t.hitFlash = Math.max(0, t.hitFlash - dt);

    // 开火（服务端限频，客户端狂点也只按 FIRE_CD 出弹）
    if (inp.fire && t.fireCd <= 0) {
      const mx = t.x + Math.cos(t.turretAngle) * (TANK_R + 6);
      const my = t.y + Math.sin(t.turretAngle) * (TANK_R + 6);
      room.bullets.push({
        x: mx, y: my,
        vx: Math.cos(t.turretAngle) * BULLET_SPEED,
        vy: Math.sin(t.turretAngle) * BULLET_SPEED,
        owner: i,
      });
      t.fireCd = FIRE_CD;
    }

    // 技能（开护盾），同样服务端限频
    if (inp.skill && t.skillCd <= 0) {
      t.shield = SHIELD_MAX;
      t.shieldTimer = SKILL_DUR;
      t.skillCd = SKILL_CD;
    }
  }

  // 子弹推进 + 命中判定
  const hitR = TANK_R + BULLET_R;
  for (let bi = room.bullets.length - 1; bi >= 0; bi--) {
    const b = room.bullets[bi];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // 出界即销毁
    if (b.x < 0 || b.x > ARENA.w || b.y < 0 || b.y > ARENA.h) {
      room.bullets.splice(bi, 1);
      continue;
    }
    // 只能打中「对方」坦克（自己发的子弹不打自己）
    const target = room.tanks[1 - b.owner];
    if (target && target.alive && (b.x - target.x) ** 2 + (b.y - target.y) ** 2 <= hitR * hitR) {
      applyDamage(target, DAMAGE);
      room.bullets.splice(bi, 1);
      if (target.hp <= 0) {
        target.alive = false;
        onTankDestroyed(room, b.owner); // 开火者（子弹主人）得分
      }
    }
  }
}

// 组装广播给客户端的快照（只发「表现所需」的数据，不泄露服务端内部）
function buildSnapshot(room) {
  return {
    phase: room.state,
    countdown: Math.max(0, Math.ceil(room.countdown)),
    scores: room.scores,
    lastWinner: room.lastWinner,
    arena: ARENA,
    tanks: room.tanks.map(t => ({
      x: t.x, y: t.y, angle: t.angle, turretAngle: t.turretAngle,
      hp: t.hp, shield: t.shield, alive: t.alive,
      fireReady: t.fireCd <= 0, skillCd: t.skillCd, hitFlash: t.hitFlash,
    })),
    bullets: room.bullets.map(b => ({ x: b.x, y: b.y })),
  };
}

// 向房间内所有人广播
function broadcast(room, type, data) {
  io.to(room.id).emit(type, data);
}

// 主循环：每步推进所有活跃房间并广播快照
function tickAll() {
  for (const room of rooms.values()) {
    if (room.state === 'playing' || room.state === 'countdown') {
      stepRoom(room, TICK_DT);
    } else if (room.state === 'roundEnd') {
      room.roundEndTimer -= TICK_DT;
      if (room.roundEndTimer <= 0) {
        if (room.scores[0] >= ROUNDS_TO_WIN || room.scores[1] >= ROUNDS_TO_WIN) {
          room.state = 'finished';
          broadcast(room, 'matchEnd', { scores: room.scores });
        } else {
          placeTanks(room);
          room.state = 'countdown';
          room.countdown = COUNTDOWN;
        }
      }
    }
    // 对局相关阶段都广播快照，让客户端持续刷新画面
    if (['countdown', 'playing', 'roundEnd'].includes(room.state)) {
      broadcast(room, 'snapshot', buildSnapshot(room));
    }
    room.tick++;
  }
}
setInterval(tickAll, 1000 / TICK_HZ);

// ============================================================
// 5. 房间 / 队列 操作辅助
// ============================================================
function joinRoomAs(socket, room, slot) {
  socket.data.roomId = room.id;
  socket.join(room.id);
  room.players[slot] = { socketId: socket.id, slot, lastInput: sanitizeInput({}) };
  io.to(room.id).emit('peerJoined', { slot, count: room.players.filter(Boolean).length });
}

// 两个槽位都满且仍在等待 -> 开局
function maybeStart(room) {
  if (room.state === 'waiting' && room.players.filter(Boolean).length === 2) {
    placeTanks(room);
    room.state = 'countdown';
    room.countdown = COUNTDOWN;
    broadcast(room, 'matchStart', { arena: ARENA, roundsToWin: ROUNDS_TO_WIN });
  }
}

function leaveQueue(socket) {
  const i = matchQueue.indexOf(socket.id);
  if (i >= 0) matchQueue.splice(i, 1);
}

function leaveRoom(socket) {
  const rid = socket.data.roomId;
  if (!rid) return;
  const room = rooms.get(rid);
  socket.data.roomId = null;
  socket.leave(rid);
  if (!room) return;
  const p = room.players.find(p => p && p.socketId === socket.id);
  if (p) room.players[p.slot] = null;
  socket.to(rid).emit('peerLeft', { slot: p ? p.slot : -1 });
  if (room.players.filter(Boolean).length === 0) {
    rooms.delete(rid); // 人走光，销毁房间
  } else {
    room.state = 'finished'; // 对手掉线，结束本局并通知
    broadcast(room, 'opponentLeft', {});
  }
}

// 匹配队列凑满 2 人 -> 自动建房并开局
function tryMatch() {
  while (matchQueue.length >= 2) {
    const idA = matchQueue.shift();
    const idB = matchQueue.shift();
    const sa = io.sockets.sockets.get(idA);
    const sb = io.sockets.sockets.get(idB);
    if (!sa || !sb) { // 任一已断开则把有效的放回队列
      if (sa) matchQueue.unshift(idA);
      if (sb) matchQueue.unshift(idB);
      break;
    }
    if (sa.data.roomId) leaveRoom(sa);
    if (sb.data.roomId) leaveRoom(sb);
    const room = createRoom(idA);
    joinRoomAs(sa, room, 0);
    joinRoomAs(sb, room, 1);
    sa.emit('roomCreated', { roomId: room.id, slot: 0, matched: true });
    sb.emit('roomJoined', { roomId: room.id, slot: 1, matched: true });
    maybeStart(room);
  }
}

// ============================================================
// 6. Socket.IO 事件处理
// ============================================================
io.on('connection', (socket) => {
  socket.data.roomId = null;

  // 6.1 创建房间（房主 = 槽位 0）
  socket.on('createRoom', () => {
    leaveQueue(socket);
    if (socket.data.roomId) leaveRoom(socket);
    const room = createRoom(socket.id);
    joinRoomAs(socket, room, 0);
    socket.emit('roomCreated', { roomId: room.id, slot: 0 });
  });

  // 6.2 凭房间号加入（加入者 = 槽位 1）
  socket.on('joinRoom', ({ roomId }) => {
    leaveQueue(socket);
    const rid = (roomId || '').toUpperCase().trim();
    const room = rooms.get(rid);
    if (!room) { socket.emit('errorMsg', { msg: '房间不存在，请确认房间号' }); return; }
    if (room.players.filter(Boolean).length >= 2) { socket.emit('errorMsg', { msg: '房间已满' }); return; }
    const slot = room.players[0] ? 1 : 0; // 兜底：若槽位0空则补0
    joinRoomAs(socket, room, slot);
    socket.emit('roomJoined', { roomId: room.id, slot });
    maybeStart(room);
  });

  // 6.3 公开匹配：无房间号时进入队列，自动匹配等待中的玩家
  socket.on('quickMatch', () => {
    if (socket.data.roomId) { socket.emit('errorMsg', { msg: '你已在对局中' }); return; }
    if (!matchQueue.includes(socket.id)) {
      matchQueue.push(socket.id);
      socket.emit('queued', { position: matchQueue.length });
      tryMatch();
    }
  });

  // 6.4 接收输入（仅对局中有效；非对局状态直接丢弃 —— 防抢跑/作弊）
  socket.on('input', (inp) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.state !== 'playing') return;
    const p = room.players.find(p => p && p.socketId === socket.id);
    if (!p) return;
    room.players[p.slot].lastInput = sanitizeInput(inp); // 服务端清洗后再用
  });

  // 6.5 主动退出房间 / 取消匹配
  socket.on('leave', () => {
    leaveQueue(socket);
    leaveRoom(socket);
  });

  // 6.6 断线清理
  socket.on('disconnect', () => {
    leaveQueue(socket);
    leaveRoom(socket);
  });
});

// ============================================================
// 7. 启动
// ============================================================
server.listen(PORT, () => {
  console.log(`[CyberTank 联机] 服务已启动: http://localhost:${PORT}`);
  console.log(`[CyberTank 联机] 局域网其它设备访问: http://<本机IP>:${PORT}`);
});

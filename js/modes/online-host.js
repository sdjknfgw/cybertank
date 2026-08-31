/* =========================================================
 * CyberTank · 联机 1v1 房主端权威模拟（浏览器内运行）
 * 命名空间: window.CT_ONLINE_HOST
 *
 * 由 online/server.js 移植（地图/规则/物理与单人 1v1 保持一致）：
 *   - P2P 架构下「建房者」即主机：权威模拟跑在房主浏览器里，
 *     快照按 30Hz 发给对手，对手只回传 input。
 *   - 与 server.js 的唯一结构差异：io.to(room).emit(...) 改为事件队列
 *     takeEvents()，由宿主（online.js）负责「本地处理 + 转发给对手」。
 *   - 顺带修正两处移植缺陷：炮塔角度随 aim 同步；速度/伤害增益实际生效。
 * 兼容 Node（module.exports），便于无头冒烟测试。
 * ========================================================= */
(function (global) {
  'use strict';

  /* ---------- 1v1 地图（与 duel._BASE_MAP / server.js 完全一致的点对称布局） ---------- */
  var BASE_MAP = [
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
  var TILE = 32;
  var MAP_W = BASE_MAP[0].length * TILE; // 640
  var MAP_H = BASE_MAP.length * TILE;    // 640

  /* ---------- 常量（与 server.js 一致） ---------- */
  var TANK_SPEED = 210;
  var TANK_R = 18;
  var BULLET_SPEED = 460;
  var BULLET_R = 5;
  var FIRE_CD = 0.32;
  var DAMAGE = 1;
  var MAX_HP = 5;
  var ROUNDS_TO_WIN = 3;   // BO5 先取 3 局
  var ROUND_TIME = 90;
  var COUNTDOWN = 3;
  var ROUND_GAP = 2.5;
  var BOUNCE_TIMES = 2;
  var PUP_FIRST = 6;
  var PUP_INTERVAL = 14;
  var PUP_TTL = 10;        // 道具 10 秒未拾取消失
  var TICK_HZ = 30;
  var TICK_DT = 1 / TICK_HZ;

  // 出生点（点对称对角线）
  var SPAWNS = [
    { x: MAP_W * 0.25, y: MAP_H * 0.75 },
    { x: MAP_W * 0.75, y: MAP_H * 0.25 },
  ];

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---------- 地图生成：把模板解析成障碍对象 ---------- */
  function buildMap() {
    var obstacles = [];
    for (var r = 0; r < BASE_MAP.length; r++) {
      var row = BASE_MAP[r] || '';
      for (var c = 0; c < row.length; c++) {
        var ch = row[c] || '.';
        var x = c * TILE, y = r * TILE;
        if (ch === 'B') obstacles.push(mkOb('brick', x, y, 3));
        else if (ch === 'S') obstacles.push(mkOb('steel', x, y, Infinity));
        else if (ch === 'G') obstacles.push(mkOb('bush', x, y, Infinity));
        else if (ch === 'W') obstacles.push(mkOb('water', x, y, Infinity));
        else if (ch === 'I') obstacles.push(mkOb('ice', x, y, Infinity));
        else if (ch === 'M') obstacles.push(mkOb('mud', x, y, Infinity));
      }
    }
    // 对称放置 2 对传送门（坦克踏入即传送到配对端，1s 冷却）
    var portalPairs = [
      [{ x: 9 * TILE, y: 9 * TILE }, { x: 10 * TILE, y: 10 * TILE }],
      [{ x: 9 * TILE, y: 10 * TILE }, { x: 10 * TILE, y: 9 * TILE }],
    ];
    for (var i = 0; i < portalPairs.length; i++) {
      var a = portalPairs[i][0], b = portalPairs[i][1];
      obstacles.push(mkPortal('p' + (i + 1) + 'a', 'p' + (i + 1) + 'b', a.x, a.y));
      obstacles.push(mkPortal('p' + (i + 1) + 'b', 'p' + (i + 1) + 'a', b.x, b.y));
    }
    return obstacles;
  }
  function mkOb(type, x, y, hp) {
    var blockTank = (type === 'brick' || type === 'steel');
    return {
      type: type, x: x, y: y, w: TILE, h: TILE, hp: hp, maxHp: hp,
      alive: true, blockTank: blockTank, blockBullet: blockTank,
    };
  }
  function mkPortal(id, pairId, x, y) {
    return {
      type: 'portal', id: id, pairId: pairId, x: x, y: y, w: TILE, h: TILE,
      hp: Infinity, alive: true, blockTank: false, blockBullet: false,
    };
  }
  // 找地图里一块随机空地（用于道具掉落）
  function randomEmptyCell(obstacles) {
    for (var t = 0; t < 30; t++) {
      var c = 1 + ((Math.random() * (BASE_MAP[0].length - 2)) | 0);
      var r = 1 + ((Math.random() * (BASE_MAP.length - 2)) | 0);
      var x = c * TILE + TILE / 2, y = r * TILE + TILE / 2;
      var ok = true;
      for (var i = 0; i < obstacles.length; i++) {
        var o = obstacles[i];
        if (!o.alive || !o.blockTank) continue;
        if (Math.abs(o.x + TILE / 2 - x) < TILE && Math.abs(o.y + TILE / 2 - y) < TILE) { ok = false; break; }
      }
      if (ok) return { x: x, y: y };
    }
    return { x: MAP_W / 2, y: MAP_H / 2 };
  }

  /* ---------- 输入清洗（防作弊：只保留白名单字段） ---------- */
  function sanitizeInput(raw) {
    raw = raw || {};
    return {
      up: !!raw.up, down: !!raw.down, left: !!raw.left, right: !!raw.right,
      fire: !!raw.fire, skill: !!raw.skill,
      aim: (typeof raw.aim === 'number' && isFinite(raw.aim)) ? raw.aim : null,
    };
  }

  /* ---------- 权威模拟（单房间） ---------- */
  function Sim() {
    this.tanks = [newTank(0), newTank(1)];
    this.phase = 'waiting';
    this.round = 1;
    this.scores = [0, 0];
    this.countdown = 0;
    this.roundTimeLeft = 0;
    this.roundEndT = 0;
    this.lastWinner = null;
    this.roundWinner = null;
    this.obstacles = buildMap();
    this.bullets = [];
    this.powerups = [];
    this.pupTimer = PUP_FIRST;
    this.brickDirty = new Set();
    this.nextId = 1;
    this.events = []; // {type, data}，由宿主取出后本地处理+转发
  }

  function newTank(slot) {
    var sp = SPAWNS[slot];
    return {
      slot: slot, x: sp.x, y: sp.y,
      angle: slot === 0 ? -Math.PI / 4 : Math.PI * 3 / 4,
      turretAngle: slot === 0 ? -Math.PI / 4 : Math.PI * 3 / 4,
      hp: MAX_HP, shield: 0, alive: true, fireCd: 0, portalCd: 0,
      input: {}, _speedBuff: 1, _speedBuffT: 0, _dmgBuff: 1,
    };
  }

  Sim.prototype.emit = function (type, data) { this.events.push({ type: type, data: data }); };
  Sim.prototype.takeEvents = function () { var e = this.events; this.events = []; return e; };
  Sim.prototype.setInput = function (slot, raw) { this.tanks[slot].input = sanitizeInput(raw); };

  /* 开局：BO5 重置比分 → 回合倒计时（内部产生 matchStart/mapInit/countdown 事件） */
  Sim.prototype.start = function () {
    this.phase = 'countdown';
    this.countdown = COUNTDOWN;
    this.round = 1;
    this.scores = [0, 0];
    resetRoundEntities(this);
    this.emit('matchStart', { round: 1 });
    this.emit('countdown', { n: COUNTDOWN, round: 1 });
  };

  /* 每帧推进（宿主以 30Hz 调用） */
  Sim.prototype.tick = function (dt) { stepRoom(this, dt || TICK_DT); };

  function stepRoom(room, dt) {
    var tanks = room.tanks;
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

    // 坦克移动 + 障碍碰撞 + 地形减速 + 增益
    for (var i = 0; i < 2; i++) {
      var t = tanks[i];
      if (!t.alive) continue;
      var inp = t.input || {};
      t.fireCd = Math.max(0, t.fireCd - dt);
      t.portalCd = Math.max(0, t.portalCd - dt);
      if (t._speedBuffT > 0) t._speedBuffT -= dt;
      var vx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      var vy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      var mlen = Math.hypot(vx, vy);
      if (mlen > 0) {
        var sp = TANK_SPEED * terrainFactor(room.obstacles, t.x, t.y);
        if (t._speedBuffT > 0) sp *= t._speedBuff;
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
      // 炮塔随瞄准转动（渲染用）
      if (inp.aim != null) t.turretAngle = inp.aim;
      // 开火
      if (inp.fire && t.fireCd <= 0) {
        fire(room, t, i, inp.aim);
        t.fireCd = FIRE_CD;
      }
    }

    // 子弹推进 + 反弹 + 命中
    for (var bi = 0; bi < room.bullets.length; bi++) {
      var b = room.bullets[bi];
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
      for (var oi = 0; oi < room.obstacles.length; oi++) {
        var o = room.obstacles[oi];
        if (!o.alive || !o.blockBullet) continue;
        if (b.x > o.x - BULLET_R && b.x < o.x + o.w + BULLET_R &&
            b.y > o.y - BULLET_R && b.y < o.y + o.h + BULLET_R) {
          var overlapX = Math.min(b.x + BULLET_R - o.x, o.x + o.w - (b.x - BULLET_R));
          var overlapY = Math.min(b.y + BULLET_R - o.y, o.y + o.h - (b.y - BULLET_R));
          if (b.bounces > 0) {
            b.bounces--;
            if (overlapX < overlapY) b.vx = -b.vx; else b.vy = -b.vy;
            if (overlapX < overlapY) b.x += (b.vx > 0 ? overlapX + 1 : -(overlapX + 1));
            else b.y += (b.vy > 0 ? overlapY + 1 : -(overlapY + 1));
          } else b.alive = false;
          // 砖墙扣血
          if (o.type === 'brick' && o.hp !== Infinity) {
            o.hp -= 1; room.brickDirty.add(oi);
            if (o.hp <= 0) o.alive = false;
          }
          if (!b.alive) break;
        }
      }
      if (!b.alive) continue;
      // 命中坦克（不打自己）
      for (var j = 0; j < 2; j++) {
        var tt = tanks[j];
        if (!tt.alive || j === b.owner) continue;
        var dx = b.x - tt.x, dy = b.y - tt.y;
        if (dx * dx + dy * dy <= (TANK_R + BULLET_R) * (TANK_R + BULLET_R)) {
          applyDamage(room, tt, DAMAGE * (tanks[b.owner]._dmgBuff || 1));
          b.alive = false;
          if (tt.hp <= 0 && tt.alive) { tt.alive = false; onTankDestroyed(room, b.owner); }
          break;
        }
      }
    }
    room.bullets = room.bullets.filter(function (b) { return b.alive; });

    // 道具：掉落 + 10 秒消失 + 拾取
    room.pupTimer -= dt;
    if (room.pupTimer <= 0) {
      var cell = randomEmptyCell(room.obstacles);
      var ids = ['P01', 'P02', 'P04', 'P09']; // 仅含有实际效果的道具
      room.powerups.push({
        id: room.nextId++, x: cell.x, y: cell.y,
        powerupId: ids[(Math.random() * ids.length) | 0], ttl: PUP_TTL,
      });
      room.pupTimer = PUP_INTERVAL;
    }
    for (var pi = 0; pi < room.powerups.length; pi++) {
      var p = room.powerups[pi];
      p.ttl -= dt;
      if (p.ttl <= 0) { p.alive = false; continue; }
      for (var pj = 0; pj < 2; pj++) {
        var tk = tanks[pj];
        if (!tk.alive) continue;
        var pdx = p.x - tk.x, pdy = p.y - tk.y;
        if (pdx * pdx + pdy * pdy <= (TANK_R + 22) * (TANK_R + 22)) {
          applyPowerup(tk, p.powerupId);
          p.alive = false;
          room.emit('powerupPickup', { slot: pj, id: p.powerupId });
          break;
        }
      }
    }
    room.powerups = room.powerups.filter(function (p) { return p.alive !== false; });
  }

  function fire(room, t, owner, aim) {
    var a = (aim != null) ? aim : t.angle;
    room.bullets.push({
      id: room.nextId++, owner: owner,
      x: t.x + Math.cos(a) * (TANK_R + 6), y: t.y + Math.sin(a) * (TANK_R + 6),
      vx: Math.cos(a) * BULLET_SPEED, vy: Math.sin(a) * BULLET_SPEED,
      bounces: BOUNCE_TIMES, alive: true,
    });
    room.emit('sfx', { type: 'shoot', slot: owner });
  }
  function applyDamage(room, t, dmg) {
    if (t.shield > 0) { var ab = Math.min(t.shield, dmg); t.shield -= ab; dmg -= ab; }
    t.hp = Math.max(0, t.hp - dmg);
    room.emit('sfx', { type: 'hit', slot: t.slot });
  }
  function applyPowerup(t, id) {
    // P01 回血，P02 加速，P04 护盾，P09 升炮
    if (id === 'P01') { t.hp = Math.min(MAX_HP, t.hp + 1); }
    else if (id === 'P02') { t._speedBuff = 1.5; t._speedBuffT = 8; }
    else if (id === 'P09') { t._dmgBuff = Math.min(2, (t._dmgBuff || 1) * 1.25); }
    else if (id === 'P04') { t.shield = Math.min(MAX_HP, t.shield + 1); }
  }
  function terrainFactor(obstacles, x, y) {
    var f = 1;
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (!o.alive) continue;
      if (x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h) {
        if (o.type === 'water' || o.type === 'mud') f = Math.min(f, 0.55);
      }
    }
    return f;
  }
  function resolveTankObstacles(t, obstacles) {
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (!o.alive || !o.blockTank) continue;
      var nx = clamp(t.x, o.x, o.x + o.w), ny = clamp(t.y, o.y, o.y + o.h);
      var dx = t.x - nx, dy = t.y - ny;
      if (dx * dx + dy * dy < TANK_R * TANK_R) {
        var left = Math.abs(t.x - o.x), right = Math.abs(o.x + o.w - t.x);
        var top = Math.abs(t.y - o.y), bottom = Math.abs(o.y + o.h - t.y);
        var m = Math.min(left, right, top, bottom);
        if (m === left) t.x = o.x - TANK_R;
        else if (m === right) t.x = o.x + o.w + TANK_R;
        else if (m === top) t.y = o.y - TANK_R;
        else t.y = o.y + o.h + TANK_R;
      }
    }
  }
  function tryPortal(t, obstacles) {
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (o.type !== 'portal') continue;
      if (t.x > o.x && t.x < o.x + o.w && t.y > o.y && t.y < o.y + o.h) {
        for (var j = 0; j < obstacles.length; j++) {
          if (obstacles[j].id === o.pairId) {
            t.x = obstacles[j].x + TILE / 2; t.y = obstacles[j].y + TILE / 2; t.portalCd = 1;
          }
        }
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
    for (var i = 0; i < 2; i++) {
      var sp = SPAWNS[i];
      var t = room.tanks[i];
      t.x = sp.x; t.y = sp.y; t.hp = MAX_HP; t.shield = 0;
      t.alive = true; t.fireCd = 0; t.portalCd = 0;
      t.input = {}; t._speedBuff = 1; t._speedBuffT = 0; t._dmgBuff = 1;
    }
    room.emit('mapInit', buildMapPayload(room));
  }
  function endRound(room, winnerSlot) {
    if (room.phase !== 'playing') return;
    room.phase = 'roundEnd';
    room.roundEndT = ROUND_GAP;
    var w = winnerSlot;
    if (w == null) {
      var a = room.tanks[0], b = room.tanks[1];
      if (a.hp > 0 && b.hp <= 0) w = 0;
      else if (b.hp > 0 && a.hp <= 0) w = 1;
      else w = (a.hp >= b.hp) ? 0 : 1;
    }
    room.roundWinner = w;
    room.lastWinner = w;
    room.scores[w]++;
    room.emit('sfx', { type: 'kill', slot: w });
    room.emit('roundEnd', { winner: w, scores: room.scores.slice() });
    if (room.scores[w] >= ROUNDS_TO_WIN) {
      room.phase = 'matchEnd';
      room.emit('sfx', { type: 'explode' });
      room.emit('matchEnd', { scores: room.scores.slice(), winner: w });
    }
  }
  function nextRound(room) {
    room.round++;
    room.phase = 'countdown';
    room.countdown = COUNTDOWN;
    room.emit('countdown', { n: COUNTDOWN, round: room.round });
  }
  function onTankDestroyed(room, shooterSlot) {
    endRound(room, shooterSlot); // 击杀方得分
  }

  /* ---------- 快照 / 地图（与 server.js 同构，客户端渲染直接可用） ---------- */
  Sim.prototype.buildSnapshot = function () {
    var room = this;
    return {
      phase: room.phase,
      countdown: Math.ceil(room.countdown),
      round: room.round,
      scores: room.scores.slice(),
      roundWinner: room.roundWinner,
      lastWinner: room.lastWinner,
      tanks: room.tanks.map(function (t) {
        return {
          x: Math.round(t.x), y: Math.round(t.y), angle: +t.angle.toFixed(3),
          turretAngle: +t.turretAngle.toFixed(3), hp: t.hp, shield: t.shield, alive: t.alive,
        };
      }),
      bullets: room.bullets.map(function (b) {
        return { x: Math.round(b.x), y: Math.round(b.y), angle: +Math.atan2(b.vy, b.vx).toFixed(2) };
      }),
      powerups: room.powerups.map(function (p) {
        return { x: Math.round(p.x), y: Math.round(p.y), id: p.powerupId };
      }),
      brk: Array.from(room.brickDirty).map(function (i) {
        var o = room.obstacles[i];
        return { i: i, hp: o ? o.hp : 0, alive: o ? o.alive : false };
      }),
    };
  };
  function buildMapPayload(room) {
    return {
      w: MAP_W, h: MAP_H, tile: TILE, spawns: SPAWNS,
      obstacles: room.obstacles.map(function (o, i) {
        return {
          i: i, type: o.type, x: o.x, y: o.y, w: o.w, h: o.h,
          hp: o.hp, alive: o.alive, blockTank: o.blockTank, blockBullet: o.blockBullet,
        };
      }),
    };
  }

  var API = {
    Sim: Sim,
    TICK_HZ: TICK_HZ, TICK_DT: TICK_DT,
    MAP_W: MAP_W, MAP_H: MAP_H,
    ROUNDS_TO_WIN: ROUNDS_TO_WIN, ROUND_TIME: ROUND_TIME, MAX_HP: MAX_HP,
  };
  global.CT_ONLINE_HOST = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

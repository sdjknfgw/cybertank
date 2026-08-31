/* =========================================================
 * CyberTank · 联机 1v1 模式（嫁接版）
 * 命名空间: window.CT_MODE_ONLINE
 *
 * 设计（与「示例页」共用同一套服务端 server.js）：
 *   - 服务端权威：本模块【不跑任何物理】，只做两件事：
 *       1) 把本地按键/鼠标 → 发给服务端（input 事件）
 *       2) 把服务端快照 snapshot → 同步到两个「木偶 Tank」并渲染
 *   - 复用原版 Tank 实体（CT_TANK.Tank）的 render()，美术/手感完全一致，
 *     仅把 pos/angle/turretAngle/hp/shield/alive 每帧从快照覆写。
 *   - 引擎层：注册一个 update 钩子（驱动同步+发送）与一个 fx 层 render 钩子
 *     （画竞技场+坦克+子弹+比分），两者都用 active 开关自保活，停止即不渲染。
 *   - socket.io 客户端按需从联机服务动态加载，URL 由 window.CT_NET_URL 指定
 *     （默认 http://localhost:3000）。
 * ========================================================= */
(function (global) {
  'use strict';

  // 必须与 server.js 的 ARENA 完全一致（坐标系对齐）
  var ARENA = { w: 880, h: 600 };

  var NS = {};
  var active = false;       // 整个模式是否激活
  var started = false;      // 是否已进入对战（matchStart 之后）
  var socket = null;
  var mySlot = null;        // 0 或 1
  var roomId = null;
  var latest = null;        // 最近一次服务端快照
  var puppets = [null, null]; // 两个木偶 Tank（仅用于渲染）
  var lastInputT = 0;
  var lastRect = { left: 0, top: 0 }; // 画布在屏幕上的位置，用于把鼠标换算到竞技场坐标
  var opts = {};            // { mode, roomId, tank, skin }
  var escHandler = null;
  var _registered = false;

  function toastMsg(m, lv) { try { global.CT_TOAST && global.CT_TOAST(m, lv || 'info'); } catch (e) {} }
  function netUrl() { return global.CT_NET_URL || 'http://localhost:3000'; }

  /* ---------- 动态加载 socket.io 客户端 ---------- */
  function ensureSocketIo() {
    return new Promise(function (resolve, reject) {
      if (global.io) return resolve(global.io);
      var s = document.createElement('script');
      s.src = netUrl() + '/socket.io/socket.io.js';
      s.onload = function () { global.io ? resolve(global.io) : reject(new Error('socket.io 加载失败')); };
      s.onerror = function () { reject(new Error('无法加载联机客户端（服务未启动？）')); };
      document.head.appendChild(s);
    });
  }

  /* ---------- 木偶坦克：用原版 Tank 渲染，但只被快照驱动 ---------- */
  function buildPuppets() {
    var T = global.CT_TANK && global.CT_TANK.Tank;
    if (!T) return;
    var localClass = opts.tank || 'assault';
    var localColor = opts.skin || '#00e5ff';
    // 我方 type='player'（原版渲染会给白色高亮环），对方 type='enemy'
    var p1 = new T({ x: 0, y: 0, type: 'player', tankClass: localClass, color: localColor });
    var p2 = new T({ x: 0, y: 0, type: 'enemy',  tankClass: localClass, color: '#ff2a6d' });
    p1.maxHp = 100; p2.maxHp = 100;
    // 顺序：puppets[0] 永远是服务端槽位0，puppets[1] 是槽位1；mySlot 决定哪个是“我”
    puppets = mySlot === 1 ? [p2, p1] : [p1, p2];
  }

  function syncPuppets() {
    if (!latest) return;
    for (var i = 0; i < 2; i++) {
      var p = puppets[i], t = latest.tanks[i];
      if (!p || !t) continue;
      p.pos.x = t.x; p.pos.y = t.y;
      p.angle = t.angle; p.turretAngle = t.turretAngle;
      p.hp = t.hp; p.shield = t.shield; p.alive = t.alive;
    }
  }

  /* ---------- 输入：本地键鼠 → 服务端 input ---------- */
  function sendInput() {
    if (!socket || !latest) return;
    var IN = global.CT_INPUT;
    var me = latest.tanks[mySlot];
    // 把鼠标屏幕坐标换算成竞技场世界坐标（与渲染用同一套相机参数）
    var R = global.CT_RENDERER;
    var vp = (R && R.viewport) || { w: 880, h: 600 };
    var W = vp.w, H = vp.h;
    var scale = Math.min(W / ARENA.w, H / ARENA.h) * 0.96;
    var aim = me ? me.angle : 0;
    if (IN && me) {
      var m = IN.mouse;
      if (m) {
        var cx = (m.x || 0) - lastRect.left;
        var cy = (m.y || 0) - lastRect.top;
        var wx = (cx - W / 2) / scale + ARENA.w / 2;
        var wy = (cy - H / 2) / scale + ARENA.h / 2;
        aim = Math.atan2(wy - me.y, wx - me.x);
      }
    }
    var snap = IN ? IN.snapshot() : {};
    // 服务端是 directMove 语义：up/down/left/right 即世界方向，与 CT_INPUT 完全一致
    socket.emit('input', {
      up: !!(snap.up), down: !!(snap.down), left: !!(snap.left), right: !!(snap.right),
      fire: !!(snap.shoot), skill: !!(snap.skill), aim: aim
    });
  }

  /* ---------- 引擎钩子：update（驱动同步 + 按 30Hz 发输入） ---------- */
  NS._update = function () {
    if (!active || !started) return;
    syncPuppets();
    var now = (global.performance ? performance.now() : Date.now());
    if (now - lastInputT >= 33) { // ~30Hz
      lastInputT = now;
      sendInput();
    }
  };

  /* ---------- 引擎钩子：render（fx 层，最上层） ---------- */
  NS._render = function (ctx) {
    if (!active) return;
    var R = global.CT_RENDERER;
    if (!R || !R.viewport) return;
    var W = R.viewport.w, H = R.viewport.h;
    if (ctx.canvas) lastRect = ctx.canvas.getBoundingClientRect();

    ctx.save();
    // 背景
    ctx.fillStyle = '#060912'; ctx.fillRect(0, 0, W, H);
    var scale = Math.min(W / ARENA.w, H / ARENA.h) * 0.96;
    var cam = { x: ARENA.w / 2, y: ARENA.h / 2, scale: scale, w: W, h: H };
    // 竞技场边框（中心对齐）
    var bx = W / 2 - ARENA.w * scale / 2, by = H / 2 - ARENA.h * scale / 2;
    ctx.strokeStyle = 'rgba(0,229,255,0.5)'; ctx.lineWidth = 2;
    ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 14;
    ctx.strokeRect(bx, by, ARENA.w * scale, ARENA.h * scale); ctx.shadowBlur = 0;

    if (!started) {
      ctx.fillStyle = '#9fb0c8'; ctx.font = '20px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('等待对手加入… 房间号：' + (roomId || '------'), W / 2, H / 2);
      ctx.restore();
      drawHud(ctx, W, H);
      return;
    }

    // 子弹（用同一相机换算）
    if (latest) {
      ctx.fillStyle = '#ffd54a';
      for (var i = 0; i < latest.bullets.length; i++) {
        var b = latest.bullets[i];
        var sx = (b.x - cam.x) * scale + cam.w / 2;
        var sy = (b.y - cam.y) * scale + cam.h / 2;
        ctx.beginPath(); ctx.arc(sx, sy, 5 * scale, 0, Math.PI * 2); ctx.fill();
      }
    }
    // 坦克（原版 Tank 渲染，复用全部美术）
    if (puppets[0]) puppets[0].render(ctx, cam);
    if (puppets[1]) puppets[1].render(ctx, cam);
    ctx.restore();

    drawHud(ctx, W, H);
  };

  function drawHud(ctx, W, H) {
    if (!latest) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e7ecf3'; ctx.font = 'bold 22px system-ui';
    ctx.fillText('P1  ' + latest.scores[0] + '  :  ' + latest.scores[1] + '  P2', W / 2, 30);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7c89a0'; ctx.font = '12px monospace';
    ctx.fillText('房间 ' + (roomId || '--') + (mySlot != null ? (' · 你: P' + (mySlot + 1)) : ''), 12, 22);
    ctx.textAlign = 'center';
    if (latest.phase === 'countdown') {
      ctx.fillStyle = '#ffd54a'; ctx.font = 'bold 64px system-ui';
      ctx.fillText(latest.countdown, W / 2, H / 2);
    } else if (latest.phase === 'roundEnd') {
      ctx.fillStyle = '#ffd54a'; ctx.font = 'bold 36px system-ui';
      ctx.fillText(latest.lastWinner === mySlot ? '本回合胜利！' : '本回合失利', W / 2, H / 2);
    }
    ctx.restore();
  }

  /* ---------- Socket 事件 ---------- */
  function bindSocket(sock) {
    sock.on('connect', function () {
      if (opts.mode === 'join' && opts.roomId) sock.emit('joinRoom', { roomId: opts.roomId });
      else if (opts.mode === 'match') sock.emit('quickMatch');
      else sock.emit('createRoom');
    });
    sock.on('roomCreated', function (d) { mySlot = d.slot; roomId = d.roomId; toastMsg('房间已创建：' + d.roomId + '（发给好友加入）'); });
    sock.on('roomJoined', function (d) { mySlot = d.slot; roomId = d.roomId; toastMsg('已加入房间 ' + d.roomId); });
    sock.on('queued', function (d) { toastMsg('匹配队列中，第 ' + d.position + ' 位…'); });
    sock.on('peerJoined', function (d) { if (d.count >= 2) toastMsg('对手已加入，即将开始！'); });
    sock.on('matchStart', function () { started = true; buildPuppets(); });
    sock.on('snapshot', function (s) { latest = s; });
    sock.on('matchEnd', function (d) { onEnd(d.scores); });
    sock.on('opponentLeft', function () { onEnd(null, '对手已离开'); });
    sock.on('errorMsg', function (d) { toastMsg('⚠ ' + d.msg, 'warn'); });
    sock.on('disconnect', function () { if (active) toastMsg('与联机服务器断开', 'error'); });
  }

  function onEnd(scores, reason) {
    started = false;
    // 结算覆盖层
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:rgba(2,4,12,.7);backdrop-filter:blur(6px)';
    var card = document.createElement('div');
    card.style.cssText = 'padding:32px 56px;border-radius:16px;background:rgba(10,16,36,.9);border:1px solid rgba(0,229,255,.45);text-align:center;font-family:system-ui;color:#e7ecf3';
    var txt = scores ? ('对战结束　' + scores[0] + ' : ' + scores[1]) : (reason || '对战结束');
    card.innerHTML = '<div style="font-size:30px;letter-spacing:.1em;color:#ffd54a">' + txt + '</div>' +
      '<div style="margin-top:18px;display:flex;gap:14px;justify-content:center">';
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'margin-top:18px;display:flex;gap:14px;justify-content:center;flex-wrap:wrap;max-width:520px';
    var back = document.createElement('button');
    back.textContent = '🏠 返回主菜单';
    back.style.cssText = 'padding:10px 22px;border-radius:8px;cursor:pointer;background:transparent;border:1px solid rgba(169,183,209,.4);color:#a9b7d1;font-size:14px';
    back.onclick = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); NS.stop(); };
    var againRoom = document.createElement('button');
    againRoom.textContent = '🎮 建房重开（可分享房间号）';
    againRoom.style.cssText = 'padding:10px 22px;border-radius:8px;cursor:pointer;background:linear-gradient(135deg,rgba(0,229,255,.22),rgba(0,229,255,.08));border:1px solid #00e5ff;color:#bff5ff;font-size:14px';
    againRoom.onclick = function () {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      // 建房重开：新开一个房间并拿到房间号，方便把房间号发给同一好友再来一局
      NS.stop(true);
      NS.start({ mode: 'create', tank: opts.tank, skin: opts.skin });
    };
    var againMatch = document.createElement('button');
    againMatch.textContent = '🔄 快速匹配再来一局';
    againMatch.style.cssText = 'padding:10px 22px;border-radius:8px;cursor:pointer;background:linear-gradient(135deg,rgba(255,213,74,.2),rgba(255,213,74,.06));border:1px solid #ffd54a;color:#ffe9a8;font-size:14px';
    againMatch.onclick = function () {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      // 快速匹配重开（复用当前 tank/skin）
      NS.stop(true);
      NS.start({ mode: 'match', tank: opts.tank, skin: opts.skin });
    };
    btnRow.appendChild(back); btnRow.appendChild(againRoom); btnRow.appendChild(againMatch);
    card.appendChild(btnRow);
    ov.appendChild(card);
    document.body.appendChild(ov);
  }

  /* ---------- 启动 / 停止 ---------- */
  NS.start = function (o) {
    opts = o || {};
    if (active) return;
    active = true; started = false; mySlot = null; latest = null; puppets = [null, null];
    var wrap = document.getElementById('main-menu-wrap');
    if (wrap) wrap.classList.add('hidden');
    var hud = document.getElementById('game-hud-wrap');
    if (hud) hud.classList.add('hidden');
    var ENG = global.CT_ENGINE;
    if (ENG && ENG.gameState) ENG.gameState = null; // 清掉上一局残留，避免其它层误渲染

    // ESC 返回主菜单
    escHandler = function (e) {
      if (!e || !e.key) return;
      var k = String(e.key).toLowerCase();
      if (k === 'escape' || k === 'esc') { e.preventDefault(); NS.stop(); }
    };
    window.addEventListener('keydown', escHandler);

    ensureSocketIo().then(function (io) {
      socket = io(netUrl());
      bindSocket(socket);
    }).catch(function (err) {
      toastMsg('联机服务未启动：请先运行 online/server.js', 'error');
      console.error('[online]', err);
      NS.stop();
    });
  };

  NS.stop = function (silent) {
    active = false; started = false;
    if (socket) { try { socket.disconnect(); } catch (e) {} socket = null; }
    if (escHandler) { window.removeEventListener('keydown', escHandler); escHandler = null; }
    puppets = [null, null]; latest = null;
    if (!silent) {
      var MENU = global.CT_UI_MENU;
      if (MENU && MENU.renderMainMenu) MENU.renderMainMenu();
    }
  };

  NS.init = function () {
    if (_registered) return;
    var ENG = global.CT_ENGINE;
    if (ENG && typeof ENG.registerUpdate === 'function') {
      ENG.registerUpdate(NS._update, 200);
      ENG.registerRender(NS._render, 'fx');
      _registered = true;
    }
  };

  // 调试钩子：供自动化测试读取内部状态（只读，不影响正常游戏逻辑）
  try {
    global.__CT_ONLINE_DEBUG = function () {
      return {
        active: active, started: started, mySlot: mySlot, roomId: roomId,
        latest: latest ? {
          tanks: latest.tanks.map(function (t) { return { x: t.x, y: t.y, hp: t.hp, alive: t.alive, angle: t.angle }; }),
          bullets: latest.bullets.length, phase: latest.phase, scores: latest.scores
        } : null
      };
    };
  } catch (e) {}

  global.CT_MODE_ONLINE = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

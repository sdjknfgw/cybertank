/* =========================================================
 * CyberTank · 联机 1v1 模式（嫁接版 · P2P 直连）
 * 命名空间: window.CT_MODE_ONLINE
 *
 * 架构（静态托管可联机，GitHub Pages 直接可用）：
 *   - 传输层：PeerJS（WebRTC DataChannel，公共信令免费、无自建服务器）
 *   - 权威模拟：跑在「建房者」浏览器里（js/modes/online-host.js，
 *     由 online/server.js 移植），房主本地直接驱动，快照 30Hz 发给对手
 *   - 双方职责：
 *       房主(guest 连入)：收对手 input → 跑模拟 → 发 snapshot/事件
 *       对手(guest)：只发 input、收 snapshot/事件并渲染
 *   - 事件与旧 socket.io 版完全同构（roomCreated/matchStart/mapInit/
 *     snapshot/sfx/roundEnd/matchEnd/opponentLeft…），渲染层零改动。
 *   - 快速匹配：约定固定大厅 PeerID，先到者占位等待，后来者直连。
 * ========================================================= */
(function (global) {
  'use strict';

  // 必须与 online-host.js 的地图尺寸一致（坐标系对齐）；mapInit 到达后会被覆盖为真实尺寸
  var ARENA = { w: 640, h: 640 };

  var NS = {};
  var active = false;       // 整个模式是否激活
  var started = false;      // 是否已进入对战（matchStart 之后）
  var mySlot = null;        // 0 或 1
  var roomId = null;
  var latest = null;        // 最近一次快照（房主=本地模拟产物，对手=网络快照）
  var puppets = [null, null]; // 两个木偶 Tank（仅用于渲染）
  var lastInputT = 0;
  var lastRect = { left: 0, top: 0 }; // 画布在屏幕上的位置，用于把鼠标换算到竞技场坐标
  var opts = {};            // { mode, roomId, tank, skin }
  var escHandler = null;
  var _registered = false;
  var mapObstacles = [];    // 本局地图障碍（来自 mapInit，brk 增量更新砖墙）
  var mapMeta = { w: 640, h: 640, tile: 32 };
  var prevBulletCount = 0;  // 用于开火音效节流
  var lastSfxT = {};        // 各类音效节流时间戳

  /* ---------- P2P 传输状态 ---------- */
  var peer = null;          // PeerJS 实例
  var conn = null;          // 与对手的 DataChannel
  var role = null;          // 'host' | 'guest'
  var sim = null;           // 房主端的权威模拟（online-host.js Sim）
  var tickTimer = null;     // 房主 30Hz 模拟定时器
  var joinWatch = null;     // 对手侧连接超时看门狗
  var profiles = [null, null]; // 双方资料 {name,rating,wins,losses}（下标=槽位：0=房主 1=对手）
  var registeredCode = null;   // 已登记到服务器的房间号（建房模式）
  var roomHeartbeat = null;    // 房间登记心跳定时器
  var pvpReported = false;     // 本局段位是否已上报（防重复）
  var ended = false;           // 本局已结算（防重复弹卡/迟到的断线事件覆盖结算）
  var hbTimer = null;          // 对战连接心跳定时器（2s 发 ping）
  var lastPeerDataT = 0;       // 最近一次收到对手数据的时刻（看门狗判离线）

  // PeerID 命名空间（公共信令服务器全局唯一，加游戏前缀防撞）
  var NS_PREFIX = 'cybertank-1v1-a1-';
  var LOBBY_PEER_ID = NS_PREFIX + 'lobby'; // 快速匹配大厅
  // STUN：含国内可达节点，提高 NAT 穿透率
  var ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
    ],
  };

  function toastMsg(m, lv) { try { global.CT_TOAST && global.CT_TOAST(m, lv || 'info'); } catch (e) {} }

  /* ---------- 我的 PvP 资料（名称 / 段位分 / 战绩），用于资料交换与房间登记 ---------- */
  function myPvpProfile() {
    var P = global.CT_PVP;
    var p = P && P.myProfile && P.myProfile();
    return {
      name: p ? p.name : '玩家001',
      rating: p ? p.rating : 1000,
      wins: p ? p.wins : 0, losses: p ? p.losses : 0,
      tank: opts.tank || 'assault', skin: opts.skin || '#00e5ff',
    };
  }
  /* 槽位 → 顶部计分/血条标签：段位emoji + 截断名（缺资料时回退 P1/P2） */
  function slotLabel(i) {
    var p = profiles[i];
    if (!p) return 'P' + (i + 1);
    var t = (global.CT_PVP && global.CT_PVP.tierOf) ? global.CT_PVP.tierOf(p.rating) : null;
    var name = String(p.name || '').slice(0, 8);
    return (t ? t.emoji + ' ' : '') + name;
  }

  /* ---------- 房间登记（建房模式）：把房间号+段位挂到服务器列表，心跳续期 ---------- */
  function startRoomRegistry(code) {
    var BE = global.CT_BACKEND;
    if (!BE || typeof BE.roomsUpsert !== 'function') return;
    registeredCode = code;
    var prof = myPvpProfile();
    BE.roomsUpsert(code, prof.rating);
    roomHeartbeat = setInterval(function () { BE.roomsUpsert(code, prof.rating); }, 6000);
  }
  function stopRoomRegistry() {
    if (roomHeartbeat) { clearInterval(roomHeartbeat); roomHeartbeat = null; }
    if (registeredCode) {
      var BE = global.CT_BACKEND;
      if (BE && typeof BE.roomsRemove === 'function') { try { BE.roomsRemove(registeredCode); } catch (e) {} }
      registeredCode = null;
    }
  }
  function peerjsUrl() { return global.CT_PEERJS_URL || 'js/lib/peerjs.min.js'; }
  function peerIdFor(code) { return NS_PREFIX + String(code).toLowerCase(); }
  function genCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var s = '';
    for (var i = 0; i < 6; i++) s += chars[(Math.random() * chars.length) | 0];
    return s;
  }

  /* 音效：复用全局 CT_AUDIO（shoot/hit/kill/explode/pickup/ui…）
   * 首屏交互已自动 resume，这里只管触发；对高频音做节流避免叠音爆音。 */
  function playSfx(type) {
    var A = global.CT_AUDIO;
    if (!A || typeof A.play !== 'function') return;
    var now = (global.performance ? performance.now() : Date.now());
    var cd = { shoot: 90, hit: 70, kill: 0, explode: 0, pickup: 0, ui: 120 }[type] || 0;
    if (cd) {
      if ((lastSfxT[type] || 0) > now - cd) return;
      lastSfxT[type] = now;
    }
    try { A.play(type); } catch (e) {}
  }

  /* ---------- 动态加载 PeerJS 客户端（自托管，静态站点可用） ---------- */
  function ensurePeerJs() {
    return new Promise(function (resolve, reject) {
      if (global.Peer) return resolve(global.Peer);
      var s = document.createElement('script');
      s.src = peerjsUrl();
      s.onload = function () { global.Peer ? resolve(global.Peer) : reject(new Error('PeerJS 加载失败')); };
      s.onerror = function () { reject(new Error('无法加载联机组件 js/lib/peerjs.min.js')); };
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
    p1.maxHp = 5; p2.maxHp = 5; // 与单人 1v1 一致：5 血
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

  /* ---------- 输入：本地键鼠 → 房主模拟 / 发给房主 ---------- */
  function sendInput() {
    if (!latest) return;
    var IN = global.CT_INPUT;
    var me = latest.tanks[mySlot];
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
    // 模拟是 directMove 语义：up/down/left/right 即世界方向，与 CT_INPUT 完全一致
    var payload = {
      up: !!(snap.up), down: !!(snap.down), left: !!(snap.left), right: !!(snap.right),
      fire: !!(snap.shoot), skill: !!(snap.skill), aim: aim
    };
    if (role === 'host' && sim) sim.setInput(0, payload);      // 房主本地直驱
    else if (role === 'guest') sendTo({ t: 'input', i: payload }); // 对手上报
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
      // 我的段位（等待期展示，玩家与观战者都能看到）
      var my = myPvpProfile();
      var myT = (global.CT_PVP && global.CT_PVP.tierOf) ? global.CT_PVP.tierOf(my.rating) : null;
      if (myT) {
        ctx.font = '15px system-ui'; ctx.fillStyle = myT.color;
        ctx.fillText(myT.emoji + ' ' + my.name + ' · ' + myT.name + ' ' + my.rating +
          ' · ' + my.wins + '胜' + my.losses + '负', W / 2, H / 2 + 34);
      }
      ctx.restore();
      drawHud(ctx, W, H);
      return;
    }

    // 1v1 地图障碍（砖/钢/草/水/冰/泥/传送门）
    renderObstacles(ctx, cam, scale);
    // 子弹（用同一相机换算）
    if (latest) {
      ctx.fillStyle = '#ffd54a';
      for (var i = 0; i < latest.bullets.length; i++) {
        var b = latest.bullets[i];
        var sx = (b.x - cam.x) * scale + cam.w / 2;
        var sy = (b.y - cam.y) * scale + cam.h / 2;
        ctx.beginPath(); ctx.arc(sx, sy, 5 * scale, 0, Math.PI * 2); ctx.fill();
      }
      // 道具（随机掉落，10s 未拾取消失）
      renderPowerups(ctx, cam, scale);
    }
    // 坦克（原版 Tank 渲染，复用全部美术）
    if (puppets[0]) puppets[0].render(ctx, cam);
    if (puppets[1]) puppets[1].render(ctx, cam);
    ctx.restore();

    drawHud(ctx, W, H);
  };

  /* 1v1 地图障碍配色（与单人 1v1 一致） */
  var OB_COLORS = {
    brick: { fill: '#8a5a3c', edge: '#5e3c27' },
    steel: { fill: '#9fb0c8', edge: '#6b7a93' },
    bush:  { fill: 'rgba(46,139,87,0.5)' },
    water: { fill: 'rgba(42,111,151,0.45)' },
    ice:   { fill: 'rgba(191,233,255,0.55)' },
    mud:   { fill: 'rgba(107,79,42,0.6)' },
    portal:{ fill: '#c86cff' },
  };
  function renderObstacles(ctx, cam, scale) {
    for (var i = 0; i < mapObstacles.length; i++) {
      var o = mapObstacles[i];
      if (!o || o.alive === false) continue;
      var x = (o.x - cam.x) * scale + cam.w / 2;
      var y = (o.y - cam.y) * scale + cam.h / 2;
      var w = o.w * scale, h = o.h * scale;
      if (o.type === 'portal') {
        ctx.save();
        ctx.strokeStyle = 'rgba(200,108,255,0.9)'; ctx.lineWidth = 2 * scale;
        ctx.shadowColor = '#c86cff'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        continue;
      }
      var c = OB_COLORS[o.type] || { fill: '#888', edge: '#555' };
      ctx.fillStyle = c.fill;
      ctx.fillRect(x, y, w, h);
      if (c.edge) {
        ctx.strokeStyle = c.edge; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
      // 砖墙受损变暗
      if (o.type === 'brick' && o.maxHp && o.hp < o.maxHp) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x, y, w, h);
      }
    }
  }

  /* 道具渲染：用 CT_POWERUP 定义表的配色 / emoji */
  function renderPowerups(ctx, cam, scale) {
    var DEF = (global.CT_POWERUP && global.CT_POWERUP.PowerupDefs) || {};
    for (var i = 0; i < latest.powerups.length; i++) {
      var p = latest.powerups[i];
      var x = (p.x - cam.x) * scale + cam.w / 2;
      var y = (p.y - cam.y) * scale + cam.h / 2;
      var def = DEF[p.id] || { color: '#ffd700', emoji: '★' };
      ctx.save();
      ctx.shadowColor = def.color || '#fff'; ctx.shadowBlur = 12;
      ctx.fillStyle = def.color || '#ffd700';
      ctx.beginPath(); ctx.arc(x, y, 14 * scale, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0b0f1a'; ctx.font = (16 * scale) + 'px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def.emoji || '★', x, y + 1);
      ctx.restore();
    }
  }

  function drawHud(ctx, W, H) {
    if (!latest) return;
    ctx.save();
    ctx.textAlign = 'center';
    /* 顶部计分：双方名称 + 段位emoji（资料未到时回退 P1/P2） */
    var n0 = slotLabel(0), n1 = slotLabel(1);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#00e5ff'; ctx.font = 'bold 17px system-ui';
    ctx.fillText(n0, W / 2 - 46, 30);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e7ecf3'; ctx.font = 'bold 22px system-ui';
    ctx.fillText(latest.scores[0] + ' : ' + latest.scores[1], W / 2, 30);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ff2a6d'; ctx.font = 'bold 17px system-ui';
    ctx.fillText(n1, W / 2 + 46, 30);
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui'; ctx.fillStyle = '#9fb0c8';
    if (latest.round != null) ctx.fillText('第 ' + latest.round + ' 局 · BO5 先到 3 胜', W / 2, 50);
    // 双方 5 格血条（标签=名称+段位）
    drawHpBar(ctx, 16, H - 28, latest.tanks[0], '#00e5ff', n0);
    drawHpBar(ctx, W - 16 - 180, H - 28, latest.tanks[1], '#ff2a6d', n1);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7c89a0'; ctx.font = '12px monospace';
    ctx.fillText('房间 ' + (roomId || '--') + (mySlot != null ? (' · 你: P' + (mySlot + 1)) : ''), 12, 22);
    ctx.textAlign = 'center';
    if (latest.phase === 'countdown') {
      if (latest.round === 1) drawVsCard(ctx, W, H); // 首局：观察对手（双方名称/段位/战绩）
      ctx.fillStyle = '#ffd54a'; ctx.font = 'bold 64px system-ui';
      ctx.fillText(Math.max(1, Math.ceil(latest.countdown)), W / 2, H / 2 + 60);
    } else if (latest.phase === 'roundEnd') {
      ctx.fillStyle = '#ffd54a'; ctx.font = 'bold 36px system-ui';
      ctx.fillText(latest.lastWinner === mySlot ? '本回合胜利！' : '本回合失利', W / 2, H / 2);
    }
    ctx.restore();
  }
  /* 首局观察卡：双方 名称/段位/积分/战绩 + VS（倒计时期间覆盖在竞技场上方） */
  function drawVsCard(ctx, W, H) {
    ctx.save();
    ctx.fillStyle = 'rgba(4,7,16,0.72)';
    ctx.fillRect(0, 0, W, H);
    var P = global.CT_PVP || {};
    function block(x, alignRight, color, prof, tag) {
      var name = prof ? String(prof.name).slice(0, 12) : '……';
      var t = prof && P.tierOf ? P.tierOf(prof.rating) : null;
      ctx.textAlign = alignRight ? 'right' : 'left';
      ctx.fillStyle = color; ctx.font = 'bold 24px system-ui';
      ctx.fillText(name + (tag || ''), x, H / 2 - 52);
      if (t) {
        ctx.fillStyle = t.color; ctx.font = 'bold 16px system-ui';
        ctx.fillText(t.emoji + ' ' + t.name + ' · ' + prof.rating + '分', x, H / 2 - 26);
        ctx.fillStyle = '#9fb0c8'; ctx.font = '13px system-ui';
        ctx.fillText('战绩 ' + (prof.wins || 0) + '胜 ' + (prof.losses || 0) + '负', x, H / 2 - 4);
      } else {
        ctx.fillStyle = '#9fb0c8'; ctx.font = '13px system-ui';
        ctx.fillText('段位资料获取中…', x, H / 2 - 20);
      }
    }
    block(W / 2 - 70, false, '#00e5ff', profiles[0], mySlot === 0 ? '（你）' : '');
    block(W / 2 + 70, true, '#ff2a6d', profiles[1], mySlot === 1 ? '（你）' : '');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd54a'; ctx.font = 'bold 44px system-ui';
    ctx.shadowColor = '#ffd54a'; ctx.shadowBlur = 18;
    ctx.fillText('VS', W / 2, H / 2 - 18);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#7c89a0'; ctx.font = '14px system-ui';
    ctx.fillText('⏱ 观察对手资料，倒计时结束后开战', W / 2, H / 2 + 92);
    ctx.restore();
  }
  function drawHpBar(ctx, x, y, tank, color, label) {
    if (!tank) return;
    var seg = 36, gap = 3, h = 12;
    ctx.save();
    ctx.fillStyle = color; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(label, x, y - 4);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, seg * 5 + gap * 4, h);
    var hp = Math.max(0, Math.min(5, tank.hp | 0));
    for (var i = 0; i < 5; i++) {
      if (i < hp) { ctx.fillStyle = color; ctx.fillRect(x + i * (seg + gap), y, seg, h); }
      else { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x + i * (seg + gap), y, seg, h); }
    }
    ctx.restore();
  }

  /* ---------- 统一事件处理（房主=本地模拟事件，对手=DataChannel 消息） ---------- */
  function handleEvent(type, d) {
    if (type === 'roomCreated') {
      mySlot = d.slot; roomId = d.roomId;
      toastMsg('房间已创建：' + d.roomId + '（发给好友加入）');
    }
    else if (type === 'roomJoined') {
      mySlot = d.slot; roomId = d.roomId;
      profiles[mySlot != null ? mySlot : 1] = myPvpProfile();   // 我的资料放进自己槽位
      sendTo({ t: 'hello', d: myPvpProfile() });                // 交换资料：名称/段位/战绩
      toastMsg('已加入房间 ' + d.roomId);
    }
    else if (type === 'queued') { toastMsg('匹配队列中，第 ' + d.position + ' 位…'); }
    else if (type === 'peerJoined') { if (d.count >= 2) toastMsg('对手已加入，即将开始！'); }
    else if (type === 'matchStart') { started = true; buildPuppets(); playSfx('ui'); }
    else if (type === 'snapshot') { applySnapshot(d); }
    else if (type === 'mapInit') {
      // 本局地图：障碍全量同步（每局重置后房主会重发）
      ARENA = { w: d.w, h: d.h };
      mapMeta = { w: d.w, h: d.h, tile: d.tile };
      mapObstacles = (d.obstacles || []).map(function (o) {
        return { type: o.type, x: o.x, y: o.y, w: o.w, h: o.h, hp: o.hp, maxHp: o.hp, alive: o.alive };
      });
    }
    else if (type === 'sfx') { playSfx(d && d.type); }
    else if (type === 'powerupPickup') { playSfx('pickup'); }
    else if (type === 'roundEnd') { playSfx('ui'); }
    else if (type === 'countdown') { playSfx('ui'); }
    else if (type === 'matchEnd') { onEnd(d.scores); }
    else if (type === 'opponentLeft') { onEnd(null, '对手已离开'); }
    else if (type === 'errorMsg') { toastMsg('⚠ ' + d.msg, 'warn'); }
  }

  function applySnapshot(s) {
    if (!s) return;
    // 砖墙增量更新（brk: 被打掉的砖墙 hp/alive 变化）
    if (s.brk && s.brk.length) {
      for (var k = 0; k < s.brk.length; k++) {
        var u = s.brk[k], o = mapObstacles[u.i];
        if (o) { o.hp = u.hp; o.alive = u.alive; }
      }
    }
    latest = s;
  }

  /* ---------- DataChannel 收发 ---------- */
  function sendTo(msg) {
    if (conn && conn.open) { try { conn.send(msg); } catch (e) {} }
  }
  function onGuestData(m) {
    if (!m || typeof m !== 'object') return;
    lastPeerDataT = Date.now();                          // 任何数据都证明连接存活
    if (m.t === 'snapshot') { applySnapshot(m.s); return; }
    if (m.t === 'hello') { profiles[0] = m.d || profiles[0]; return; } // 房主资料
    if (m.t === 'ping') return;                          // 心跳，无业务
    handleEvent(m.t, m.d || {});
  }
  function onPeerClosed() {
    if (!active || ended) return;   // 已结算后迟到的 close 事件不得覆盖/重复结算
    if (started) { handleEvent('opponentLeft', {}); }
    else if (role === 'guest') { toastMsg('连接已断开', 'error'); NS.stop(); }
  }
  /* 对战连接心跳：DataChannel 的 close 事件在对方标签页直接关闭时可能极迟甚至丢失，
   * 用应用层双向 ping + 看门狗兜底：7 秒收不到对手任何数据 → 判定对手已离开 */
  function startHeartbeat() {
    stopHeartbeat();
    lastPeerDataT = Date.now();
    hbTimer = setInterval(function () {
      sendTo({ t: 'ping' });
      if (started && lastPeerDataT && Date.now() - lastPeerDataT > 7000) onPeerClosed();
    }, 2000);
  }
  function stopHeartbeat() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }

  /* ---------- 房主：权威模拟 30Hz 循环 ---------- */
  function hostTick() {
    if (!sim || !active) return;
    sim.tick();
    var snap = sim.buildSnapshot();
    applySnapshot(snap);                 // 房主本地渲染
    sendTo({ t: 'snapshot', s: snap });  // 同步对手
    flushHostEvents();
    if (sim.phase === 'matchEnd') {      // 终局：停表（双方各自弹结算）
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    }
  }
  function flushHostEvents() {
    var evs = sim.takeEvents();
    for (var i = 0; i < evs.length; i++) {
      handleEvent(evs[i].type, evs[i].data);       // 本地生效
      sendTo({ t: evs[i].type, d: evs[i].data });  // 转发对手
    }
  }
  function beginMatchAsHost(code) {
    var HOST = global.CT_ONLINE_HOST;
    if (!HOST || !HOST.Sim) { toastMsg('模拟模块缺失', 'error'); NS.stop(); return; }
    sim = new HOST.Sim();
    sim.start(); // 产生 matchStart/mapInit/countdown 事件 → 双方同步收到
    flushHostEvents();
    tickTimer = setInterval(hostTick, 1000 / HOST.TICK_HZ);
  }

  /* ---------- 角色启动 ---------- */
  function startHost(matchMode) {
    role = 'host';
    var code = genCode();
    var wantId = matchMode ? LOBBY_PEER_ID : peerIdFor(code);
    peer = new global.Peer(wantId, { config: ICE_CONFIG });
    peer.on('open', function () {
      mySlot = 0;
      roomId = matchMode ? '匹配中' : code;
      profiles[0] = myPvpProfile();            // 房主资料占位（槽位0）
      handleEvent('roomCreated', { roomId: matchMode ? '匹配中' : code, slot: 0 });
      if (matchMode) toastMsg('快速匹配：等待对手连接…');
      else startRoomRegistry(code);            // 建房模式：登记到服务器房间列表
    });
    peer.on('connection', function (c) {
      if (conn) { try { c.close(); } catch (e) {} return; } // 只接一名对手
      conn = c;
      // 半开连接看门狗：信令请求已到但 ICE 始终未建立（15s 未 open）→ 丢弃，
      // 否则房主会永远卡在等待并拒绝后续加入者
      var openWatch = setTimeout(function () {
        if (conn === c && !started) {
          try { c.close(); } catch (e) {}
          if (conn === c) conn = null;
        }
      }, 15000);
      conn.on('open', function () {
        clearTimeout(openWatch);
        handleEvent('peerJoined', { count: 2 });
        startHeartbeat();                            // 双向 ping + 断线看门狗
        sendTo({ t: 'roomJoined', d: { roomId: matchMode ? '匹配' : code, slot: 1 } });
        sendTo({ t: 'hello', d: myPvpProfile() });  // 交换资料：名称/段位/战绩
        stopRoomRegistry();                          // 已有对手：从房间列表撤下
        beginMatchAsHost(code);
      });
      conn.on('data', function (m) {
        lastPeerDataT = Date.now();                  // 任何数据都证明连接存活
        if (m && m.t === 'ping') return;             // 心跳，无业务
        if (m && m.t === 'input' && sim) sim.setInput(1, m.i);
        else if (m && m.t === 'hello') { profiles[1] = m.d || profiles[1]; } // 对手资料（槽位1）
      });
      conn.on('close', onPeerClosed);
      conn.on('error', onPeerClosed);
    });
    peer.on('error', function (err) {
      var type = err && err.type;
      if (type === 'unavailable-id' && matchMode) {
        // 大厅位已被占 → 有人正在等待，转为对手直连
        try { peer.destroy(); } catch (e) {}
        peer = null;
        startGuest(null, true);
        return;
      }
      if (type === 'unavailable-id') {
        // 房间号极小概率撞车 → 换号重试
        try { peer.destroy(); } catch (e) {}
        peer = null;
        startHost(false);
        return;
      }
      if (type === 'peer-unavailable') { toastMsg('房间不存在，请确认房间号', 'error'); NS.stop(); return; }
      toastMsg('联机错误：' + (type || 'unknown'), 'error');
    });
    peer.on('disconnected', function () { try { peer && peer.reconnect(); } catch (e) {} });
  }

  function startGuest(roomCode, isMatch) {
    role = 'guest';
    peer = new global.Peer(undefined, { config: ICE_CONFIG }); // 随机 PeerID
    peer.on('open', function () {
      var target = isMatch ? LOBBY_PEER_ID : peerIdFor(roomCode);
      conn = peer.connect(target, { reliable: true });
      conn.on('open', startHeartbeat);               // 双向 ping + 断线看门狗
      conn.on('data', onGuestData);
      conn.on('close', onPeerClosed);
      conn.on('error', onPeerClosed);
      // 连接看门狗：20s 内未开局视为失败
      joinWatch = setTimeout(function () {
        if (!started && active) {
          toastMsg(isMatch ? '匹配超时：暂无等待中的对手，可稍后重试或改用房间号' : '连接超时：房间不存在或网络不通', 'error');
          NS.stop();
        }
      }, 20000);
    });
    peer.on('error', function (err) {
      var type = err && err.type;
      if (type === 'peer-unavailable') { toastMsg('房间不存在，请确认房间号', 'error'); NS.stop(); return; }
      toastMsg('联机错误：' + (type || 'unknown'), 'error');
    });
    peer.on('disconnected', function () { try { peer && peer.reconnect(); } catch (e) {} });
  }

  /* 段位结算上报：matchEnd=正常比分；opponentLeft=对手中途退出（判我方胜） */
  function reportPvp(scores, forfeitWin) {
    if (pvpReported || mySlot == null) return;
    pvpReported = true;
    var BE = global.CT_BACKEND;
    if (!BE || typeof BE.pvpResult !== 'function' || !BE.isLoggedIn()) return;
    var win, rw, rl;
    if (forfeitWin) { win = true; rw = 3; rl = (latest && latest.scores) ? (latest.scores[mySlot === 0 ? 1 : 0] || 0) : 0; }
    else {
      var opp = mySlot === 0 ? 1 : 0;
      win = scores[mySlot] > scores[opp];
      rw = scores[mySlot] || 0; rl = scores[opp] || 0;
    }
    BE.pvpResult(win, rw, rl).then(function (res) {
      var el = document.getElementById('ct-pvp-delta');
      if (!el) return;
      if (res && res.user) {
        var P = global.CT_PVP;
        var nt = P && P.tierOf ? P.tierOf(res.user.pvpRating) : null;
        var delta = P && P.ratingDelta ? P.ratingDelta(win, rw, rl) : 0;
        el.innerHTML = '段位 <b style="color:' + (nt ? nt.color : '#fff') + '">' +
          (nt ? nt.emoji + ' ' + nt.name : '') + ' ' + res.user.pvpRating + '分</b>' +
          ' <span style="color:' + (delta >= 0 ? '#7ef0a0' : '#ff7a9c') + '">' +
          (delta >= 0 ? '+' : '') + delta + '</span> · 总战绩 ' +
          res.user.pvpWins + '胜 ' + res.user.pvpLosses + '负';
      } else {
        el.textContent = '段位结算失败（离线或网络问题），本局未计入天梯';
      }
    });
  }

  function onEnd(scores, reason) {
    if (ended) return;        // 幂等：opponentLeft 与迟到的 matchEnd 只结算一次
    ended = true;
    started = false;
    stopRoomRegistry();
    stopHeartbeat();
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } // 立即停模拟：对手离开后不得再跑幻影回合
    if (scores) reportPvp(scores, false);
    else if (reason === '对手已离开') reportPvp(null, true); // 对手中途退出 → 判我方胜
    // 结算覆盖层
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:rgba(2,4,12,.7);backdrop-filter:blur(6px)';
    var card = document.createElement('div');
    card.style.cssText = 'padding:32px 56px;border-radius:16px;background:rgba(10,16,36,.9);border:1px solid rgba(0,229,255,.45);text-align:center;font-family:system-ui;color:#e7ecf3';
    var P = global.CT_PVP;
    function nameHtml(slot, color) {
      var p = profiles[slot];
      if (!p) return '<span style="color:' + color + '">P' + (slot + 1) + '</span>';
      var t = P && P.tierOf ? P.tierOf(p.rating) : null;
      return '<span style="color:' + color + '">' + String(p.name).slice(0, 10) + '</span>' +
        ' <span style="font-size:14px;color:' + (t ? t.color : '#9fb0c8') + '">' +
        (t ? t.emoji + t.name + ' ' + p.rating : '') + '</span>';
    }
    var head;
    if (scores) {
      var winnerName = (profiles[scores[0] > scores[1] ? 0 : 1] || {}).name || 'P' + (scores[0] > scores[1] ? 1 : 2);
      head = '<div style="font-size:26px;letter-spacing:.06em;color:#ffd54a">🏆 ' + String(winnerName).slice(0, 10) + ' 获胜</div>' +
        '<div style="font-size:20px;margin-top:8px">' + nameHtml(0, '#00e5ff') +
        ' <b style="color:#e7ecf3">' + scores[0] + ' : ' + scores[1] + '</b> ' + nameHtml(1, '#ff2a6d') + '</div>';
    } else {
      var me = profiles[mySlot != null ? mySlot : 0] || {};
      var rlFf = (latest && latest.scores) ? (latest.scores[mySlot === 0 ? 1 : 0] || 0) : 0;
      head = '<div style="font-size:26px;letter-spacing:.06em;color:#ffd54a">🏆 ' + String(me.name || 'P1').slice(0, 10) + ' 获胜（对手已离开）</div>' +
        '<div style="font-size:20px;margin-top:8px">' + nameHtml(0, '#00e5ff') +
        ' <b style="color:#e7ecf3">3 : ' + rlFf + '</b> ' + nameHtml(1, '#ff2a6d') + '</div>';
    }
    card.innerHTML = head + '<div id="ct-pvp-delta" style="margin-top:12px;font-size:15px;color:#9fb0c8">段位结算中…</div>';
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
    profiles = [null, null]; pvpReported = false; ended = false; lastPeerDataT = 0; stopRoomRegistry(); stopHeartbeat();
    var wrap = document.getElementById('main-menu-wrap');
    if (wrap) wrap.classList.add('hidden');
    var hud = document.getElementById('game-hud-wrap');
    if (hud) hud.classList.add('hidden');
    var ENG = global.CT_ENGINE;
    if (ENG && ENG.gameState) ENG.gameState = null; // 清掉上一局残留，避免其它层误渲染
    // 初始化音频（首次交互已自动 resume，这里确保节点图就绪）
    try { if (global.CT_AUDIO && global.CT_AUDIO.init) global.CT_AUDIO.init(); } catch (e) {}

    // ESC 返回主菜单
    escHandler = function (e) {
      if (!e || !e.key) return;
      var k = String(e.key).toLowerCase();
      if (k === 'escape' || k === 'esc') { e.preventDefault(); NS.stop(); }
    };
    window.addEventListener('keydown', escHandler);

    ensurePeerJs().then(function () {
      if (!active) return; // 期间已被停止
      if (opts.mode === 'join' && opts.roomId) startGuest(String(opts.roomId).toUpperCase(), false);
      else if (opts.mode === 'match') startHost(true);
      else startHost(false);
    }).catch(function (err) {
      toastMsg('联机组件加载失败：' + (err && err.message || err), 'error');
      console.error('[online]', err);
      NS.stop();
    });
  };

  NS.stop = function (silent) {
    active = false; started = false;
    stopRoomRegistry();                    // 撤下服务器房间列表
    stopHeartbeat();                       // 停对战心跳看门狗
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (joinWatch) { clearTimeout(joinWatch); joinWatch = null; }
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    sim = null; role = null;
    if (escHandler) { window.removeEventListener('keydown', escHandler); escHandler = null; }
    puppets = [null, null]; latest = null; profiles = [null, null];
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
        active: active, started: started, mySlot: mySlot, roomId: roomId, role: role,
        phase: sim ? sim.phase : (latest ? latest.phase : null),
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

/* ============================================================
 *  CYBERTANK · 准备阶段系统 (Task 8)
 *  命名空间: window.CT_PREP
 *  职责：倒计时 + 金币结算 + 商店刷新解锁 + 移动限制墙 + combatLocked
 *  纯逻辑层（不直接操作 DOM），与 shop-ui / prep-ui 通过 CT_BUS 联动
 *  依赖（全部可选，容错降级）：
 *    - window.CT_BUS / EventBus
 *    - window.CT_ENGINE (registerUpdate / unregisterUpdate / setState / gameState)
 *    - window.CT_SHOP (unlock / refreshStock / setDiscount / lock)
 *    - window.CT_WAVEMAN (getEnemyCountReport / current)
 *    - window.CT_INPUT (players)
 *    - window.CT_OBSTACLE (WallBrick —— 作为隐形墙构造器 fallback)
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 外部依赖安全兜底 ----------
  const BUS = (function () {
    const b = window.CT_BUS || window.EventBus;
    if (b && typeof b.on === 'function' && typeof b.emit === 'function') return b;
    const stub = {
      _l: Object.create(null),
      on: function (e, fn) { (this._l[e] = this._l[e] || []).push(fn); },
      emit: function (e, p) {
        const arr = this._l[e] || [];
        for (let i = 0; i < arr.length; i++) try { arr[i](p); } catch (_) {}
      },
      off: function (e, fn) {
        const arr = this._l[e]; if (!arr) return;
        const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1);
      }
    };
    return stub;
  })();
  const ENG = window.CT_ENGINE || null;
  const SHOP = window.CT_SHOP || null;
  const WAVE = window.CT_WAVEMAN || null;
  const INP = window.CT_INPUT || null;
  const OB = window.CT_OBSTACLE || null;

  /* ---------- 模式默认时长 ---------- */
  const DEFAULT_SECONDS = {
    horde: 30,
    endless: 30,
    'king-hill': 20,
    'battle-royale': 30,
    duel: 15
  };

  /* ---------- 兼容 modes 常量 ---------- */
  const SOLO_MODES = { horde: 1, endless: 1, 'battle-royale': 1, 'king-hill': 1 };

  /* 模式别名归一：部分模式文件传入无连字符的 id（如 king-hill.js 传 'kinghill'），
   * 若不归一化，DEFAULT_SECONDS / SOLO_MODES / 商店白名单会全部查不到而静默降级。 */
  function normMode(m) {
    if (m === 'kinghill') return 'king-hill';
    if (m === 'battleroyale' || m === 'royale' || m === 'br') return 'battle-royale';
    return m;
  }

  /* ============================================================
   *  隐形墙构造器（优先复用 CT_OBSTACLE.WallBrick，否则返回兼容 AABB 对象）
   * ============================================================ */
  function makeWall(opts) {
    try {
      if (OB && typeof OB.WallSteel === 'function') {
        // 使用钢墙：无限血量 + 阻挡坦克/子弹
        const w = new OB.WallSteel(opts);
        w._isPrepLimit = true;
        return w;
      }
      if (OB && typeof OB.WallBrick === 'function') {
        const w = new OB.WallBrick(opts);
        w.hp = Infinity;
        w._isPrepLimit = true;
        return w;
      }
    } catch (_) {}
    // fallback：轻量 AABB 对象，alive 供碰撞检测
    return {
      type: 'prep_limit_wall',
      alive: true,
      hp: Infinity,
      blockTank: true,
      blockBullet: true,
      traction: 1,
      _isPrepLimit: true,
      aabb: { x: opts.x || 0, y: opts.y || 0, w: opts.w || 20, h: opts.h || 20 },
      _box: { x: opts.x || 0, y: opts.y || 0, w: opts.w || 20, h: opts.h || 20 },
      update: function () {},
      render: function () {}
    };
  }

  /* ============================================================
   *  CT_PREP 主对象
   * ============================================================ */
  const CT_PREP = {
    /** @type {'idle'|'running'|'ending'} */
    state: 'idle',
    secondsRemaining: 0,
    duration: 30,
    isBossWave: false,
    /** 1v1 模式双玩家 ready 标记 */
    playersReady: new Set(),
    /** 移动限制墙引用数组 */
    moveLimitWalls: [],
    /** ENGINE 每帧更新回调（便于 unregister） */
    tickCallback: null,
    /** 倒计时到 0 的开战回调 */
    onCombatStart: null,
    /** 启动时记录当前模式（给 markReady 判定） */
    mode: 'horde',

    /* ==========================================================
     *  启动准备期
     * ========================================================== */
    start: function (opts) {
      opts = opts || {};
      const rawSeconds = typeof opts.seconds === 'number' ? opts.seconds : NaN;
      const mode = normMode(opts.mode || 'horde');
      const seconds = Number.isFinite(rawSeconds)
        ? Math.max(3, Math.floor(rawSeconds))
        : (DEFAULT_SECONDS[mode] || 30);
      const isBoss = !!opts.isBoss;
      const players = Array.isArray(opts.players) ? opts.players.slice() : [];
      const mapInfo = opts.mapInfo || { w: 2400, h: 1600, tile: 64, spawnPoints: [] };
      const onCombatStart = typeof opts.onCombatStart === 'function' ? opts.onCombatStart : null;

      // 已运行先关闭（防重入）
      try { if (this.state !== 'idle') this.cancel(true); } catch (_) {}

      /* 商店在无尽模式（horde/endless）与据点争夺（king-hill）开放，其余模式跳过刷新/解锁/UI。
       * 据点争夺每小节之间有购买间隔，因此与无尽模式一样需要商店。 */
      const shopAllowed = (mode === 'horde' || mode === 'endless' || mode === 'king-hill');
      this.shopAllowed = shopAllowed;

      this.state = 'running';
      this.mode = mode;
      this.duration = seconds;
      this.secondsRemaining = seconds;
      this.isBossWave = isBoss;
      this.onCombatStart = onCombatStart;
      this.playersReady.clear();
      this.moveLimitWalls = [];

      // ---------- 1. 金币结算 ----------
      try {
        const wave = (WAVE && typeof WAVE.current === 'number') ? WAVE.current : 0;
        BUS.emit('prep:settleCoins', {
          players: players,
          mode: mode,
          wave: wave,
          isBoss: isBoss
        });
        // 内置兜底：给所有玩家发波次金币（无尽公式 30 × wave）
        if (players.length && wave > 0) {
          for (let i = 0; i < players.length; i++) {
            const p = players[i]; if (!p) continue;
            try {
              const mul = (p.muls && typeof p.muls.coinGain === 'number') ? p.muls.coinGain : 1;
              let gain = Math.round(30 * wave * mul);
              if (mode === 'rank' || mode === 'king-hill') gain = Math.round(gain * 1.2);
              p.coins = (p.coins || 0) + gain;
              BUS.emit('shop:coinsGained', {
                target: p, coins: gain, reason: 'prep_wave_start', wave: wave
              });
            } catch (_) {}
          }
        }
      } catch (e) { /* 金币结算异常不阻断准备期 */ }

      // ---------- 2. 刷新商店 + 解锁 + 连波折扣（仅无尽模式） ----------
      try {
        const stockSize = isBoss ? 16 : 12;
        if (SHOP) {
          if (!shopAllowed) {
            // 非无尽模式：保持锁定，不出现在商店入口
            if (typeof SHOP.lock === 'function') SHOP.lock();
          } else {
            if (typeof SHOP.unlock === 'function') SHOP.unlock();
            if (typeof SHOP.refreshStock === 'function') SHOP.refreshStock(isBoss, stockSize);
            if (typeof SHOP.resetRefreshCost === 'function') SHOP.resetRefreshCost();
            if (typeof SHOP.setDiscount === 'function') {
              SHOP.setDiscount(this._calcDiscountForStreak(players[0] || null));
            }
          }
        }
      } catch (e) { /* shop 异常容错 */ }

      // ---------- 3. 创建移动限制墙 ----------
      try {
        this._createMoveLimitWalls(mapInfo, players);
      } catch (e) { /* 墙创建失败，玩家自由活动也可接受 */ }

      // ---------- 4. 禁止玩家射击/技能（combatLocked 标记由 Tank.update 读取） ----------
      try {
        for (let i = 0; i < players.length; i++) {
          const p = players[i]; if (!p) continue;
          if (!p.flags) p.flags = {};
          p.flags.combatLocked = true;
        }
        // 兼容 CT_INPUT.players
        if (INP && Array.isArray(INP.players)) {
          for (let i = 0; i < INP.players.length; i++) {
            const p = INP.players[i];
            if (p && !p.flags) p.flags = {};
            if (p && p.flags) p.flags.combatLocked = true;
          }
        }
      } catch (_) {}

      // ---------- 5. 打开 UI 面板（shop-ui + prep-ui） ----------
      try {
        const report = (WAVE && typeof WAVE.getEnemyCountReport === 'function')
          ? WAVE.getEnemyCountReport()
          : { normal: 0, fast: 0, elite: 0, isBoss: isBoss, bossName: '', bossSkills: [] };
        const spawnPts = (mapInfo && Array.isArray(mapInfo.spawnPoints)) ? mapInfo.spawnPoints : [];
        const firstPlayer = players[0] || null;

        // 商店 UI 仅无尽模式 / 据点争夺弹出；其他模式只有备战倒计时面板
        if (shopAllowed) {
          BUS.emit('ui:showShop', {
            duration: seconds,
            isBoss: isBoss,
            player: firstPlayer,
            enemyReport: report,
            spawnPoints: spawnPts,
            onRequestReady: function () { CT_PREP.markReady('player'); }
          });
        }

        BUS.emit('ui:showPrepPanel', {
          seconds: seconds,
          isBoss: isBoss,
          mode: mode,
          enemyReport: report,
          spawnPoints: spawnPts,
          wave: (WAVE && typeof WAVE.current === 'number') ? WAVE.current : 0,
          discount: SHOP && typeof SHOP.discount === 'number' ? SHOP.discount : 1.0
        });
      } catch (_) {}

      // ---------- 6. 倒计时 tick ----------
      try { this._registerTick(); } catch (_) {}

      // ENGINE 状态切换（可选）
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('PREPARING'); } catch (_) {}

      BUS.emit('prep:start', {
        seconds: seconds, isBoss: isBoss, mode: mode,
        duration: seconds,
        wave: (WAVE && typeof WAVE.current === 'number') ? WAVE.current : 0
      });
    },

    /* ==========================================================
     *  注册每秒 tick
     * ========================================================== */
    _registerTick: function () {
      const self = this;
      if (ENG && typeof ENG.unregisterUpdate === 'function' && self.tickCallback) {
        try { ENG.unregisterUpdate(self.tickCallback); } catch (_) {}
      }
      let acc = 0;
      self.tickCallback = function (dt) {
        if (self.state !== 'running') return;
        // dt 单位约定：engine.js 多数使用秒，这里兼容毫秒
        const d = (typeof dt === 'number' && dt > 50) ? dt : (dt * 1000);
        acc += d;
        while (acc >= 1000 && self.state === 'running') {
          acc -= 1000;
          self._tickOneSecond();
        }
      };
      if (ENG && typeof ENG.registerUpdate === 'function') {
        ENG.registerUpdate(self.tickCallback, 200);
      } else {
        // fallback：setInterval
        self._fallbackTimer = setInterval(function () {
          if (self.state !== 'running') { clearInterval(self._fallbackTimer); self._fallbackTimer = null; return; }
          self._tickOneSecond();
        }, 1000);
      }
    },

    /* ==========================================================
     *  每秒执行一次
     * ========================================================== */
    _tickOneSecond: function () {
      const self = this;
      if (self.state !== 'running') return;
      self.secondsRemaining -= 1;
      BUS.emit('prep:tick', self.secondsRemaining);

      /* 最后 3 秒：中央大字倒计时（下一波即将开始）
       * 注意：本 IIFE 无 global 参数（浏览器无全局 global 变量），
       * 此前写 global.CT_WAVE_BANNER 会抛 ReferenceError 被 catch 静默吞掉 → 必须用 window */
      if (self.secondsRemaining > 0 && self.secondsRemaining <= 3) {
        try {
          window.CT_WAVE_BANNER && window.CT_WAVE_BANNER.show(
            String(self.secondsRemaining),
            '下一波即将开始 · NEXT WAVE',
            900
          );
        } catch (_) {}
      }
      if (self.secondsRemaining === 3) {
        // 提前 3 秒锁定商店
        try { if (SHOP && typeof SHOP.lock === 'function') SHOP.lock(); } catch (_) {}
        BUS.emit('ui:shopLocked');
      }
      if (self.secondsRemaining <= 0) {
        self._endAndStartCombat();
      }
    },

    /* ==========================================================
     *  玩家点击「准备完毕」
     * ========================================================== */
    markReady: function (playerId) {
      const self = this;
      if (self.state !== 'running') return;
      const id = playerId || 'player';
      const mode = self.mode;

      // 单人模式：剩余 >5s 时立即加速倒计时到 5s
      if (SOLO_MODES[mode]) {
        if (self.secondsRemaining > 5) {
          self.secondsRemaining = 5;
          BUS.emit('prep:tick', self.secondsRemaining);
          BUS.emit('prep:ready', { accelerated: true, playerId: id, secondsRemaining: 5 });
        } else {
          BUS.emit('prep:ready', { accelerated: false, playerId: id, secondsRemaining: self.secondsRemaining });
        }
        return;
      }
      // 1v1：双方都点 ready → 立即开始
      if (mode === 'duel') {
        self.playersReady.add(id);
        BUS.emit('prep:ready', {
          accelerated: false, duel: true, playerId: id,
          readyCount: self.playersReady.size
        });
        if (self.playersReady.size >= 2) {
          self.secondsRemaining = 0;
        }
        return;
      }
      // 其他模式：只广播，不做倒计时修改
      BUS.emit('prep:ready', { accelerated: false, playerId: id });
    },

    /* ==========================================================
     *  结束准备期，进入战斗
     * ========================================================== */
    _endAndStartCombat: function () {
      const self = this;
      if (self.state !== 'running') return;
      self.state = 'ending';

      // 关闭 UI
      try {
        const SHOP_UI = window.CT_UI_SHOP;
        if (SHOP_UI && typeof SHOP_UI.close === 'function') SHOP_UI.close();
      } catch (_) {}
      BUS.emit('ui:hidePrepPanel');
      BUS.emit('ui:shopClose');

      // 移除限制墙
      try { self._removeMoveLimitWalls(); } catch (_) {}

      // 解锁战斗：combatLocked 清除
      try {
        if (INP && Array.isArray(INP.players)) {
          for (let i = 0; i < INP.players.length; i++) {
            const p = INP.players[i];
            if (p && p.flags && p.flags.combatLocked) delete p.flags.combatLocked;
          }
        }
        const gs = ENG && ENG.gameState;
        const tanks = (gs && Array.isArray(gs.tanks)) ? gs.tanks : [];
        for (let i = 0; i < tanks.length; i++) {
          const t = tanks[i];
          if (t && t.flags && t.flags.combatLocked) delete t.flags.combatLocked;
        }
      } catch (_) {}

      // ENGINE 状态切换（可选）
      try { if (ENG && typeof ENG.setState === 'function') ENG.setState('COMBAT'); } catch (_) {}

      // 解除 tick 回调注册
      try {
        if (self.tickCallback && ENG && typeof ENG.unregisterUpdate === 'function') {
          ENG.unregisterUpdate(self.tickCallback);
        }
        self.tickCallback = null;
        if (self._fallbackTimer) { clearInterval(self._fallbackTimer); self._fallbackTimer = null; }
      } catch (_) {}

      BUS.emit('prep:combatStart', { isBoss: self.isBossWave });
      const cb = self.onCombatStart;
      self.onCombatStart = null;
      if (typeof cb === 'function') { try { cb(); } catch (_) {} }

      self.state = 'idle';
    },

    /* ==========================================================
     *  增益选择之后重新开始下一准备期（流程衔接）
     * ========================================================== */
    afterBuffSelectionRestart: function (nextOptions) {
      const self = this;
      setTimeout(function () {
        try { self.start(nextOptions); } catch (e) {
          console.warn('[CT_PREP] afterBuffSelectionRestart failed:', e);
        }
      }, 100);
    },

    /* ==========================================================
     *  连波折扣：无阵亡波次 → 折扣
     *  3 波 = 8 折，5 波 = 7 折，8 波 = 5 折
     * ========================================================== */
    _calcDiscountForStreak: function (player) {
      let streak = 0;
      try {
        const gs = ENG && ENG.gameState;
        if (gs && typeof gs.noDeathStreak === 'number') streak = gs.noDeathStreak;
        if (player && player.flags && typeof player.flags.noDeathStreak === 'number') {
          streak = Math.max(streak, player.flags.noDeathStreak);
        }
      } catch (_) {}
      if (streak >= 8) return 0.5;
      if (streak >= 5) return 0.7;
      if (streak >= 3) return 0.8;
      return 1.0;
    },

    /* ==========================================================
     *  限制移动用的碰撞墙：出生点外围 4 面「隐形墙」
     * ========================================================== */
    _createMoveLimitWalls: function (mapInfo, players) {
      const self = this;
      mapInfo = mapInfo || { w: 2400, h: 1600 };
      const mw = typeof mapInfo.w === 'number' ? mapInfo.w : 2400;
      const mh = typeof mapInfo.h === 'number' ? mapInfo.h : 1600;
      const firstPlayer = Array.isArray(players) ? players[0] : null;
      const spawnPos = (firstPlayer && firstPlayer.spawnPos) ? firstPlayer.spawnPos : null;
      const cx = (spawnPos && typeof spawnPos.x === 'number') ? spawnPos.x : (mw / 2);
      const cy = (spawnPos && typeof spawnPos.y === 'number') ? spawnPos.y : (mh / 2);

      // 以出生点为中心的方形：边长 = min(mw,mh) * 0.5
      const halfLen = Math.max(200, Math.min(mw, mh) * 0.25);
      const thick = 20;

      // 左边界 / 右边界 / 上边界 / 下边界
      const leftX   = cx - halfLen - thick / 2;
      const rightX  = cx + halfLen - thick / 2;
      const topY    = cy - halfLen - thick / 2;
      const bottomY = cy + halfLen - thick / 2;
      const segLen  = halfLen * 2 + thick;

      // 上 / 下（横向墙）
      self.moveLimitWalls.push(makeWall({ x: leftX,   y: topY,    w: segLen, h: thick }));
      self.moveLimitWalls.push(makeWall({ x: leftX,   y: bottomY, w: segLen, h: thick }));
      // 左 / 右（纵向墙）
      self.moveLimitWalls.push(makeWall({ x: leftX,   y: topY,    w: thick,  h: segLen }));
      self.moveLimitWalls.push(makeWall({ x: rightX,  y: topY,    w: thick,  h: segLen }));

      // 注入 obstacles 数组
      try {
        const gs = ENG && ENG.gameState;
        if (gs && Array.isArray(gs.obstacles)) {
          for (let i = 0; i < self.moveLimitWalls.length; i++) {
            gs.obstacles.push(self.moveLimitWalls[i]);
          }
        }
      } catch (_) {}
    },

    /* ==========================================================
     *  移除移动限制墙
     * ========================================================== */
    _removeMoveLimitWalls: function () {
      const self = this;
      try {
        const gs = ENG && ENG.gameState;
        if (gs && Array.isArray(gs.obstacles) && self.moveLimitWalls.length) {
          const set = new Set(self.moveLimitWalls);
          gs.obstacles = gs.obstacles.filter(function (o) { return !set.has(o); });
        }
      } catch (_) {}
      self.moveLimitWalls = [];
    },

    /* ==========================================================
     *  外部调用：中止准备期（离开游戏 / 重置等场景）
     * ========================================================== */
    cancel: function (silent) {
      const self = this;
      try {
        if (self.tickCallback && ENG && typeof ENG.unregisterUpdate === 'function') {
          ENG.unregisterUpdate(self.tickCallback);
        }
        self.tickCallback = null;
        if (self._fallbackTimer) { clearInterval(self._fallbackTimer); self._fallbackTimer = null; }
      } catch (_) {}
      try { self._removeMoveLimitWalls(); } catch (_) {}
      self.state = 'idle';
      self.playersReady.clear();
      self.onCombatStart = null;
      if (!silent) BUS.emit('prep:canceled');
    }
  };

  /* ============================================================
   *  导出全局
   * ============================================================ */
  window.CT_PREP = CT_PREP;
})();

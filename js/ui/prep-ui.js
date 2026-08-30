/* ============================================================
 *  CYBERTANK · 准备阶段 UI（纯视觉，不含业务逻辑）
 *  命名空间: window.CT_UI_PREP
 *  DOM 根节点: #prep-ui-root（z-35，低于 shop z-50，覆盖在 hud 上方但不覆盖商店）
 *  监听：
 *    - ui:showPrepPanel → 构建 HUD（顶栏倒计时 + 左敌情预告 + 底部准备完毕按钮）
 *    - prep:tick       → 更新倒计时数字
 *    - ui:shopLocked   → 倒计时红闪 + 商店遮罩灰层
 *    - prep:ready      → 倒计时绿色跳变 flash（20→5 加速动画）
 *  发送：
 *    - prep-ui:ready  → 外部 CT_PREP.markReady()
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 依赖兜底 ----------
  const BUS = (function () {
    const b = window.CT_BUS || window.EventBus;
    if (b && typeof b.on === 'function' && typeof b.emit === 'function') return b;
    const stub = {
      _l: Object.create(null),
      on: function (e, fn) { (this._l[e] = this._l[e] || []).push(fn); },
      emit: function (e, p) {
        const arr = this._l[e] || [];
        for (let i = 0; i < arr.length; i++) try { arr[i](p); } catch (_) {}
      }
    };
    return stub;
  })();

  /* ---------- 模式图标 ---------- */
  const MODE_ICONS = {
    horde: '👹', endless: '♾️',
    'king-hill': '🏰', 'battle-royale': '💀', duel: '⚔️', kingdefend: '🛡'
  };
  const MODE_LABELS = {
    horde: 'HORDE', endless: 'ENDLESS',
    'king-hill': 'KING HILL', 'battle-royale': 'BATTLE ROYALE', duel: '1v1 DUEL', kingdefend: 'KING DEFEND'
  };

  /* ---------- 敌人类型配色 ---------- */
  const ENEMY_META = {
    normal: { label: 'NORMAL',  dot: '#7fa8d9', glow: '0 0 8px #7fa8d9' },
    fast:   { label: 'FAST',    dot: '#39ff14', glow: '0 0 10px #39ff14' },
    elite:  { label: 'ELITE',   dot: '#ff4da6', glow: '0 0 12px #ff4da6' }
  };

  /* ---------- 状态 ---------- */
  const state = {
    root: null,
    secondsEl: null,
    topLabelEl: null,
    reportWrap: null,
    btnReady: null,
    shopMaskEl: null,
    currentSeconds: 0,
    currentPayload: null,
    boundReady: null
  };

  /* ---------- DOM 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, html) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        if (k === 'class') n.className = attrs[k];
        else if (k === 'style' && typeof attrs[k] === 'object') {
          for (const sk in attrs[k]) {
            if (Object.prototype.hasOwnProperty.call(attrs[k], sk)) {
              try { n.style[sk] = attrs[k][sk]; } catch (_) {}
            }
          }
        } else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (k === 'dataset') {
          for (const dk in attrs[k]) {
            if (Object.prototype.hasOwnProperty.call(attrs[k], dk)) n.dataset[dk] = attrs[k][dk];
          }
        } else if (k in n) {
          try { n[k] = attrs[k]; } catch (_) { n.setAttribute(k, attrs[k]); }
        } else {
          n.setAttribute(k, attrs[k]);
        }
      }
    }
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ============================================================
   *  注入样式（避免依赖外部 CSS 缺失）
   * ============================================================ */
  function ensureStyles() {
    try {
      if (document.getElementById('ct-prep-ui-style')) return;
      const css = [
        '#prep-ui-root{position:fixed;inset:0;z-index:35;display:none;pointer-events:none;}',
        '#prep-ui-root.visible{display:flex;flex-direction:column;}',
        '.ct-prep-top{',
        '  display:flex;align-items:center;justify-content:space-between;',
        '  padding:14px 22px;pointer-events:none;',
        '  background:linear-gradient(180deg,rgba(5,10,20,0.78) 0%,rgba(5,10,20,0.35) 60%,transparent 100%);',
        '  border-bottom:1px solid rgba(0,240,255,0.25);',
        '  backdrop-filter:blur(4px);',
        '}',
        '.ct-prep-mode-chip{',
        '  display:flex;align-items:center;gap:10px;padding:8px 14px;',
        '  border:1px solid rgba(0,240,255,0.45);border-radius:10px;',
        '  background:rgba(0,240,255,0.08);color:#e8fbff;',
        '  font-family:"Share Tech Mono",monospace;letter-spacing:1.5px;',
        '  box-shadow:0 0 16px rgba(0,240,255,0.15) inset;',
        '}',
        '.ct-prep-mode-icon{font-size:22px;filter:drop-shadow(0 0 4px #00f0ff);}',
        '.ct-prep-wave{',
        '  padding:6px 14px;border-left:3px solid #00f0ff;',
        '  font-family:"Share Tech Mono",monospace;color:#9fe8ff;letter-spacing:2px;',
        '}',
        '.ct-prep-wave b{color:#00f0ff;font-size:20px;margin:0 4px;}',
        '.ct-prep-timer-wrap{',
        '  text-align:center;min-width:260px;',
        '}',
        '.ct-prep-timer-label{font-family:"Share Tech Mono",monospace;color:#8fb9c8;letter-spacing:4px;font-size:12px;margin-bottom:2px;}',
        '.ct-prep-timer-seconds{',
        '  font-family:"Share Tech Mono",monospace;font-weight:800;font-size:54px;line-height:1;',
        '  color:#ffffff;text-shadow:0 0 12px #00f0ff,0 0 2px #fff;',
        '  letter-spacing:4px;transition:color .2s,text-shadow .2s,transform .25s;',
        '}',
        '.ct-prep-timer-seconds.flash-red{',
        '  color:#ff2a6d !important;text-shadow:0 0 18px #ff2a6d,0 0 4px #fff !important;',
        '  animation:ctPrepRedFlash 0.9s ease-in-out infinite;',
        '}',
        '.ct-prep-timer-seconds.flash-green{',
        '  color:#39ff14 !important;text-shadow:0 0 22px #39ff14,0 0 4px #fff !important;',
        '  animation:ctPrepGreenJump 0.7s cubic-bezier(0.34,1.56,0.64,1) both;',
        '}',
        '@keyframes ctPrepRedFlash{',
        '  0%,100%{transform:scale(1);opacity:1;}',
        '  50%{transform:scale(1.08);opacity:0.82;}',
        '}',
        '@keyframes ctPrepGreenJump{',
        '  0%{transform:scale(0.6);opacity:0;}',
        '  55%{transform:scale(1.22);opacity:1;}',
        '  100%{transform:scale(1);opacity:1;}',
        '}',

        /* 左栏敌情预告 */
        '.ct-prep-left{',
        '  position:absolute;top:110px;left:22px;width:300px;pointer-events:none;',
        '  padding:14px 14px 14px 0;',
        '}',
        '.ct-prep-report-title{',
        '  display:flex;align-items:center;gap:10px;padding:6px 0 10px 14px;',
        '  border-left:3px solid #00f0ff;',
        '  font-family:"Share Tech Mono",monospace;letter-spacing:2px;color:#7fe5ff;font-size:13px;',
        '  margin-bottom:10px;',
        '}',
        '.ct-prep-report-title::before{',
        '  content:"";width:8px;height:8px;background:#00f0ff;',
        '  box-shadow:0 0 10px #00f0ff;animation:ctPrepBlink 1.1s ease-in-out infinite;',
        '}',
        '@keyframes ctPrepBlink{0%,100%{opacity:1}50%{opacity:0.2}}',
        '.ct-prep-enemy-row{',
        '  display:flex;align-items:center;justify-content:space-between;',
        '  padding:7px 10px 7px 14px;margin:4px 0;',
        '  background:rgba(10,20,35,0.55);border-radius:6px;',
        '  border:1px solid rgba(127,229,255,0.15);',
        '  backdrop-filter:blur(2px);',
        '}',
        '.ct-prep-enemy-left{display:flex;align-items:center;gap:10px;}',
        '.ct-prep-enemy-dot{',
        '  width:10px;height:10px;border-radius:50%;',
        '}',
        '.ct-prep-enemy-name{',
        '  font-family:"Share Tech Mono",monospace;letter-spacing:1.5px;color:#b9d9e8;font-size:12px;',
        '}',
        '.ct-prep-enemy-count{',
        '  font-family:"JetBrains Mono",monospace;font-weight:800;font-size:18px;',
        '  color:#ffd54f;letter-spacing:1px;',
        '  text-shadow:0 0 6px #ffb300,0 0 2px #fff;',
        '}',
        /* BOSS 卡片 */
        '.ct-prep-boss-card{',
        '  margin-top:10px;padding:12px;border-radius:8px;',
        '  background:linear-gradient(135deg,rgba(191,0,255,0.15),rgba(255,42,109,0.12));',
        '  border:1px solid rgba(255,42,109,0.45);',
        '  box-shadow:0 0 20px rgba(255,42,109,0.2);',
        '}',
        '.ct-prep-boss-head{display:flex;align-items:center;gap:12px;}',
        '.ct-prep-boss-avatar{',
        '  font-size:44px;width:64px;height:64px;display:flex;align-items:center;justify-content:center;',
        '  border-radius:10px;background:rgba(0,0,0,0.4);',
        '  filter:drop-shadow(0 0 10px #ff2a6d) drop-shadow(0 0 20px #bf00ff);',
        '  animation:ctPrepBossPulse 1.8s ease-in-out infinite;',
        '}',
        '@keyframes ctPrepBossPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}',
        '.ct-prep-boss-name{',
        '  font-family:"JetBrains Mono",monospace;font-weight:800;font-size:20px;',
        '  color:#ffd1dc;letter-spacing:1px;',
        '  text-shadow:0 0 10px #ff2a6d;',
        '}',
        '.ct-prep-boss-tag{',
        '  display:inline-block;margin-top:4px;padding:2px 8px;border-radius:4px;',
        '  background:rgba(255,42,109,0.25);border:1px solid rgba(255,42,109,0.6);',
        '  font-family:"Share Tech Mono",monospace;font-size:11px;letter-spacing:2px;color:#ff9cbf;',
        '}',
        '.ct-prep-boss-skills{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;}',
        '.ct-prep-boss-skill{',
        '  display:flex;align-items:center;gap:6px;padding:4px 9px;border-radius:5px;',
        '  background:rgba(191,0,255,0.2);border:1px solid rgba(191,0,255,0.5);',
        '  font-family:"Share Tech Mono",monospace;font-size:11px;letter-spacing:1px;color:#f0c5ff;',
        '}',

        /* 底部按钮 */
        '.ct-prep-bottom{',
        '  position:absolute;left:0;right:0;bottom:26px;display:flex;justify-content:center;pointer-events:auto;',
        '}',
        '.ct-prep-ready-btn{',
        '  position:relative;display:inline-flex;align-items:center;gap:12px;',
        '  padding:16px 48px;border-radius:12px;cursor:pointer;user-select:none;',
        '  font-family:"Share Tech Mono",monospace;font-weight:800;font-size:20px;letter-spacing:4px;',
        '  color:#032225;background:linear-gradient(135deg,#00f0ff 0%,#00d4aa 100%);',
        '  border:1px solid #66fff8;',
        '  box-shadow:0 0 28px rgba(0,240,255,0.75),0 0 60px rgba(0,240,255,0.35),0 0 4px #fff inset;',
        '  transition:transform .15s ease,box-shadow .15s ease,filter .15s ease;',
        '  overflow:hidden;',
        '}',
        '.ct-prep-ready-btn:hover{transform:translateY(-2px) scale(1.02);filter:brightness(1.12);}',
        '.ct-prep-ready-btn:active{transform:translateY(0) scale(0.98);}',
        '.ct-prep-ready-btn::after{',
        '  content:"";position:absolute;top:0;left:-120%;width:60%;height:100%;',
        '  background:linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent);',
        '  transform:skewX(-20deg);animation:ctPrepShine 2.2s linear infinite;',
        '}',
        '@keyframes ctPrepShine{0%{left:-120%}100%{left:220%}}',
        '.ct-prep-ready-btn[disabled]{',
        '  background:linear-gradient(135deg,#445 0%,#334 100%);color:#8ab;',
        '  box-shadow:none;border-color:#556;cursor:not-allowed;',
        '}',
        '.ct-prep-ready-btn[disabled]::after{display:none;}',
        '.ct-prep-ready-btn .icon{font-size:24px;}',

        /* 商店遮罩灰层 */
        '.ct-shop-mask{',
        '  position:fixed;inset:0;z-index:49;display:none;',
        '  background:rgba(20,10,25,0.55);backdrop-filter:grayscale(0.5) blur(1px);',
        '  pointer-events:auto;',
        '}',
        '.ct-shop-mask.visible{display:block;animation:ctPrepFadeIn 0.3s ease-out both;}',
        '.ct-shop-mask-text{',
        '  position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
        '  padding:20px 40px;border:1px solid #ff2a6d;border-radius:10px;',
        '  background:rgba(10,5,15,0.8);',
        '  font-family:"Share Tech Mono",monospace;letter-spacing:4px;color:#ff9cbf;font-size:18px;',
        '  text-shadow:0 0 8px #ff2a6d;',
        '  box-shadow:0 0 30px rgba(255,42,109,0.4);',
        /* 专用 keyframes：保留 translate(-50%,-50%)。共用 ctPrepRedFlash 会被其
         * transform:scale() 覆盖 translate → 提示框偏移到屏幕右下 */
        '  animation:ctPrepRedFlashCenter 0.9s ease-in-out infinite;',
        '}',
        '@keyframes ctPrepRedFlashCenter{',
        '  0%,100%{transform:translate(-50%,-50%) scale(1);opacity:1;}',
        '  50%{transform:translate(-50%,-50%) scale(1.08);opacity:0.82;}',
        '}',
        '@keyframes ctPrepFadeIn{from{opacity:0}to{opacity:1}}',

        /* 折扣徽标 */
        '.ct-prep-discount{',
        '  padding:3px 10px;border-radius:4px;font-family:"JetBrains Mono",monospace;font-size:12px;',
        '  font-weight:800;letter-spacing:1px;',
        '  background:rgba(255,213,79,0.18);color:#ffd54f;border:1px solid rgba(255,213,79,0.55);',
        '  text-shadow:0 0 6px rgba(255,179,0,0.8);',
        '}'
      ].join('\n');
      const style = document.createElement('style');
      style.id = 'ct-prep-ui-style';
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    } catch (_) {}
  }

  /* ============================================================
   *  构造顶栏 HUD
   * ============================================================ */
  function buildTopBar(payload) {
    const top = el('div', { class: 'ct-prep-top' });

    // 左：模式 chip
    const mode = payload.mode || 'horde';
    const modeIcon = MODE_ICONS[mode] || '🎮';
    const modeLabel = MODE_LABELS[mode] || 'PREPARE';
    const chip = el('div', { class: 'ct-prep-mode-chip' });
    chip.appendChild(el('span', { class: 'ct-prep-mode-icon' }, modeIcon));
    chip.appendChild(el('span', null, 'MODE · ' + modeLabel));

    // 中：倒计时
    const timerWrap = el('div', { class: 'ct-prep-timer-wrap' });
    const label = el('div', { class: 'ct-prep-timer-label' }, '⏱ PREPARING · COUNTDOWN');
    const sec = el('div', {
      class: 'ct-prep-timer-seconds',
      id: 'ct-prep-seconds'
    }, String(payload.seconds | 0));
    timerWrap.appendChild(label);
    timerWrap.appendChild(sec);
    state.secondsEl = sec;

    // 右：波次 + 折扣
    const right = el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } });
    if (payload.discount != null && payload.discount < 1.0) {
      const pct = Math.round(payload.discount * 100);
      right.appendChild(el('div', { class: 'ct-prep-discount' }, '🔥 ' + pct + '% OFF'));
    }
    const wave = el('div', { class: 'ct-prep-wave' },
      'WAVE <b>' + ((payload.wave | 0) || '?') + '</b> / ' + (payload.isBoss ? 'BOSS' : 'NEXT')
    );
    right.appendChild(wave);
    state.topLabelEl = wave;

    top.appendChild(chip);
    top.appendChild(timerWrap);
    top.appendChild(right);
    return top;
  }

  /* ============================================================
   *  构造敌情预告左栏
   * ============================================================ */
  function buildReport(payload) {
    const wrap = el('div', { class: 'ct-prep-left' });
    state.reportWrap = wrap;

    // 标题
    const title = el('div', { class: 'ct-prep-report-title' });
    title.appendChild(el('span', null, 'NEXT WAVE · REPORT'));
    wrap.appendChild(title);

    const report = payload.enemyReport || {};
    const rows = [
      { key: 'normal', count: report.normal | 0 },
      { key: 'fast',   count: report.fast   | 0 },
      { key: 'elite',  count: report.elite  | 0 }
    ];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const meta = ENEMY_META[r.key];
      const row = el('div', { class: 'ct-prep-enemy-row' });
      const left = el('div', { class: 'ct-prep-enemy-left' });
      const dot = el('div', {
        class: 'ct-prep-enemy-dot',
        style: { backgroundColor: meta.dot, boxShadow: meta.glow }
      });
      left.appendChild(dot);
      left.appendChild(el('div', { class: 'ct-prep-enemy-name' }, meta.label));
      row.appendChild(left);
      row.appendChild(el('div', { class: 'ct-prep-enemy-count', 'data-count-key': r.key },
        String(r.count)
      ));
      wrap.appendChild(row);
    }

    // BOSS 预告
    if (payload.isBoss || report.isBoss) {
      const card = el('div', { class: 'ct-prep-boss-card' });
      const head = el('div', { class: 'ct-prep-boss-head' });
      head.appendChild(el('div', { class: 'ct-prep-boss-avatar' }, '👹'));
      const nameWrap = el('div');
      nameWrap.appendChild(el('div', { class: 'ct-prep-boss-name' }, report.bossName || 'UNKNOWN BOSS'));
      nameWrap.appendChild(el('div', { class: 'ct-prep-boss-tag' }, '⚠ BOSS WAVE'));
      head.appendChild(nameWrap);
      card.appendChild(head);

      const skills = el('div', { class: 'ct-prep-boss-skills' });
      const list = Array.isArray(report.bossSkills) ? report.bossSkills : [];
      const skillIcons = ['🔥', '💥', '☠️', '🌀', '⚡', '🛡️'];
      for (let i = 0; i < list.length; i++) {
        const chip = el('div', { class: 'ct-prep-boss-skill' });
        chip.appendChild(el('span', null, skillIcons[i % skillIcons.length]));
        chip.appendChild(el('span', null, list[i]));
        skills.appendChild(chip);
      }
      if (list.length === 0) {
        skills.appendChild(el('div', { class: 'ct-prep-boss-skill' }, '⚠ 未知技能'));
      }
      card.appendChild(skills);
      wrap.appendChild(card);
    }

    return wrap;
  }

  /* ============================================================
   *  构造底部「准备完毕」按钮
   * ============================================================ */
  function buildReadyBtn() {
    const bottom = el('div', { class: 'ct-prep-bottom' });
    const btn = el('button', {
      class: 'ct-prep-ready-btn',
      type: 'button',
      id: 'ct-prep-ready-btn'
    });
    btn.appendChild(el('span', { class: 'icon' }, '▶'));
    btn.appendChild(el('span', null, 'READY · 准备完毕'));
    const bound = function (ev) {
      try { ev && ev.preventDefault && ev.preventDefault(); } catch (_) {}
      BUS.emit('prep-ui:ready', { source: 'prep-ui' });
      // 同步调用 CT_PREP.markReady（若已就绪），保证事件/直接调用两条链路都能触发
      try { if (window.CT_PREP && typeof window.CT_PREP.markReady === 'function') window.CT_PREP.markReady('player'); } catch (_) {}
    };
    btn.addEventListener('click', bound);
    state.boundReady = bound;
    state.btnReady = btn;
    bottom.appendChild(btn);
    return bottom;
  }

  /* ============================================================
   *  商店锁定遮罩
   * ============================================================ */
  function ensureShopMask() {
    if (state.shopMaskEl) return state.shopMaskEl;
    const m = el('div', { class: 'ct-shop-mask', id: 'ct-shop-lock-mask' });
    m.appendChild(el('div', { class: 'ct-shop-mask-text' }, '🛑 SHOP LOCKED · 商店已锁定'));
    (document.body || document.documentElement).appendChild(m);
    state.shopMaskEl = m;
    return m;
  }

  /* ============================================================
   *  公共：显示面板
   * ============================================================ */
  function showPanel(payload) {
    ensureStyles();
    const root = state.root || $('prep-ui-root');
    if (!root) return;
    try { root.innerHTML = ''; } catch (_) {}
    state.root = root;
    state.currentPayload = payload || {};
    state.currentSeconds = (payload && payload.seconds) | 0;

    try {
      root.appendChild(buildTopBar(state.currentPayload));
      root.appendChild(buildReport(state.currentPayload));
      root.appendChild(buildReadyBtn());
    } catch (e) {
      console.warn('[CT_UI_PREP] build DOM failed:', e);
    }
    root.classList.add('visible');
  }

  function hidePanel() {
    try {
      if (state.root) {
        state.root.classList.remove('visible');
        state.root.innerHTML = '';
      }
    } catch (_) {}
    try {
      if (state.shopMaskEl) {
        state.shopMaskEl.classList.remove('visible');
      }
    } catch (_) {}
    state.secondsEl = null;
    state.topLabelEl = null;
    state.btnReady = null;
    state.boundReady = null;
    state.currentPayload = null;
    state.currentSeconds = 0;
  }

  function updateSeconds(sec) {
    state.currentSeconds = sec | 0;
    if (!state.secondsEl) return;
    state.secondsEl.textContent = String(sec | 0);
  }

  function flashRed(enabled) {
    if (!state.secondsEl) return;
    if (enabled) {
      state.secondsEl.classList.remove('flash-green');
      state.secondsEl.classList.add('flash-red');
    } else {
      state.secondsEl.classList.remove('flash-red');
    }
  }

  function flashGreen() {
    if (!state.secondsEl) return;
    state.secondsEl.classList.remove('flash-red');
    // 重启动画
    state.secondsEl.classList.remove('flash-green');
    // 强制 reflow
    void state.secondsEl.offsetWidth;
    state.secondsEl.classList.add('flash-green');
    // 700ms 后移除
    setTimeout(function () {
      try { if (state.secondsEl) state.secondsEl.classList.remove('flash-green'); } catch (_) {}
    }, 720);
  }

  function setShopMask(visible) {
    const m = ensureShopMask();
    if (!m) return;
    try {
      if (visible) m.classList.add('visible');
      else m.classList.remove('visible');
    } catch (_) {}
  }

  /* ============================================================
   *  BUS 事件绑定
   * ============================================================ */
  function bindBus() {
    BUS.on('ui:showPrepPanel', function (payload) {
      try { showPanel(payload || {}); } catch (e) { console.warn('[CT_UI_PREP] show:', e); }
    });
    BUS.on('ui:hidePrepPanel', function () {
      try { hidePanel(); } catch (e) { console.warn('[CT_UI_PREP] hide:', e); }
    });
    BUS.on('prep:tick', function (sec) {
      try {
        updateSeconds(sec);
        if (sec <= 3) flashRed(true); else flashRed(false);
      } catch (_) {}
    });
    BUS.on('ui:shopLocked', function () {
      try {
        flashRed(true);
        setShopMask(true);
        if (state.btnReady) state.btnReady.removeAttribute('disabled');
      } catch (_) {}
    });
    BUS.on('ui:shopClose', function () {
      try { setShopMask(false); } catch (_) {}
    });
    BUS.on('prep:ready', function (evt) {
      try {
        if (evt && evt.accelerated) flashGreen();
        // duel 模式更新按钮文字
        if (state.btnReady && evt && evt.duel) {
          const cnt = evt.readyCount | 0;
          state.btnReady.innerHTML = '<span class="icon">⚔</span><span>READY · ' + cnt + '/2</span>';
          if (cnt >= 2) state.btnReady.setAttribute('disabled', 'disabled');
        } else if (state.btnReady && evt && evt.accelerated) {
          state.btnReady.setAttribute('disabled', 'disabled');
          state.btnReady.innerHTML = '<span class="icon">⏳</span><span>LOCKED · 冲刺倒计时</span>';
        }
      } catch (_) {}
    });
    BUS.on('prep:canceled', function () {
      try { hidePanel(); setShopMask(false); } catch (_) {}
    });
    BUS.on('prep:combatStart', function () {
      try { hidePanel(); setShopMask(false); } catch (_) {}
    });
  }

  /* ============================================================
   *  初始化
   * ============================================================ */
  function initWhenReady() {
    try { ensureStyles(); } catch (_) {}
    try { bindBus(); } catch (e) { console.warn('[CT_UI_PREP] bind failed:', e); }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initWhenReady, { once: true });
    } else {
      initWhenReady();
    }
  } else {
    initWhenReady();
  }

  /* ============================================================
   *  对外 API（调试 / 手动控制）
   * ============================================================ */
  window.CT_UI_PREP = {
    show: showPanel,
    hide: hidePanel,
    setSeconds: updateSeconds,
    flashRed: flashRed,
    flashGreen: flashGreen,
    setShopMask: setShopMask,
    get rootEl() { return state.root || $('prep-ui-root'); },
    get readyBtnEl() { return state.btnReady; },
    _state: state
  };
})();

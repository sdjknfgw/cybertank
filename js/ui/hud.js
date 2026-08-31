/* ==========================================================
 * CyberTank — 战斗 HUD
 * window.CT_UI_HUD
 * ========================================================== */
(function (global) {
    'use strict';
    const BUS = global.CT_BUS || { emit() {}, on() {} };
    const HUD = {};
    let _style = false;
    let _lastUpdate = 0;
    let _dom = {};
    let _lastInvLen = 0;   // 上一帧道具栏长度：用于检测「新道具入格」并触发高亮
    /** 增益倒计时刷新节流累加器（req5） */
    let _buffAccum = 0;

    /* ---------- 定时增益显示元数据（按 tempBuff.type 查表） ----------
     * 倒计时胶囊直接渲染 player.tempBuffs（唯一数据源），
     * 这里只补「人类可读」的名字/图标/颜色；dur/max 来自 tempBuff 本身。
     * 新增 buff 类型时在此登记一行即可，渲染逻辑零改动。 */
    const TEMP_BUFF_META = {
      speedMul:         { name: '急速引擎', emoji: '⚡', color: '#39ff14', max: 8 },
      triple:           { name: '三重射击', emoji: '🔱', color: '#ff4da6', max: 10 },
      shield:           { name: '无敌护盾', emoji: '🛡️', color: '#00e5ff', max: 6 },
      weapon:           { name: '激光炮', emoji: '💠', color: '#ff3860', max: 15 },
      pickup:           { name: '磁吸装置', emoji: '🧲', color: '#ffc94a', max: 12 },
      mapReveal:        { name: '侦察无人机', emoji: '🛸', color: '#9be7ff', max: 20 },
      fireRate:         { name: '弹药补给', emoji: '📦', color: '#ffb020', max: 15 },
      dash:             { name: '冲刺突击', emoji: '💨', color: '#00e5ff', max: 3 },
      skillShieldRegen: { name: '护盾重构', emoji: '🛡', color: '#7cf76b', max: 5 }
    };

    function inj() {
        if (_style) return; _style = true;
        const s = document.createElement('style');
        s.textContent =
            '.hud-glass{background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:12px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 6px 24px rgba(0,0,0,.4)}' +
            '.hud-corner{position:relative}' +
            '.hud-corner::before,.hud-corner::after{content:"";position:absolute;width:12px;height:12px;border-color:var(--neon-cyan);border-style:solid;pointer-events:none;filter:drop-shadow(0 0 3px rgba(0,229,255,.6))}' +
            '.hud-corner::before{top:-1px;left:-1px;border-width:2px 0 0 2px;border-top-left-radius:10px}' +
            '.hud-corner::after{bottom:-1px;right:-1px;border-width:0 2px 2px 0;border-bottom-right-radius:10px}' +
            '.hud-bar{height:15px;border-radius:6px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.08);position:relative;overflow:hidden}' +
            '.hud-bar .fill{position:absolute;inset:0;width:100%;border-radius:6px;transition:width .22s ease}' +
            '.hud-bar .fill.hp{background:linear-gradient(90deg,#ff1744,#ff5c7c,#ff4d6d);box-shadow:inset 0 0 12px rgba(255,77,109,.55),0 0 10px rgba(255,77,109,.4)}' +
            '.hud-bar .fill.shield{background:linear-gradient(90deg,#0099d6,#4cc9f0,#b3e5fc);box-shadow:inset 0 0 12px rgba(76,201,240,.55),0 0 10px rgba(76,201,240,.4);opacity:.85}' +
            '.hud-bar .fill.skill{background:linear-gradient(90deg,#1dbf2c,#7cf76b,#c9f7bf);box-shadow:inset 0 0 12px rgba(124,247,107,.5)}' +
            '.hud-bar .fill.skill.cd{background:linear-gradient(90deg,#444,#777);box-shadow:none}' +
            '.hud-bar .shine{position:absolute;top:0;left:0;height:100%;width:30%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent);animation:shine 2.2s linear infinite}' +
            '.text-glow-green{color:#7cf76b;text-shadow:0 0 6px rgba(124,247,107,.85),0 0 14px rgba(124,247,107,.4)}' +
            '.radar-wrap{width:160px;height:160px;border:1px solid var(--neon-cyan);border-radius:12px;position:relative;background:rgba(5,7,15,.8);overflow:hidden;box-shadow:0 0 14px rgba(0,229,255,.35),inset 0 0 20px rgba(0,229,255,.12)}' +
            '.radar-grid{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(0,229,255,.15) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.15) 1px,transparent 1px);background-size:20px 20px,20px 20px}' +
            '.radar-scan{position:absolute;inset:0;pointer-events:none}' +
            '.radar-scan::after{content:"";position:absolute;top:50%;left:50%;width:50%;height:1.5px;background:linear-gradient(90deg,rgba(0,229,255,.95),transparent);transform-origin:left center;animation:scanRot 2.6s linear infinite;box-shadow:0 0 8px rgba(0,229,255,.9)}' +
            '@keyframes scanRot{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}' +
            '.radar-circle{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);border-radius:50%;border:1px dashed rgba(255,43,214,.4);pointer-events:none;animation:brPulse 1.6s ease-in-out infinite}' +
            '@keyframes brPulse{0%,100%{opacity:.4}50%{opacity:.8}}' +
            '.boss-bar-wrap{position:fixed;top:14px;left:50%;transform:translateX(-50%);width:60%;max-width:900px;z-index:50}' +
            '.boss-name{font-family:"Share Tech Mono",monospace;font-size:14px;color:var(--coin-gold);text-shadow:0 0 8px rgba(255,201,60,.8);letter-spacing:.2em;text-align:center;margin-bottom:6px;display:flex;justify-content:space-between}' +
            '.boss-bar{height:18px;border-radius:10px;background:rgba(0,0,0,.6);border:1px solid var(--coin-gold);overflow:hidden;position:relative;box-shadow:0 0 14px rgba(255,201,60,.5)}' +
            '.boss-bar .fill{height:100%;background:linear-gradient(90deg,#b8860b,#ffc93c,#fff0b3);box-shadow:inset 0 0 14px rgba(255,255,255,.45);transition:width .3s ease}' +
            '.boss-bar .shine{position:absolute;inset:0;background:linear-gradient(90deg,transparent 20%,rgba(255,255,255,.3) 50%,transparent 80%);animation:shine 1.8s linear infinite}' +
            '.inv-slot{width:48px;height:48px;border:1px solid var(--neon-cyan);border-radius:10px;background:rgba(0,229,255,.06);position:relative;display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;transition:all .15s ease}' +
            '.inv-slot:hover{border-color:#fff;box-shadow:0 0 12px rgba(0,229,255,.8),inset 0 0 10px rgba(0,229,255,.2)}' +
            '.inv-slot .num{position:absolute;top:-6px;left:-6px;background:var(--neon-cyan);color:#001a1f;font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:800;padding:1px 6px;border-radius:999px;box-shadow:0 0 6px rgba(0,229,255,.6)}' +
            '.inv-slot .count{position:absolute;bottom:-4px;right:-4px;background:var(--neon-magenta);color:#fff;font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:800;padding:1px 5px;border-radius:999px;box-shadow:0 0 6px rgba(255,43,214,.6)}' +
            '.hint-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 6px;border-radius:5px;background:rgba(12,18,40,.9);border:1px solid var(--panel-border);font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--text-hi);margin:0 2px}' +
            '.mobile-stick{display:none;position:fixed;bottom:24px;left:24px;width:130px;height:130px;z-index:60;border-radius:50%;background:rgba(12,18,40,.65);border:1.5px solid var(--neon-cyan);box-shadow:0 0 14px rgba(0,229,255,.4)}' +
            '.mobile-stick .stick{position:absolute;top:50%;left:50%;width:54px;height:54px;border-radius:50%;background:radial-gradient(circle at 30% 30%,rgba(0,229,255,.8),rgba(0,229,255,.25));transform:translate(-50%,-50%);box-shadow:0 0 14px rgba(0,229,255,.8)}' +
            '.mobile-btn{position:fixed;bottom:40px;right:30px;width:72px;height:72px;border-radius:50%;border:2px solid var(--neon-magenta);background:rgba(255,43,214,.18);color:#fff;font-size:28px;display:none;align-items:center;justify-content:center;z-index:60;box-shadow:0 0 14px rgba(255,43,214,.6)}' +
            '.mobile-btn.skill{right:120px;width:60px;height:60px;font-size:24px;border-color:var(--energy-green);background:rgba(124,247,107,.16);box-shadow:0 0 14px rgba(124,247,107,.5)}' +
            '@media (max-width:768px){.mobile-stick{display:block}.mobile-btn{display:flex}}' +
            '.tank-avatar{width:32px;height:32px;border-radius:8px;border:1.5px solid var(--neon-cyan);box-shadow:0 0 8px rgba(0,229,255,.55);background:linear-gradient(135deg,rgba(0,229,255,.2),rgba(255,43,214,.15));display:flex;align-items:center;justify-content:center;font-size:18px}' +
            /* req5：玩家拾取定时增益后，顶部居中显示的剩余时长倒计时胶囊 */
            '.ct-buff-chip{display:flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;background:rgba(8,12,24,.82);border:1px solid var(--neon-cyan);font-family:"Share Tech Mono",monospace;font-size:12px;color:#eaf6ff;min-width:158px;position:relative;overflow:hidden;box-shadow:0 0 10px rgba(0,229,255,.25)}' +
            /* 进度环：外圈 conic-gradient 由渲染层按剩余比例着色，内层挖空露图标 */
            '.ct-buff-chip-ring{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;box-shadow:0 0 6px rgba(0,229,255,.35)}' +
            '.ct-buff-chip-ring .ct-buff-chip-emoji{width:20px;height:20px;border-radius:50%;background:#080c18;display:flex;align-items:center;justify-content:center;font-size:12px;filter:drop-shadow(0 0 4px rgba(255,255,255,.35))}' +
            '.ct-buff-chip-name{flex:1;white-space:nowrap;letter-spacing:.04em}' +
            '.ct-buff-chip-time{font-weight:800;min-width:44px;text-align:right;text-shadow:0 0 6px currentColor}' +
            '.ct-buff-chip-bar{position:absolute;left:0;bottom:0;height:2px;width:100%;background:rgba(255,255,255,.12)}' +
            '.ct-buff-chip-bar i{display:block;height:100%;box-shadow:0 0 6px currentColor;transition:width .12s linear}' +
            /* 本局永久增益 / 装备的「已生效」状态条（悬停可见明细） */
            '.ct-perm-strip{display:flex;align-items:center;gap:4px;flex-wrap:wrap;justify-content:center;max-width:60vw}' +
            '.ct-perm-chip{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;background:rgba(8,12,24,.78);border:1px solid rgba(124,247,107,.5);font-family:"Share Tech Mono",monospace;font-size:11px;color:#eaf6ff;box-shadow:0 0 8px rgba(124,247,107,.25);cursor:help}' +
            '.ct-perm-chip b{font-weight:800;color:#7cf76b}' +
            /* 道具栏新入格高亮：买了道具能立刻看到「哪一格进来了」 */
            '@keyframes slotPop{0%{transform:scale(.55);box-shadow:0 0 0 rgba(124,247,107,0)}55%{transform:scale(1.18);box-shadow:0 0 22px rgba(124,247,107,.95)}100%{transform:scale(1);box-shadow:0 0 8px rgba(124,247,107,.25)}}' +
            '.inv-slot.slot-pop{animation:slotPop .5s ease-out;border-color:#7cf76b}';
        document.head.appendChild(s);
    }

    function h(tag, cls, txt) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (txt != null) { if (typeof txt === 'string' && txt.includes('<')) el.innerHTML = txt; else el.textContent = txt; }
        return el;
    }

    /* ========== 定时效果的显示与反馈 ==========
     * 倒计时胶囊的唯一数据源是 player.tempBuffs（tank.js 每秒递减、到点自动移除），
     * 任何来源（地图掉落 / 商店直购 / 使用库存道具 / 技能）只要 push 了 tempBuff，
     * 胶囊就自动出现，到期自动消失 —— 购买/显示/使用/计时天然一致。
     * 事件（powerup:pickup / shop:purchased / tank:useInventory）只负责
     * 「拾取/购买/使用瞬间」的一次性 toast 提醒，不持有任何状态，
     * 因此不存在旧实现里「事件副本与真实 buff 计时不一致」的问题：
     *   - 旧实现按事件登记条目：商店 P18 的 def 没有 duration 字段 → 永远不显示；
     *   - 旧实现用 performance.now 实时时钟倒计时，而 tempBuffs 按游戏 dt 递减，
     *     暂停/准备期两边步调不一致 → 胶囊显示的剩余时间与实际效果脱节；
     *   - 旧实现上限 12 条塞满后 shift() 挤掉最早一条 → 表现为「互相覆盖」。 */
    function onBuffPickup(e) {
        if (!e) return;
        const tank = e.target || e.tank;
        let def = e.def;
        if (!def && e.powerup) def = e.powerup.def;
        if (!def && e.powerupId) { const PW = global.CT_POWERUP; def = PW && PW.PowerupDefs && PW.PowerupDefs[e.powerupId]; }
        if (!tank || tank.type !== 'player') return;
        const M = global.CT_UI_MODAL;
        if (M && typeof M.showToast === 'function') M.showToast((def.emoji || def.icon || '⚡') + ' ' + (def.name || '增益') + ' · 持续 ' + def.duration + 's', 'info');
    }

    /* ---------- 通用：发光渐变条 ---------- */
    HUD.drawBar = function (canvasOrCtx, percent, colorArr) {
        const ctx = (canvasOrCtx instanceof HTMLCanvasElement) ? canvasOrCtx.getContext('2d') : canvasOrCtx;
        const w = (canvasOrCtx instanceof HTMLCanvasElement) ? canvasOrCtx.width : (canvasOrCtx.canvas ? canvasOrCtx.canvas.width : 200);
        const h = (canvasOrCtx instanceof HTMLCanvasElement) ? canvasOrCtx.height : (canvasOrCtx.canvas ? canvasOrCtx.canvas.height : 10);
        const p = Math.max(0, Math.min(1, percent));
        ctx.clearRect(0, 0, w, h);
        // bg
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        const r = Math.min(h / 2, 6);
        roundRect(ctx, 0, 0, w, h, r); ctx.fill();
        // fill
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        (colorArr || ['#00e5ff', '#ffffff']).forEach((c, i) => {
            grad.addColorStop(i / (colorArr.length - 1), c);
        });
        ctx.fillStyle = grad;
        ctx.shadowBlur = 10; ctx.shadowColor = colorArr ? colorArr[0] : '#00e5ff';
        roundRect(ctx, 1, 1, (w - 2) * p, h - 2, r); ctx.fill();
        ctx.shadowBlur = 0;
    };
    function roundRect(ctx, x, y, w, h, r) {
        if (h < 2 * r) r = h / 2;
        if (w < 2 * r) r = w / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    /* ---------- init ---------- */
    /* 技能中文名（释放提醒用） */
    const SKILL_NAMES = { assault: '冲刺突击', heavy: '能量护盾', sniper: '穿甲狙击', engineer: '战术布雷' };

    HUD.init = function () {
        inj();
        // 事件：tank 受击/死亡
        if (BUS && typeof BUS.on === 'function') {
            BUS.on('tank:hit', () => {
                const hp = _dom.hpFill; if (hp) {
                    if (!_dom.shake) { _dom.shake = document.getElementById('game-hud-wrap') || _dom.root; }
                    if (_dom.shake) { _dom.shake.classList.add('anim-shake'); setTimeout(() => _dom.shake.classList.remove('anim-shake'), 400); }
                }
            });
            BUS.on('tank:dead', (ev) => {
                /* emitGlobal 修复后所有坦克死亡都会派发 tank:dead —— 只在玩家被击毁时提示 */
                if (ev && ev.dead && ev.dead.type !== 'player') return;
                const M = global.CT_UI_MODAL;
                M && M.showToast && M.showToast('坦克被击毁', 'error');
            });
            /* ---------- 道具/技能释放提醒（仅玩家自己） ---------- */
            const isPlayer = (t) => t && (t.type === 'player' || t.playerSlot);
            const toast = (msg, level) => {
                const M = global.CT_UI_MODAL;
                M && M.showToast && M.showToast(msg, level);
            };
            BUS.on('tank:skillCast', (ev) => {
                if (!isPlayer(ev && ev.tank)) return;
                toast('⚡ 释放技能：' + (SKILL_NAMES[ev.skill] || ev.skill || ''), 'info');
            });
            BUS.on('tank:skillDenied', (ev) => {
                if (!isPlayer(ev && ev.tank)) return;
                toast('⏱ 技能冷却中 ' + Math.max(0, ev.remain || 0).toFixed(1) + 's', 'warn');
            });
            BUS.on('tank:useInventory', (ev) => {
                if (!isPlayer(ev && ev.tank)) return;
                const def = ev.def || {};
                /* 倒计时胶囊已由 tempBuffs 直接驱动（按 def.apply 时 push 进去），
                 * 这里只做一次性使用提示。 */
                toast('🧪 使用道具：' + (def.name || '道具') + (def.duration > 0 ? ' · 持续 ' + def.duration + 's' : ''), 'info');
            });
            /* ---------- 道具栏满被挤掉：如实提示，避免「买了却不见了」 ---------- */
            BUS.on('tank:inventoryOverflow', (ev) => {
                if (!isPlayer(ev && ev.tank)) return;
                const lost = (ev && ev.evicted) || {};
                toast('🎒 道具栏已满，最早的「' + (lost.name || '道具') + '」被挤掉了', 'warn');
            });
            /* ---------- 商店购买：入库 / 即时生效分别给出明确反馈 ----------
             * ev.stored 由 shop.js 按购买前后 inventory 长度差判定，最可靠。
             * 倒计时胶囊直接读 tempBuffs，无需这里再登记；toast 一次性提示即可。 */
            BUS.on('shop:purchased', (ev) => {
                const d = (ev && ev.item) || {}, p = ev && ev.player;
                if (!isPlayer(p)) return;
                const PWD = global.CT_POWERUP && global.CT_POWERUP.PowerupDefs;
                const pd = PWD ? PWD[d.id] : null;
                const dur = (pd && pd.duration) || d.duration || 0;
                if (ev.stored) {
                    /* 入库类：暂不生效，等玩家按 1~5 使用 —— 明确指路道具栏 */
                    toast('📦 已放入道具栏：' + (d.icon || '') + ' ' + (d.name || d.id) + '（按 1~5 使用）', 'info');
                    return;
                }
                /* 即时生效类：提示「已生效」+ 持续时长；定时效果会在顶部胶囊看到剩余时间 */
                toast('✅ 已生效：' + (d.icon || '') + ' ' + (d.name || d.id) +
                    (dur > 0 ? ' · 持续 ' + dur + 's' : '') +
                    (d.desc ? ' — ' + d.desc : ''), 'success');
            });
            BUS.on('tank:itemDenied', (ev) => {
                if (!isPlayer(ev && ev.tank)) return;
                toast('⏳ 道具冷却中 ' + Math.max(0, ev.remain || 0).toFixed(1) + 's', 'warn');
            });
            /* ---------- req5：玩家拾取定时增益时登记剩余时长倒计时 ---------- */
            BUS.on('powerup:pickup', onBuffPickup);
            BUS.on('powerup:picked', onBuffPickup);
        }
        // 每帧更新 -> 降频到 0.15s（血条受击要及时反馈）
        if (global.CT_ENGINE && typeof global.CT_ENGINE.registerUpdate === 'function') {
            global.CT_ENGINE.registerUpdate(function (dt) {
                _lastUpdate += dt;
                if (_lastUpdate >= 0.15) { _lastUpdate = 0; HUD.updateHud(dt, null, null, null); }
            }, 20);
            /* 复活倒计时浮层：独立每帧监听，直接读 global.CT_RESPAWN_T 驱动常驻 DOM。
             * 不依赖 startGame 内一次性注册的 fx 渲染回调，确保据点模式战败后一定弹出面板，
             * 不再出现「阵亡后无倒计时、画面卡死」的问题。 */
            global.CT_ENGINE.registerUpdate(function () {
                const ov = document.getElementById('ct-respawn-overlay');
                if (!ov) return;
                const t = global.CT_RESPAWN_T;
                if (t && t > 0) {
                    ov.style.display = 'flex';
                    ov.classList.add('is-show');
                    const num = ov.querySelector('.ct-respawn-num');
                    if (num) num.textContent = t.toFixed(1);
                } else {
                    ov.style.display = 'none';
                    ov.classList.remove('is-show');
                }
            }, 5);
            /* AI 出场倒计时横幅：战斗开始 5 秒内提示“AI 即将来袭”，归零自动隐藏 */
            global.CT_ENGINE.registerUpdate(function () {
                const w = document.getElementById('ct-ai-warn');
                if (!w) return;
                const t = global.CT_AI_WARN_T;
                if (t && t > 0) {
                    w.style.display = 'flex';
                    w.classList.add('is-show');
                    const num = w.querySelector('.ct-ai-warn-num');
                    if (num) num.textContent = t.toFixed(1);
                } else {
                    w.style.display = 'none';
                    w.classList.remove('is-show');
                }
            }, 5);
            /* req5：玩家拾取定时增益后，顶部居中实时显示剩余秒数倒计时胶囊。
             * 节流到 ~10fps 重建 DOM（最多 6 个胶囊，开销极低），倒计时归零自动移除。 */
            global.CT_ENGINE.registerUpdate(function (dt) {
                _buffAccum += dt;
                if (_buffAccum < 0.1) return;
                _buffAccum = 0;
                const el = document.getElementById('hud-buff-timer');
                if (!el) return;
                /* 唯一数据源：player.tempBuffs。tank.js 已在 COMBAT 阶段每秒递减并移除到期的，
                 * 这里只如实照着画，不再维护独立的「事件副本」状态 ——
                 * 因此购买/拾取/使用/技能任一来源只要 push 了 tempBuff 就必然显示，
                 * 到期或被移除就必然消失，多个同类效果各占一条、互不覆盖。 */
                const gs = global.CT_ENGINE && global.CT_ENGINE.gameState;
                const p = gs && gs.player;
                const buffs = (p && Array.isArray(p.tempBuffs)) ? p.tempBuffs : [];
                let html = '';
                for (let i = 0; i < buffs.length; i++) {
                    const b = buffs[i];
                    const remain = Math.max(0, b.dur || 0);
                    if (remain <= 0) continue;   // tank.js 即将移除，跳过避免一帧显示 0
                    const meta = TEMP_BUFF_META[b.type] || { name: b.type, emoji: '⚡', color: '#00f0ff', max: remain };
                    const total = Math.max(remain, b.max || meta.max || remain);   // 进度环分母
                    const ratio = Math.max(0, Math.min(1, remain / total));
                    const pct = ratio * 100;
                    const col = meta.color;
                    const ringDeg = Math.round(360 * ratio);
                    /* 进度环(conic-gradient) 包住图标、剩余秒数、底条 —— 三重冗余，远近都能读 */
                    html += '<div class="ct-buff-chip" style="border-color:' + col + ';box-shadow:0 0 10px ' + col + '55">'
                        + '<span class="ct-buff-chip-ring" style="background:conic-gradient(' + col + ' ' + ringDeg + 'deg, rgba(255,255,255,.14) ' + ringDeg + 'deg)">'
                        + '<span class="ct-buff-chip-emoji">' + meta.emoji + '</span></span>'
                        + '<span class="ct-buff-chip-name">' + meta.name + '</span>'
                        + '<span class="ct-buff-chip-time" style="color:' + col + '">' + remain.toFixed(1) + 's</span>'
                        + '<span class="ct-buff-chip-bar"><i style="width:' + pct.toFixed(1) + '%;background:' + col + ';color:' + col + '"></i></span>'
                        + '</div>';
                }
                el.innerHTML = html;
            }, 6);
        }
    };

    /* ---------- startGame ---------- */
    HUD.startGame = function (mode, tank, skin, difficulty, opponent, p2Tank) {
        inj();
        /* 增益倒计时不再持有副本状态：胶囊直接读 player.tempBuffs，
         * 新一局用全新 tank 对象，旧 buff 自然不复存在，无需清空。 */
        _buffAccum = 0;
        _lastInvLen = 0;
        _dom.p2 = null;   // 重开需清空上一局的 P2 HUD 引用，否则会更新到已卸载的旧节点
        /* 记录当前模式：updateHud 的波次显示按模式分支
         * （无尽 ∞ / 经典 20 波 / 1v1 局数 / 据点节数 / 大逃杀生存） */
        HUD._mode = mode || '';
        /* 记录本次对局选项：战败后「继续战斗」可按相同模式/地图/玩法直接重开 */
        global.CT_LAST_MODE_OPTS = { mode: mode || 'horde', tank: tank, skin: skin, difficulty: difficulty, opponent: opponent || 'ai', p2Tank: p2Tank || 'same' };
        const menu = document.getElementById('main-menu-wrap');
        const hud = document.getElementById('game-hud-wrap');
        if (menu) menu.classList.add('hidden');
        if (hud) {
            hud.classList.remove('hidden');
            hud.innerHTML = '';
            hud.className = 'absolute inset-0 z-30 w-screen h-screen pointer-events-none anim-fadeIn';
        }
        _dom.root = hud;

        // --- 左上：玩家血条组（宽度收缩到与"玩家001"文字一致，不挡视野） ---
        const tl = h('div', 'hud-glass hud-corner absolute top-4 left-4 px-4 py-3 pointer-events-auto w-fit min-w-0');
        const tRow = h('div', 'flex items-center gap-3 mb-2.5');
        tRow.appendChild(h('div', 'tank-avatar', '🚀'));
        const nameCol = h('div', 'flex-1');
        nameCol.appendChild(h('div', 'font-tech text-sm text-glow-cyan tracking-wider', 'COMMANDER'));
        nameCol.appendChild(h('div', 'font-mono text-text-hi text-sm', '玩家001 · Lv.1'));
        tRow.appendChild(nameCol);
        tl.appendChild(tRow);
        // HP bar
        const hpWrap = h('div', 'mb-2 relative');
        const hpBar = h('div', 'hud-bar');
        const hpFill = h('div', 'fill hp'); hpFill.style.width = '100%';
        const hpShine = h('div', 'shine');
        hpBar.appendChild(hpFill); hpBar.appendChild(hpShine);
        const hpTxt = h('div', 'absolute inset-0 flex items-center justify-center font-mono text-[12px] text-white font-bold tracking-widest', '100 / 100');
        hpTxt.style.textShadow = '0 0 6px rgba(0,0,0,.9)';
        hpWrap.appendChild(hpBar); hpWrap.appendChild(hpTxt); _dom.hpFill = hpFill; _dom.hpTxt = hpTxt;
        tl.appendChild(hpWrap);
        // 护盾（叠加在血条上 薄）
        const shWrap = h('div', 'mb-2 relative');
        const shBar = h('div', 'hud-bar'); shBar.style.height = '10px';
        const shFill = h('div', 'fill shield'); shFill.style.width = '0%';
        shBar.appendChild(shFill);
        const shTxt = h('div', 'absolute inset-0 flex items-center justify-center font-mono text-[10px] text-white', '🛡 SHIELD 0 / 50');
        shTxt.style.textShadow = '0 0 4px rgba(0,0,0,.8)';
        shWrap.appendChild(shBar); shWrap.appendChild(shTxt); _dom.shFill = shFill; _dom.shTxt = shTxt;
        tl.appendChild(shWrap);
        // 技能冷却
        const skWrap = h('div', 'relative');
        const skBar = h('div', 'hud-bar'); skBar.style.height = '10px';
        const skFill = h('div', 'fill skill'); skFill.style.width = '100%';
        skBar.appendChild(skFill);
        const skTxt = h('div', 'absolute inset-0 flex items-center justify-center font-tech text-[10px] text-glow-green font-bold', '⚡ READY');
        skWrap.appendChild(skBar); skWrap.appendChild(skTxt); _dom.skFill = skFill; _dom.skTxt = skTxt;
        tl.appendChild(skWrap);
        hud.appendChild(tl);

        // （右上雷达已按需求移除）

        // --- 顶部居中：增益剩余时长倒计时胶囊（req5）---
        // 注：原顶部中央的静态增益状态栏（含空态占位文案）已按需求移除，倒计时胶囊上移至顶部正中。
        const buffTimer = h('div', 'absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center gap-1.5 z-30');
        buffTimer.id = 'hud-buff-timer';
        hud.appendChild(buffTimer);
        _dom.buffTimer = buffTimer;

        // --- 左下：分数 / 连击 / 波次 ---
        const bl = h('div', 'absolute bottom-4 left-4 pointer-events-auto');
        const blCard = h('div', 'hud-glass hud-corner px-4 py-3 flex items-center gap-6');
        const scCol = h('div', 'flex flex-col items-center');
        scCol.appendChild(h('div', 'font-tech text-[10px] text-text-lo tracking-widest', 'SCORE'));
        scCol.appendChild(h('div', 'font-mono text-glow-gold text-2xl font-bold', '0'));
        blCard.appendChild(scCol);
        const cbCol = h('div', 'flex flex-col items-center');
        cbCol.appendChild(h('div', 'font-tech text-[10px] text-text-lo tracking-widest', 'COMBO'));
        cbCol.appendChild(h('div', 'font-mono text-glow-magenta text-2xl font-bold', 'x1.0'));
        blCard.appendChild(cbCol);
        const wvCol = h('div', 'flex flex-col items-center');
        const wvLabel = h('div', 'font-tech text-[10px] text-text-lo tracking-widest', 'WAVE');
        wvCol.appendChild(wvLabel);
        wvCol.appendChild(h('div', 'font-mono text-glow-cyan text-2xl font-bold', '1 / 20'));
        blCard.appendChild(wvCol);
        _dom.waveLabel = wvLabel;
        bl.appendChild(blCard);
        hud.appendChild(bl);
        _dom.scoreTxt = scCol.children[1]; _dom.comboTxt = cbCol.children[1]; _dom.waveTxt = wvCol.children[1];

        // --- 据点核心耐久条（仅「据点守护」模式显示，req3/req4） ---
        const baseWrap = h('div', 'absolute bottom-[7.5rem] left-4 pointer-events-none');
        baseWrap.id = 'hud-base-wrap';
        baseWrap.style.display = 'none';
        const baseCard = h('div', 'hud-glass hud-corner px-3 py-2 flex items-center gap-2');
        baseCard.appendChild(h('div', 'font-tech text-[10px] text-glow-magenta tracking-widest', '🏰 据点'));
        const baseBarWrap = h('div', 'relative');
        const baseBar = h('div', 'hud-bar'); baseBar.style.width = '150px'; baseBar.style.height = '12px';
        const baseFill = h('div', 'fill hp'); baseFill.style.width = '100%';
        baseBar.appendChild(baseFill);
        const baseTxt = h('div', 'absolute inset-0 flex items-center justify-center font-mono text-[10px] text-white font-bold');
        baseTxt.style.textShadow = '0 0 6px rgba(0,0,0,.9)';
        baseTxt.textContent = '100 / 100';
        baseBarWrap.appendChild(baseBar); baseBarWrap.appendChild(baseTxt);
        baseCard.appendChild(baseBarWrap);
        baseWrap.appendChild(baseCard);
        hud.appendChild(baseWrap);
        _dom.baseWrap = baseWrap; _dom.baseFill = baseFill; _dom.baseTxt = baseTxt;

        // --- 中下：道具栏 5 格 + 本局已生效（永久）增益条 ---
        const bm = h('div', 'absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto flex flex-col items-center gap-1.5');
        /* B 系列永久增益 / E 系列装备既不进道具栏也没有倒计时，但它们真实改变了属性。
         * 没有任何可见反馈时玩家会怀疑「买了到底有没有用」——
         * 这条状态条给出持续可见的「已生效」标识，悬停可看明细。
         * 内容由 updateHud 依据 player.purchasedBuffs / player.equipments 刷新。 */
        const permStrip = h('div', 'ct-perm-strip');
        permStrip.style.display = 'none';
        _dom.permStrip = permStrip;
        bm.appendChild(permStrip);
        const invRow = h('div', 'flex gap-3');
        _dom.invSlots = [];
        for (let i = 0; i < 5; i++) {
            const slot = h('div', 'inv-slot');
            slot.innerHTML = '<span class="num">' + (i + 1) + '</span>';
            invRow.appendChild(slot);
            _dom.invSlots.push(slot);
        }
        bm.appendChild(invRow);
        hud.appendChild(bm);

        // --- 右下：操作提示 ---
        const br = h('div', 'absolute bottom-4 right-4 pointer-events-auto hide-sm');
        const hintCard = h('div', 'hud-glass hud-corner px-4 py-3 text-[11px] text-text-mid leading-7 font-mono');
        const _p2LocalHint = (opponent === 'local');
        hintCard.innerHTML =
            '<div><span class="hint-kbd">W</span><span class="hint-kbd">A</span><span class="hint-kbd">S</span><span class="hint-kbd">D</span> 移动 · <span class="hint-kbd">空格</span> 射击 · <span class="hint-kbd">E</span> 技能</div>' +
            (_p2LocalHint
              ? '<div style="color:#ff8fd0"><span class="hint-kbd">↑</span><span class="hint-kbd">↓</span><span class="hint-kbd">←</span><span class="hint-kbd">→</span> P2移动 · <span class="hint-kbd">Enter</span> 射击 · <span class="hint-kbd">右Shift</span> 技能</div>'
              : '') +
            '<div><span class="hint-kbd">1</span>~<span class="hint-kbd">5</span> 道具</div>';
        br.appendChild(hintCard);
        hud.appendChild(br);

        // --- 右下上方：地形图例（默认收起，点击展开查看各地形作用） ---
        const lgWrap = h('div', 'absolute pointer-events-auto');
        lgWrap.style.right = '16px';
        lgWrap.style.bottom = '150px';
        const lgBtn = h('div', 'hud-glass hud-corner px-3 py-1.5 cursor-pointer select-none font-tech text-[11px] text-glow-cyan tracking-widest');
        lgBtn.textContent = '🗺 地形图例';
        const lgPanel = h('div', 'hud-glass hud-corner px-3 py-2.5 mt-1.5');
        lgPanel.style.display = 'none';
        lgPanel.style.width = '215px';
        const LG_ITEMS = [
            { c: '#8b4a2b', n: '砖墙', d: '可被炮弹摧毁' },
            { c: '#2b3343', n: '钢墙', d: '坚固 · 不可摧毁' },
            { c: '#2ecc40', n: '草丛', d: '进入后隐匿身形' },
            { c: '#b5e3ff', n: '水域', d: '挡坦克 · 炮弹可穿' },
            { c: '#dff4ff', n: '冰面', d: '路面打滑 · 操控降' },
            { c: '#5a3a22', n: '泥沼', d: '大幅减速' },
            { c: '#ff66ff', n: '传送门', d: '成对相连 · 触碰瞬移' }
        ];
        for (let li = 0; li < LG_ITEMS.length; li++) {
            const it = LG_ITEMS[li];
            const row = h('div', 'flex items-center gap-2.5 leading-6');
            const sw = h('div', '');
            sw.style.cssText = 'width:14px;height:14px;flex:0 0 14px;border-radius:3px;background:' + it.c + ';box-shadow:0 0 6px ' + it.c + '66;border:1px solid rgba(255,255,255,.25)';
            row.appendChild(sw);
            row.appendChild(h('span', 'font-tech text-[11px] text-text-hi', it.n));
            row.appendChild(h('span', 'font-mono text-[10px] text-text-lo', it.d));
            lgPanel.appendChild(row);
        }
        lgBtn.addEventListener('click', () => {
            lgPanel.style.display = lgPanel.style.display === 'none' ? 'block' : 'none';
        });
        lgWrap.appendChild(lgBtn);
        lgWrap.appendChild(lgPanel);
        hud.appendChild(lgWrap);

        // 移动端摇杆
        const stick = h('div', 'mobile-stick'); stick.appendChild(h('div', 'stick'));
        hud.appendChild(stick);
        const btnFire = h('div', 'mobile-btn'); btnFire.innerHTML = '🔫';
        hud.appendChild(btnFire);
        const btnSkill = h('div', 'mobile-btn skill'); btnSkill.innerHTML = '⚡';
        hud.appendChild(btnSkill);
        // 移动端按钮 → 映射到 CT_INPUT（按下/松开与鼠标左右键等价）
        const bindHold = (el, onDown, onUp) => {
            const down = (ev) => { ev.preventDefault(); onDown(); };
            const up = (ev) => { ev.preventDefault(); onUp(); };
            el.addEventListener('touchstart', down, { passive: false });
            el.addEventListener('touchend', up, { passive: false });
            el.addEventListener('touchcancel', up, { passive: false });
            el.addEventListener('mousedown', down);
            el.addEventListener('mouseup', up);
            el.addEventListener('mouseleave', up);
        };
        bindHold(btnFire,
            () => { if (global.CT_INPUT) global.CT_INPUT.mouse.down = true; },
            () => { if (global.CT_INPUT) global.CT_INPUT.mouse.down = false; });
        bindHold(btnSkill,
            () => { if (global.CT_INPUT) global.CT_INPUT.mouse.rdown = true; },
            () => { if (global.CT_INPUT) global.CT_INPUT.mouse.rdown = false; });

        // BOSS 血条（初始隐藏，通过 activeBoss 条件启用渲染）
        const bossWrap = h('div', 'boss-bar-wrap pointer-events-none');
        const bossName = h('div', 'boss-name');
        bossName.innerHTML = '<span id="boss-name-txt">⚠ 泰坦·裁决者 · TITAN JUDGE</span><span id="boss-phase-txt" class="text-neon-magenta" style="text-shadow:0 0 8px var(--neon-magenta)">PHASE 1 / 3</span>';
        const bossBar = h('div', 'boss-bar');
        bossBar.innerHTML = '<div class="fill" style="width:100%"></div><div class="shine"></div>';
        bossWrap.appendChild(bossName); bossWrap.appendChild(bossBar);
        bossWrap.style.display = 'none';
        hud.appendChild(bossWrap);
        _dom.bossWrap = bossWrap; _dom.bossFill = bossBar.children[0];

        BUS && BUS.emit && BUS.emit('ui:gameStarting', { mode, tank, skin, difficulty });
        if (global.CT_ENGINE && typeof global.CT_ENGINE.setState === 'function') global.CT_ENGINE.setState('PREPARING');

        // 模式钩子
        try {
            if (typeof global.CT_PREP === 'object' && global.CT_PREP && typeof global.CT_PREP.start === 'function') global.CT_PREP.start({ mode, tank, skin, difficulty, opponent: opponent || 'ai' });
        } catch (_) {}
        try {
            const key = 'CT_MODE_' + ({ royale:'BR', kinghill:'KH', horde:'HORDE', duel:'DUEL', kingdefend:'KINGDEFEND' }[mode] || 'HORDE');
            if (typeof global[key] === 'object' && global[key] && typeof global[key].start === 'function') global[key].start({ tank, skin, difficulty, opponent: opponent || 'ai', p2Tank: p2Tank || 'same' });
        } catch (_) {}

        // 本地双人：构建 P2 独立 HUD（血条/护盾/技能条），主题色取 P2 车型配色
        try {
            const _gs = global.CT_ENGINE && global.CT_ENGINE.gameState;
            if (_gs && (opponent === 'local' || _gs.p2Local) && _gs.p2) {
                _buildP2Hud(_gs);
            }
        } catch (_) {}

        // 注册「玩家头顶光标」（全局 fx，仅注册一次；菜单态 gameState 为空则自动跳过）
        if (!global.__ctPlayerMarkerReg && global.CT_ENGINE && typeof global.CT_ENGINE.registerRender === 'function') {
            const markerFn = function (ctx) {
                const ENG = global.CT_ENGINE;
                const gs = ENG && ENG.gameState;
                if (!gs) return;
                let p = gs.player;
                if ((!p || !p.alive) && gs.tanks) p = gs.tanks.find(t => t && t.alive && t.type === 'player');
                if (!p || !p.alive || !p.pos) return;
                const R = global.CT_RENDERER;
                const cam = (R && R.camera) || { x: 0, y: 0, zoom: 1 };
                const z = cam.zoom || 1;
                const sx = (p.pos.x - cam.x) * z;
                const sy = (p.pos.y - cam.y) * z;
                const r = 10 * z;
                const t = (Date.now() % 1000) / 1000;
                const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
                ctx.save();
                ctx.translate(sx, sy - r - 18 * z);
                ctx.fillStyle = '#ffd700';
                ctx.shadowColor = '#ffd700';
                ctx.shadowBlur = 12;
                // 朝下三角箭头（指向坦克头部）
                ctx.beginPath();
                ctx.moveTo(-r, -r * 0.55);
                ctx.lineTo(r, -r * 0.55);
                ctx.lineTo(0, r * 0.8);
                ctx.closePath();
                ctx.fill();
                // 上方脉动圆点
                ctx.beginPath();
                ctx.arc(0, -r * 0.55 - (6 + pulse * 5) * z, (3 + pulse * 2), 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.restore();
            };
            global.CT_ENGINE.registerRender(markerFn, 'fx');

            /* 复活倒计时：半透明 DOM 面板（居中大字号）+ 出生点画布提示。
             * 仅据点模式（无限命）会设置 global.CT_RESPAWN_T，其余模式不触发。 */
            const respawnFn = function (ctx) {
                const ENG = global.CT_ENGINE;
                const gs = ENG && ENG.gameState;
                const t = global.CT_RESPAWN_T;
                /* 复活倒计时 DOM 浮层由 HUD.init 注册的独立每帧 update 监听驱动
                 * （见 init 内的 ct-respawn-overlay 逻辑），此处仅保留出生点画布指示，
                 * 不再依赖一次性 fx 渲染回调创建面板，避免「阵亡后无倒计时面板」的问题。 */
                if (!gs || !t || t <= 0) return;
                const p = gs.player;
                const sp = p && (p.spawnPos || p.pos);
                if (!sp) return;
                const R = global.CT_RENDERER;
                const cam = (R && R.camera) || { x: 0, y: 0, zoom: 1 };
                const z = cam.zoom || 1;
                const sx = (sp.x - cam.x) * z;
                const sy = (sp.y - cam.y) * z;
                ctx.save();
                ctx.globalAlpha = 0.92;
                ctx.fillStyle = '#ff3860';
                ctx.shadowColor = '#ff3860';
                ctx.shadowBlur = 12;
                ctx.font = 'bold ' + Math.round(16 * z) + 'px "Share Tech Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText('复活中 ' + t.toFixed(1) + 's', sx, sy - 30 * z);
                ctx.restore();
            };
            global.CT_ENGINE.registerRender(respawnFn, 'fx');

            global.__ctPlayerMarkerReg = true;
        }

        /* 侦察无人机（P15）：玩家持有 mapReveal 临时增益期间揭示全图敌人位置。
         * 此前 P15 只 push 了 tempBuff / 设置了 mapRevealDuration，却没有任何消费方，
         * 导致「买了/捡了侦察无人机完全没有效果」—— 这里补上唯一的渲染消费层：
         *   · 屏内敌人 → 头顶红色菱形 + 脉动光环
         *   · 屏外敌人 → 视口边缘指向箭头
         * 增益到期由 tank.js 的 tempBuffs 每秒递减自动移除，无需额外清理。 */
        if (!global.__ctMapRevealReg && global.CT_ENGINE && typeof global.CT_ENGINE.registerRender === 'function') {
            const revealFn = function (ctx) {
                const ENG = global.CT_ENGINE;
                const gs = ENG && ENG.gameState;
                if (!gs) return;
                let p = gs.player;
                if ((!p || !p.alive) && gs.tanks) p = gs.tanks.find(t => t && t.alive && t.type === 'player');
                if (!p || !p.pos) return;

                /* 仅在 mapReveal 生效时绘制 */
                let reveal = 0;
                const tb = p.tempBuffs;
                if (Array.isArray(tb)) {
                    for (let i = 0; i < tb.length; i++) {
                        if (tb[i] && tb[i].type === 'mapReveal' && (tb[i].dur || 0) > 0) { reveal = tb[i].dur; break; }
                    }
                }
                if (!reveal && typeof p.mapRevealDuration === 'number' && p.mapRevealDuration > 0) {
                    reveal = p.mapRevealDuration;   // 兼容早期存档里未过期的旧字段
                }
                if (!reveal) return;

                const R = global.CT_RENDERER;
                const cam = (R && R.camera) || { x: 0, y: 0, zoom: 1 };
                const z = cam.zoom || 1;
                const vw = (R && R.viewport && R.viewport.w) || (ctx.canvas ? ctx.canvas.width : 0);
                const vh = (R && R.viewport && R.viewport.h) || (ctx.canvas ? ctx.canvas.height : 0);
                if (!vw || !vh) return;
                const t = (Date.now() % 900) / 900;
                const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
                const tanks = gs.tanks || [];

                ctx.save();
                for (let i = 0; i < tanks.length; i++) {
                    const e = tanks[i];
                    if (!e || !e.alive || !e.pos || e === p || e.type === 'player') continue;
                    const sx = (e.pos.x - cam.x) * z;
                    const sy = (e.pos.y - cam.y) * z;
                    if (sx >= 0 && sy >= 0 && sx <= vw && sy <= vh) {
                        /* 屏内：头顶红色菱形 + 脉动光环 */
                        ctx.save();
                        ctx.translate(sx, sy - 34 * z);
                        ctx.shadowColor = '#ff4040'; ctx.shadowBlur = 10;
                        ctx.lineWidth = 2;
                        ctx.strokeStyle = 'rgba(255,64,64,' + (0.55 + pulse * 0.45).toFixed(3) + ')';
                        ctx.beginPath();
                        ctx.moveTo(0, -9); ctx.lineTo(7, 0); ctx.lineTo(0, 9); ctx.lineTo(-7, 0);
                        ctx.closePath(); ctx.stroke();
                        ctx.strokeStyle = 'rgba(255,64,64,' + (0.35 - pulse * 0.25).toFixed(3) + ')';
                        ctx.beginPath(); ctx.arc(0, 0, 13 + pulse * 4, 0, Math.PI * 2); ctx.stroke();
                        ctx.restore();
                    } else {
                        /* 屏外：贴边指向箭头 */
                        const cx = vw / 2, cy = vh / 2;
                        let dx = sx - cx, dy = sy - cy;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        dx /= len; dy /= len;
                        const mx = vw / 2 - 26, my = vh / 2 - 26;
                        const k = Math.min(mx / (Math.abs(dx) || 1e-6), my / (Math.abs(dy) || 1e-6));
                        ctx.save();
                        ctx.translate(cx + dx * k, cy + dy * k);
                        ctx.rotate(Math.atan2(dy, dx));
                        ctx.fillStyle = 'rgba(255,64,64,' + (0.5 + pulse * 0.4).toFixed(3) + ')';
                        ctx.shadowColor = '#ff4040'; ctx.shadowBlur = 10;
                        ctx.beginPath();
                        ctx.moveTo(10, 0); ctx.lineTo(-7, -6); ctx.lineTo(-7, 6);
                        ctx.closePath(); ctx.fill();
                        ctx.restore();
                    }
                }
                ctx.restore();
            };
            global.CT_ENGINE.registerRender(revealFn, 'fx');
            global.__ctMapRevealReg = true;
        }
    };

    /* ---------- updateHud 周期更新 ----------
     * 参数可缺省：默认直接从 CT_ENGINE.gameState 读取玩家与状态，
     * 保证血条/护盾/技能/波次实时联动（此前调用方传 null 导致血条永不变化）。
     */
    /* ---------- P2 独立 HUD（本地双人） ----------
     * 镜像 P1 的「血条 + 护盾 + 技能冷却」三件套，放置于右上角，
     * 主题色取 P2 真实车型配色（state.p2.color，与菜单/duel.js 同一套 TANK_COLORS）。
     * 仅本地双人（state.p2Local）时存在；AI 对手不构建，避免与「敌方」概念混淆。 */
    function _buildP2Hud(state) {
        if (_dom.p2 || !state || !state.p2 || !_dom.root) return;
        const p2 = state.p2;
        const col = p2.color || '#ff2a6d';
        const tr = h('div', 'hud-glass hud-corner absolute top-4 right-4 px-4 py-3 pointer-events-auto w-fit min-w-0');
        // 角色头像（主题色描边）
        const tRow = h('div', 'flex items-center gap-3 mb-2.5 flex-row-reverse');
        const av = h('div', 'tank-avatar', '🚀');
        av.style.borderColor = col; av.style.boxShadow = '0 0 8px ' + col;
        const nameCol = h('div', 'flex-1 text-right');
        nameCol.appendChild(h('div', 'font-tech text-sm tracking-wider', 'PLAYER 2'));
        nameCol.appendChild(h('div', 'font-mono text-text-hi text-sm', (p2.name || 'P2') + ' · ' + (p2.tankClass || '').toUpperCase()));
        tRow.appendChild(av); tRow.appendChild(nameCol); tr.appendChild(tRow);
        // 血条
        const hpWrap = h('div', 'mb-2 relative');
        const hpBar = h('div', 'hud-bar');
        const hpFill = h('div', 'fill hp'); hpFill.style.width = '100%';
        hpBar.appendChild(hpFill);
        const hpTxt = h('div', 'absolute inset-0 flex items-center justify-center font-mono text-[12px] text-white font-bold tracking-widest', '100 / 100');
        hpTxt.style.textShadow = '0 0 6px rgba(0,0,0,.9)';
        hpWrap.appendChild(hpBar); hpWrap.appendChild(hpTxt); tr.appendChild(hpWrap);
        // 护盾（叠加在血条上 薄）
        const shWrap = h('div', 'mb-2 relative');
        const shBar = h('div', 'hud-bar'); shBar.style.height = '10px';
        const shFill = h('div', 'fill shield'); shFill.style.width = '0%';
        shBar.appendChild(shFill);
        const shTxt = h('div', 'absolute inset-0 flex items-center justify-center font-mono text-[10px] text-white', '🛡 SHIELD 0 / 50');
        shTxt.style.textShadow = '0 0 4px rgba(0,0,0,.8)';
        shWrap.appendChild(shBar); shWrap.appendChild(shTxt); tr.appendChild(shWrap);
        // 技能冷却
        const skWrap = h('div', 'relative');
        const skBar = h('div', 'hud-bar'); skBar.style.height = '10px';
        const skFill = h('div', 'fill skill'); skFill.style.width = '100%';
        skBar.appendChild(skFill);
        const skTxt = h('div', 'absolute inset-0 flex items-center justify-center font-tech text-[10px] text-glow-green font-bold', '⚡ READY');
        skWrap.appendChild(skBar); skWrap.appendChild(skTxt); tr.appendChild(skWrap);
        _dom.root.appendChild(tr);
        _dom.p2 = { hpFill: hpFill, hpTxt: hpTxt, shFill: shFill, shTxt: shTxt, skFill: skFill, skTxt: skTxt, card: tr };
    }

    function _updateP2Hud(p2) {
        if (!_dom.p2) return;
        if (_dom.p2.hpFill) {
            const pct = Math.max(0, p2.hp / (p2.maxHp || 100));
            _dom.p2.hpFill.style.width = (pct * 100).toFixed(1) + '%';
            if (_dom.p2.hpTxt) _dom.p2.hpTxt.textContent = Math.max(0, Math.ceil(p2.hp)) + ' / ' + (p2.maxHp || 100);
        }
        if (_dom.p2.shFill) {
            const sh = p2.shield || 0, maxSh = p2.maxShield || 50;
            _dom.p2.shFill.style.width = Math.max(0, sh / maxSh * 100).toFixed(1) + '%';
            if (_dom.p2.shTxt) _dom.p2.shTxt.textContent = '🛡 SHIELD ' + Math.max(0, Math.ceil(sh)) + ' / ' + maxSh;
        }
        if (_dom.p2.skFill) {
            const cd = (p2.skillCdNow || 0);
            const maxCd = (p2.skillCdMax || 6);
            if (cd <= 0) {
                _dom.p2.skFill.style.width = '100%';
                _dom.p2.skFill.classList.remove('cd');
                if (_dom.p2.skTxt) { _dom.p2.skTxt.textContent = '⚡ READY'; _dom.p2.skTxt.className = 'absolute inset-0 flex items-center justify-center font-tech text-[10px] text-glow-green font-bold'; }
            } else {
                const p = Math.max(0, 1 - cd / maxCd);
                _dom.p2.skFill.style.width = (p * 100).toFixed(1) + '%';
                _dom.p2.skFill.classList.add('cd');
                if (_dom.p2.skTxt) { _dom.p2.skTxt.textContent = '⏱ ' + cd.toFixed(1) + 's'; _dom.p2.skTxt.className = 'absolute inset-0 flex items-center justify-center font-mono text-[10px] text-white'; }
            }
        }
    }

    HUD.updateHud = function (dt, state, player, wave) {
        const gs = global.CT_ENGINE && global.CT_ENGINE.gameState;
        if (!state) state = gs;
        if (!player && state) player = state.player;
        // Player 数据（降级：state/player 为空则不动；否则更新）
        if (player) {
            if (_dom.hpFill) {
                const pct = Math.max(0, player.hp / (player.maxHp || 100));
                _dom.hpFill.style.width = (pct * 100).toFixed(1) + '%';
                if (_dom.hpTxt) _dom.hpTxt.textContent = Math.max(0, Math.ceil(player.hp)) + ' / ' + (player.maxHp || 100);
            }
            if (_dom.shFill) {
                const sh = player.shield || 0, maxSh = player.maxShield || 50;
                _dom.shFill.style.width = Math.max(0, sh / maxSh * 100).toFixed(1) + '%';
                if (_dom.shTxt) _dom.shTxt.textContent = '🛡 SHIELD ' + Math.max(0, Math.ceil(sh)) + ' / ' + maxSh;
            }
            if (_dom.skFill) {
                // Tank 实际字段：skillCdNow（剩余冷却）/ skillCdMax（冷却总长）
                const cd = (player.skillCdNow || 0);
                const maxCd = (player.skillCdMax || 6);
                if (cd <= 0) {
                    _dom.skFill.style.width = '100%';
                    _dom.skFill.classList.remove('cd');
                    if (_dom.skTxt) { _dom.skTxt.textContent = '⚡ READY'; _dom.skTxt.className = 'absolute inset-0 flex items-center justify-center font-tech text-[10px] text-glow-green font-bold'; }
                } else {
                    const p = Math.max(0, 1 - cd / maxCd);
                    _dom.skFill.style.width = (p * 100).toFixed(1) + '%';
                    _dom.skFill.classList.add('cd');
                    if (_dom.skTxt) { _dom.skTxt.textContent = '⏱ ' + cd.toFixed(1) + 's'; _dom.skTxt.className = 'absolute inset-0 flex items-center justify-center font-mono text-[10px] text-white'; }
                }
            }
            // 道具栏：实时渲染 player.inventory（1~5 键使用对应格）
            if (_dom.invSlots && _dom.invSlots.length) {
                const inv = Array.isArray(player.inventory) ? player.inventory : [];
                /* 新入格高亮：长度增加说明刚买入/获得道具，给新格一个 pop 动画，
                 * 玩家能立刻看出「东西进来了、在第几格」（此前买入后毫无视觉反馈） */
                if (inv.length > _lastInvLen && inv.length <= _dom.invSlots.length) {
                    const ns = _dom.invSlots[inv.length - 1];
                    if (ns) { ns.classList.remove('slot-pop'); void ns.offsetWidth; ns.classList.add('slot-pop'); }
                }
                _lastInvLen = inv.length;
                for (let i = 0; i < _dom.invSlots.length; i++) {
                    const slot = _dom.invSlots[i];
                    const it = inv[i];
                    if (it) {
                        const def = it.def || it;
                        /* 图标/名字优先取商店定义：道具入库的 def 来自 PowerupDefs，
                         * 它的 icon 是 '❤' 这种单字符；而商店里展示的是 emoji 🔴。
                         * 商店与道具栏用同一个图标，玩家才能把「刚买的」与「背包里那格」对上号。 */
                        const SD = (global.CT_SHOP && global.CT_SHOP.ITEMS && global.CT_SHOP.ITEMS[it.id]) || null;
                        const name = (SD && SD.name) || def.name || '道具';
                        const desc = (SD && SD.desc) || def.desc || '';
                        const icon = (SD && SD.icon) || def.emoji || def.icon || '📦';
                        slot.title = '[' + (i + 1) + '] ' + name + (desc ? ' — ' + desc : '');
                        slot.innerHTML = icon + '<span class="num">' + (i + 1) + '</span>';
                        slot.classList.add('has-item');
                    } else {
                        slot.title = '[' + (i + 1) + '] 空槽位';
                        slot.innerHTML = '<span class="num">' + (i + 1) + '</span>';
                        slot.classList.remove('has-item');
                    }
                }
                // 本局已生效（永久增益 / 装备）状态条：数据唯一来源是玩家身上的真实字段
                if (_dom.permStrip) {
                    const pb = Array.isArray(player.purchasedBuffs) ? player.purchasedBuffs : [];
                    const eq = Array.isArray(player.equipments) ? player.equipments : [];
                    if (!pb.length && !eq.length) {
                        if (_dom.permStrip.style.display !== 'none') _dom.permStrip.style.display = 'none';
                    } else {
                        const cnt = {};
                        for (let i = 0; i < pb.length; i++) cnt[pb[i]] = (cnt[pb[i]] || 0) + 1;
                        const IT = (global.CT_SHOP && global.CT_SHOP.ITEMS) ? global.CT_SHOP.ITEMS : {};
                        let html = '';
                        Object.keys(cnt).forEach((id) => {
                            const d = IT[id] || {};
                            const tip = (d.name || id) + ' × ' + cnt[id] + (d.desc ? ' — ' + d.desc : '');
                            html += '<span class="ct-perm-chip" title="' + tip.replace(/"/g, '&quot;') + '">' + (d.icon || '✦') + '<b>' + cnt[id] + '</b></span>';
                        });
                        for (let i = 0; i < eq.length; i++) {
                            const d = IT[eq[i]] || {};
                            const tip = (d.name || eq[i]) + (d.desc ? ' — ' + d.desc : '');
                            html += '<span class="ct-perm-chip" title="' + tip.replace(/"/g, '&quot;') + '">' + (d.icon || '🔩') + '</span>';
                        }
                        _dom.permStrip.innerHTML = html;
                        if (_dom.permStrip.style.display === 'none') _dom.permStrip.style.display = 'flex';
                    }
                }
            }
        }

        // P2 独立 HUD（本地双人）：与 P1 同步刷新血条/护盾/技能条
        try {
            if (state && state.p2Local && state.p2) {
                if (!_dom.p2) _buildP2Hud(state);
                if (_dom.p2) _updateP2Hud(state.p2);
            }
        } catch (_) {}

        // （雷达已按需求移除）

        // 左下 分数/连击/波次
        if (state) {
            if (_dom.scoreTxt && state.score != null) _dom.scoreTxt.textContent = Number(state.score).toLocaleString();
            if (_dom.comboTxt && state.combo != null) _dom.comboTxt.textContent = 'x' + (Number(state.combo).toFixed(1));
            if (_dom.waveTxt) {
                const cur = wave || state.wave || 1;
                /* 波次显示按模式分支（req4：左下波次信息按当前模式合理适配）：
                 * - 无尽（horde）→ 无限符号 ∞
                 * - 1v1（duel）→ BO5 局数
                 * - 据点争夺（kinghill）→ 3 小节
                 * - 据点守护（kingdefend）→ 无尽防御波，显示 cur / ∞
                 * - 大逃杀（royale）→ 无波次概念，显示生存标记 */
                const m = HUD._mode || '';
                if (m === 'horde' || m === 'endless') {
                    _dom.waveTxt.textContent = cur + ' / ∞';
                } else if (m === 'duel') {
                    // 1v1：左下显示双方局分（BO5），不再显示“波次”
                    const p1s = (state.p1 && state.p1.score) || 0;
                    const p2s = (state.p2 && state.p2.score) || 0;
                    _dom.waveTxt.textContent = 'P1 ' + p1s + ' : ' + p2s + ' P2';
                } else if (m === 'kinghill') {
                    _dom.waveTxt.textContent = cur + ' / 3';
                } else if (m === 'kingdefend') {
                    _dom.waveTxt.textContent = cur + ' / ∞';
                } else if (m === 'royale') {
                    _dom.waveTxt.textContent = '∞';
                } else {
                    const max = state.maxWave || 20;
                    _dom.waveTxt.textContent = cur + ' / ' + max;
                }
                // 波次标签随模式语义变化（WAVE / SECTION / ROUND / SURVIVE）
                if (_dom.waveLabel) {
                    const lbl = (m === 'kinghill') ? 'SECTION'
                        : (m === 'duel') ? 'SCORE'
                        : (m === 'royale') ? 'SURVIVE'
                        : 'WAVE';
                    if (_dom.waveLabel.textContent !== lbl) _dom.waveLabel.textContent = lbl;
                }
            }

            // 据点核心耐久条（仅「据点守护」模式显示，req3/req4）
            if (_dom.baseWrap) {
                if (HUD._mode === 'kingdefend' && state && state.baseHp != null) {
                    _dom.baseWrap.style.display = 'block';
                    const bp = Math.max(0, Math.min(1, state.baseHp / (state.baseMaxHp || 100)));
                    _dom.baseFill.style.width = (bp * 100).toFixed(1) + '%';
                    if (_dom.baseTxt) _dom.baseTxt.textContent = Math.max(0, Math.ceil(state.baseHp)) + ' / ' + (state.baseMaxHp || 100);
                } else {
                    _dom.baseWrap.style.display = 'none';
                }
            }
        }

        // BOSS 血条
        if (_dom.bossWrap) {
            const boss = (state && state.activeBoss) || (global.CT_ENTITY_BOSS && global.CT_ENTITY_BOSS.active);
            if (boss) {
                _dom.bossWrap.style.display = 'block';
                const fill = boss.hp / (boss.maxHp || 1);
                _dom.bossFill.style.width = Math.max(0, fill * 100).toFixed(1) + '%';
                const pt = document.getElementById('boss-phase-txt');
                if (pt) {
                    const phase = boss.phase || (fill > 0.66 ? 1 : fill > 0.33 ? 2 : 3);
                    pt.textContent = 'PHASE ' + phase + ' / 3';
                }
            } else {
                _dom.bossWrap.style.display = 'none';
            }
        }

        // 增益栏由 buff-ui 监听 buff:changed 事件自渲染（此前误引用不存在的
        // HUD_BUFF_BAR 全局 —— 死代码，已删除）
    };

    global.CT_UI_HUD = HUD;
})(typeof window !== 'undefined' ? window : globalThis);

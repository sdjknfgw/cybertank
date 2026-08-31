/* ==========================================================
 * CyberTank — 结算界面
 * window.CT_UI_RESULT
 * ========================================================== */
(function (global) {
    'use strict';
    const BUS = global.CT_BUS || { emit() {}, on() {} };
    /* 轻量 kv 存储：localStorage 直读直写。
     * CT_STORAGE 的 get() 无参且返回整个存档对象、没有 set(k,v) 方法，
     * 此前 `global.CT_STORAGE || {kv 兜底}` 必走 CT_STORAGE，
     * 导致结算时 STORE.set('coins',...) 抛 TypeError、整个结算界面渲染中断
     * （"无法正常结束返回主页"的根因）。 */
    const STORE = {
        get(k, d) { try { const v = localStorage.getItem('ct_' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
        set(k, v) { try { localStorage.setItem('ct_' + k, JSON.stringify(v)); } catch (_) {} }
    };
    const RESULT = {};
    let _style = false;

    function inj() {
        if (_style) return; _style = true;
        const s = document.createElement('style');
        s.textContent =
            '.res-backdrop{position:fixed;inset:0;z-index:700;background:rgba(0,0,0,0.82);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);animation:fadeIn .35s ease both}' +
            '.res-wrap{position:fixed;inset:0;z-index:701;display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto}' +
            '.res-card{position:relative;width:min(960px,100%);background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:18px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 20px 80px rgba(0,0,0,.65);padding:32px;animation:scaleIn .45s cubic-bezier(.34,1.56,.64,1) both;overflow:hidden}' +
            '.res-card::before,.res-card::after{content:"";position:absolute;width:22px;height:22px;border-style:solid;pointer-events:none;filter:drop-shadow(0 0 6px currentColor)}' +
            '.res-card::before{top:-1px;left:-1px;border-width:2px 0 0 2px;border-top-left-radius:16px;color:var(--neon-cyan);border-color:currentColor}' +
            '.res-card::after{bottom:-1px;right:-1px;border-width:0 2px 2px 0;border-bottom-right-radius:16px;color:var(--neon-magenta);border-color:currentColor}' +
            '.res-vic-title{font-family:"Share Tech Mono",monospace;font-size:clamp(48px,9vw,110px);font-weight:800;letter-spacing:.14em;color:var(--coin-gold);text-shadow:0 0 18px rgba(255,201,60,.9),0 0 44px rgba(255,201,60,.5),0 0 100px rgba(255,201,60,.25);line-height:1;text-align:center;animation:glitchVic 3s infinite}' +
            '@keyframes glitchVic{0%,90%,100%{transform:none;filter:none}91%{transform:translate(-3px,2px) skewX(-1deg);filter:hue-rotate(8deg)}93%{transform:translate(3px,-2px) skewX(1deg);filter:hue-rotate(-6deg)}95%{transform:translate(-2px,-3px)}97%{transform:translate(2px,3px)}}' +
            '.res-def-title{font-family:"Share Tech Mono",monospace;font-size:clamp(48px,9vw,110px);font-weight:800;letter-spacing:.14em;color:#ff1744;text-shadow:0 0 18px rgba(255,23,68,.9),0 0 44px rgba(255,23,68,.5);line-height:1;text-align:center;animation:glitchDef 3s infinite}' +
            '@keyframes glitchDef{0%,90%,100%{transform:none;filter:none}91%{transform:translate(3px,-2px);filter:hue-rotate(-10deg)}93%{transform:translate(-3px,2px);filter:hue-rotate(12deg)}95%{transform:translate(2px,3px)}97%{transform:translate(-2px,-3px)}}' +
            '.res-sub{font-family:"Share Tech Mono",monospace;font-size:clamp(14px,1.5vw,18px);letter-spacing:.45em;text-align:center;margin-top:10px}' +
            '.res-sub.vic{color:var(--neon-cyan);text-shadow:0 0 10px rgba(0,229,255,.85)}' +
            '.res-sub.def{color:#ff7a8c;text-shadow:0 0 10px rgba(255,122,140,.7)}' +
            '.res-stat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:30px 0}' +
            '@media (max-width:640px){.res-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
            '.res-stat{position:relative;padding:16px;background:rgba(12,18,40,.6);border:1px solid rgba(0,229,255,.22);border-radius:12px;overflow:hidden;box-shadow:0 0 10px rgba(0,229,255,.15),inset 0 1px 0 rgba(255,255,255,.04);transition:transform .18s ease}' +
            '.res-stat:hover{transform:translateY(-2px);box-shadow:0 0 16px rgba(0,229,255,.35)}' +
            '.res-stat::before{content:"";position:absolute;top:0;left:0;width:10px;height:10px;border-top:2px solid var(--neon-cyan);border-left:2px solid var(--neon-cyan);border-top-left-radius:10px;filter:drop-shadow(0 0 4px var(--neon-cyan))}' +
            '.res-stat::after{content:"";position:absolute;bottom:0;right:0;width:10px;height:10px;border-bottom:2px solid var(--neon-magenta);border-right:2px solid var(--neon-magenta);border-bottom-right-radius:10px;filter:drop-shadow(0 0 4px var(--neon-magenta))}' +
            '.res-stat-label{font-family:"Share Tech Mono",monospace;font-size:11px;color:var(--text-lo);letter-spacing:.25em;margin-bottom:6px}' +
            '.res-stat-value{font-family:"JetBrains Mono",monospace;font-size:clamp(22px,3vw,32px);font-weight:800;color:var(--coin-gold);text-shadow:0 0 8px rgba(255,201,60,.65)}' +
            '.res-rating-wrap{display:flex;flex-direction:column;align-items:center;margin:28px 0 16px;position:relative}' +
            '.res-rating{position:relative;width:150px;height:150px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:"Share Tech Mono",monospace;font-size:88px;font-weight:800;animation:ratingIn .7s cubic-bezier(.34,1.56,.64,1) both}' +
            '@keyframes ratingIn{0%{transform:scale(0) rotate(-120deg);opacity:0}100%{transform:scale(1) rotate(0);opacity:1}}' +
            '.res-rating::after{content:"";position:absolute;inset:-18px;border-radius:50%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.3),transparent);animation:shine 2s linear infinite}' +
            '.res-rating.S{background:radial-gradient(circle at 30% 30%,#fff9d4,#ffc93c 45%,#b8860b);color:#3a2900;text-shadow:0 2px 4px rgba(255,255,255,.6);box-shadow:0 0 30px rgba(255,201,60,.8),inset 0 0 30px rgba(255,255,255,.3)}' +
            '.res-rating.S::before{content:"";position:absolute;inset:-28px;border-radius:50%;background:conic-gradient(from 0deg,transparent,rgba(255,201,60,.5),transparent);animation:spin 2s linear infinite}' +
            '@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}' +
            '.res-rating.A{background:radial-gradient(circle at 30% 30%,#f3e7ff,#a855f7 45%,#6b21a8);color:#fff;text-shadow:0 2px 4px rgba(0,0,0,.4);box-shadow:0 0 26px rgba(168,85,247,.7),inset 0 0 24px rgba(255,255,255,.25)}' +
            '.res-rating.B{background:radial-gradient(circle at 30% 30%,#b9f7ff,#00e5ff 45%,#008394);color:#002630;text-shadow:0 2px 4px rgba(255,255,255,.5);box-shadow:0 0 24px rgba(0,229,255,.65),inset 0 0 22px rgba(255,255,255,.2)}' +
            '.res-rating.C{background:radial-gradient(circle at 30% 30%,#fff,#a9b7d1 45%,#4a5570);color:#141a2a;text-shadow:0 2px 4px rgba(255,255,255,.6);box-shadow:0 0 18px rgba(169,183,209,.5),inset 0 0 18px rgba(255,255,255,.2)}' +
            '.res-rating.D{background:radial-gradient(circle at 30% 30%,#999,#6b7280 45%,#2f3440);color:#e5e7eb;text-shadow:0 2px 4px rgba(0,0,0,.5);box-shadow:0 0 14px rgba(107,114,128,.4);filter:grayscale(.4)}' +
            '.res-reward{display:flex;align-items:center;justify-content:center;gap:14px;padding:12px 28px;border-radius:999px;background:linear-gradient(90deg,rgba(255,201,60,.12),rgba(255,201,60,.04));border:1px solid rgba(255,201,60,.45);box-shadow:0 0 18px rgba(255,201,60,.35),inset 0 0 16px rgba(255,201,60,.1);margin:14px auto 4px;animation:coinPulse 1.4s ease-in-out infinite;width:max-content;max-width:100%}' +
            '.res-reward .coin{font-size:30px;filter:drop-shadow(0 0 10px rgba(255,201,60,.8))}' +
            '.res-reward .num{font-family:"JetBrains Mono",monospace;font-size:30px;font-weight:800;color:var(--coin-gold);text-shadow:0 0 10px rgba(255,201,60,.8)}' +
            '.coin-fly{position:fixed;z-index:9999;font-size:28px;pointer-events:none;animation:coinFly 1.1s cubic-bezier(.4,0,.2,1) forwards;filter:drop-shadow(0 0 10px rgba(255,201,60,.9))}' +
            '@keyframes coinFly{0%{transform:translate(-50%,-50%) scale(.6) rotate(0);opacity:0}15%{opacity:1;scale:1.2}60%{scale:1}100%{transform:translate(calc(50vw - 50%),calc(-50vh + 60px)) scale(.3) rotate(540deg);opacity:0}}' +
            '.res-btns{display:flex;gap:14px;justify-content:center;margin-top:24px;flex-wrap:wrap}' +
            '.scan-cover{position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:16px}' +
            '.scan-cover::after{content:"";position:absolute;left:0;right:0;height:80px;background:linear-gradient(180deg,transparent,rgba(0,229,255,.1),transparent);animation:scanLine 4s linear infinite}' +
            '.holo-overlay{position:absolute;inset:0;background-image:repeating-linear-gradient(45deg,rgba(0,229,255,.06) 0,rgba(0,229,255,.06) 4px,transparent 4px,transparent 8px,rgba(255,43,214,.05) 8px,rgba(255,43,214,.05) 12px,transparent 12px,transparent 16px);pointer-events:none;mix-blend-mode:overlay;opacity:.6}';
        document.head.appendChild(s);
    }

    function h(tag, cls, txt) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (txt != null) { if (typeof txt === 'string' && txt.includes('<')) el.innerHTML = txt; else el.textContent = txt; }
        return el;
    }

    /* ---------- calcRating ----------
     * 评级梯度：依据「任务完成度 progress（0~1）」+ 胜负给出 S/A/B/C/D。
     * progress 由各模式在 _gameOver 时按自身目标计算（波次进度 / 占点时长 /
     * 局数 / 存活排名等）；未提供时按 score 估算兜底。 */
    RESULT.calcRating = function (stats) {
        stats = stats || {};
        const victory = !!stats.victory;
        const s = Number(stats.score || 0);
        const d = Number(stats.deaths || 0);
        let prog = (typeof stats.progress === 'number' && isFinite(stats.progress)) ? stats.progress : null;
        if (prog == null) {
            // 兜底：无 progress 时用分数粗略估算（0~1）
            prog = Math.max(0, Math.min(1, s / 60000));
        }
        prog = Math.max(0, Math.min(1, prog));

        if (victory) {
            if (prog >= 0.99) return 'S';   // 近乎完美通关
            if (prog >= 0.70) return 'A';   // 高质量胜利
            if (prog >= 0.40) return 'B';   // 普通胜利
            return 'C';                     // 勉强获胜
        }
        // 战败：按「完成了多少」给梯度，避免一刀切 D
        if (prog >= 0.75) return 'B';       // 差一步胜利
        if (prog >= 0.50) return 'C';       // 完成过半
        if (prog >= 0.25) return 'D';       // 有实质推进
        return 'D';                         // 开场即败 / 全程被动
    };

    /* ---------- show ---------- */
    RESULT.show = function (opts) {
        inj();
        opts = opts || {};
        let { victory = false, stats = {}, rating = null, rewardsCoins = 0, mode = 'horde' } = opts;
        /* 让评级能感知胜负：把 victory 并入 stats */
        stats = Object.assign({}, stats);
        stats.victory = !!victory;
        const root = document.getElementById('result-ui-root');
        if (!root) return;
        root.classList.remove('hidden');
        root.innerHTML = '';

        const finalRating = rating || RESULT.calcRating(stats);

        // 遮罩
        const backdrop = h('div', 'res-backdrop');
        root.appendChild(backdrop);

        const wrap = h('div', 'res-wrap');
        const card = h('div', 'res-card');
        card.appendChild(h('div', 'holo-overlay'));
        card.appendChild(h('div', 'scan-cover'));

        // 标题
        const titleBox = h('div');
        if (victory) {
            titleBox.appendChild(h('div', 'res-vic-title', 'VICTORY'));
            titleBox.appendChild(h('div', 'res-sub vic', 'S U C C E S S   ·   作 战 胜 利'));
        } else {
            titleBox.appendChild(h('div', 'res-def-title', 'DEFEATED'));
            titleBox.appendChild(h('div', 'res-sub def', 'S Y S T E M   F A I L U R E   ·   作 战 失 败'));
        }
        card.appendChild(titleBox);

        // 统计 6 张卡片
        const grid = h('div', 'res-stat-grid');
        const kills = Number(stats.kills || 0);
        const acc = (typeof stats.accuracy === 'number' ? stats.accuracy : (stats.hits ? Math.min(100, (stats.hits / Math.max(1, stats.shots || 1)) * 100) : 0));
        const combo = Number(stats.maxCombo || 0);
        const secs = Number(stats.surviveTime || 0);
        const ms = Math.round(secs * 1000);
        const timeStr = secs >= 60 ? (secs / 60).toFixed(2) + ' m' : secs.toFixed(1) + ' s';
        const score = Number(stats.score || 0);
        const buffsUsed = Number(stats.buffsUsed || 0);
        const rows = [
            { label: '击 杀 数 KILLS',        value: kills.toString() },
            { label: '命 中 率 ACC',          value: acc.toFixed(0) + '%' },
            { label: '最高连击 MAX COMBO',    value: 'x' + combo.toFixed(1) },
            { label: '存活时长 SURVIVE',      value: timeStr, sub: ms + 'ms', subClass: 'text-[10px] text-text-lo mt-1' },
            { label: '总 得 分 SCORE',        value: score.toLocaleString() },
            { label: '增益使用 BUFFS',        value: buffsUsed.toString() }
        ];
        rows.forEach((r) => {
            const el = h('div', 'res-stat');
            el.appendChild(h('div', 'res-stat-label', r.label));
            el.appendChild(h('div', 'res-stat-value', r.value));
            if (r.sub) el.appendChild(h('div', r.subClass || 'text-[10px] text-text-lo mt-1', r.sub));
            grid.appendChild(el);
        });
        card.appendChild(grid);

        // 评级
        const rw = h('div', 'res-rating-wrap');
        rw.appendChild(h('div', 'font-tech text-text-lo tracking-[0.4em] text-xs mb-3', 'R A T I N G'));
        const rc = h('div', 'res-rating ' + finalRating, finalRating);
        rw.appendChild(rc);
        rw.appendChild(h('div', 'mt-4 font-mono text-text-mid text-sm', ratingDesc(finalRating)));
        card.appendChild(rw);

        /* 局外金币系统已移除：不再展示/累计金币奖励 */

        // 保存最佳纪录
        const bestKey = {
            royale: 'ct_best_royale', 'battle-royale': 'ct_best_royale',
            kinghill: 'ct_best_kh', 'king-hill': 'ct_best_kh',
            horde: 'ct_best_horde', endless: 'ct_best_horde',
            duel: 'ct_best_duel', kingdefend: 'ct_best_kd'
        }[mode] || 'ct_best_horde';
        const prevBest = STORE.get(bestKey, 0) | 0;
        if (score > prevBest) STORE.set(bestKey, score);

        // 底部按钮
        const btns = h('div', 'res-btns');

        // 继续战斗（直接以相同模式 / 地图 / 玩法重开，不回工坊）
        const again = h('button', 'ct-neon-btn btn-primary !px-10 !h-14 !text-lg font-tech tracking-wider', '🔄 继续战斗');
        again.addEventListener('click', () => {
            RESULT.close();
            const last = global.CT_LAST_MODE_OPTS || { mode: mode, tank: undefined, skin: undefined, difficulty: undefined };
            const H = global.CT_UI_HUD;
            if (H && typeof H.startGame === 'function') {
                H.startGame(last.mode, last.tank, last.skin, last.difficulty, last.opponent, last.p2Tank);
            } else if (global.CT_UI_MENU && typeof global.CT_UI_MENU.renderTankWorkshop === 'function') {
                const hud = document.getElementById('game-hud-wrap');
                if (hud) hud.classList.add('hidden');
                global.CT_UI_MENU.renderTankWorkshop(mode);
            }
        });
        btns.appendChild(again);

        // 更换坦克 / 皮肤后仍保持当前模式
        const retank = h('button', 'ct-neon-btn btn-ghost !px-8 !h-14', '🎛 更换坦克');
        retank.addEventListener('click', () => {
            RESULT.close();
            if (global.CT_UI_MENU && typeof global.CT_UI_MENU.renderTankWorkshop === 'function') {
                const hud = document.getElementById('game-hud-wrap');
                if (hud) hud.classList.add('hidden');
                global.CT_UI_MENU.renderTankWorkshop(mode);
            }
        });
        btns.appendChild(retank);

        const home = h('button', 'ct-neon-btn btn-ghost !px-8 !h-14', '🏠 返回主菜单');
        home.addEventListener('click', () => {
            /* 优先用统一退出流程（停止模式/清引擎状态/隐藏战斗 UI），降级为旧行为 */
            if (typeof global.CT_EXIT_TO_MENU === 'function') {
                try { global.CT_EXIT_TO_MENU(); return; } catch (e) { /* 降级 */ }
            }
            RESULT.close();
            const hud = document.getElementById('game-hud-wrap');
            if (hud) hud.classList.add('hidden');
            if (global.CT_UI_MENU && typeof global.CT_UI_MENU.renderMainMenu === 'function') {
                global.CT_UI_MENU.renderMainMenu();
            } else {
                BUS && BUS.emit && BUS.emit('ui:showMainMenu');
            }
        });
        btns.appendChild(home);

        const share = h('button', 'ct-neon-btn btn-ghost !px-8 !h-14', '📢 分享');
        share.disabled = true;
        share.title = '功能开发中 (P2 版本)';
        btns.appendChild(share);
        card.appendChild(btns);

        wrap.appendChild(card);
        root.appendChild(wrap);
        BUS && BUS.emit && BUS.emit('ui:resultShown', { victory, stats, rating: finalRating, rewardsCoins });
    };

    /* ---------- close ---------- */
    RESULT.close = function () {
        const root = document.getElementById('result-ui-root');
        if (!root) return;
        root.classList.add('hidden');
        root.innerHTML = '';
    };

    function ratingDesc(r) {
        return {
            S: '完美表现！毫发无伤完成 · 传奇级别指挥',
            A: '卓越战绩！操作极佳，伤亡控制优秀',
            B: '稳健发挥，值得肯定的表现',
            C: '顺利完成任务，仍有提升空间',
            D: '任务失败，整理装备再来一次！'
        }[r] || '';
    }

    global.CT_UI_RESULT = RESULT;
})(typeof window !== 'undefined' ? window : globalThis);

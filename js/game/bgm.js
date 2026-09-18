/* ==========================================================
 * CyberTank — bgm.js  主题化自适应背景音乐
 *
 * 设计目标（"符合这个游戏"）：
 *   - 音源全部为 Web Audio 实时合成，零素材体积、秒开、可无限循环
 *   - 三套主题与玩法状态一一对应：
 *       menu   《霓虹待机》 88 BPM  半速 synthwave —— 主菜单 / 备战期 / 波次间隙
 *       battle 《钢铁洪流》128 BPM  darksynth    —— 正式交战
 *       boss   《暴君降临》152 BPM  工业推进      —— BOSS 出场，随阶段三档升级
 *   - 音色取向对齐游戏视觉：青(#00E5FF)冷冽 pad、洋红(#FF2A6D)锋利 lead、
 *     金(#FFD700)只留给 BOSS 的警报层
 *   - 音量/静音复用 CT_AUDIO 的 bgm 通道，设置面板滑块直接生效
 *
 * 对外接口：global.CT_BGM
 *   start(themeId) / stop() / setTheme(id) / setIntensity(v)
 *   setBossPhase(n) / getState() / THEMES
 *   renderTheme(themeId, seconds[, opts]) -> Promise<AudioBuffer>   （离线试听/校验）
 *   encodeWav(audioBuffer) -> Uint8Array                            （导出试听样带）
 * ========================================================== */
(function (global) {
    'use strict';

    /* ==========================================================
     * 0. 基础工具
     * ========================================================== */
    /** MIDI 音高 → 频率（A4 = 69 = 440Hz） */
    function mtof(n) { return 440 * Math.pow(2, (n - 69) / 12); }

    function clamp01(v) { v = +v; if (!isFinite(v)) return 0; return v < 0 ? 0 : (v > 1 ? 1 : v); }

    /** 生成白噪声 buffer（合成鼓组用） */
    function noiseBuffer(ctx, dur) {
        const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
        return buf;
    }

    /** 节点用完自动断开，避免长局内节点堆积 */
    function autoClean(nodes) {
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (!n) continue;
            n.onended = function () {
                for (let k = 0; k < nodes.length; k++) {
                    try { nodes[k].disconnect(); } catch (_) { }
                }
            };
        }
    }

    /* ==========================================================
     * 1. 乐谱数据
     *    pattern 均为 16 分音符（每小节 16 步）
     *    -1 / 0 视音轨语义为"休止"；鼓组用力度值，音高轨用和弦索引
     * ========================================================== */

    /** 战斗主旋律（A 小调五声），intensity 高时才出现 */
    const BATTLE_LEAD = [
        69, -1, -1, 72, -1, 76, -1, -1, 74, -1, 73, -1, 72, -1, -1, -1
    ];

    /** BOSS 半音下行 lead（第 1 阶段起） */
    const BOSS_LEAD = [
        81, -1, 80, -1, 78, -1, 77, -1, 76, -1, 75, -1, 74, -1, 73, -1
    ];

    const THEMES = {
        /* ---------- 主菜单 / 备战：冷冽、克制、留白 ---------- */
        menu: {
            id: 'menu',
            name: '霓虹待机',
            en: 'Neon Standby',
            bpm: 88,
            mood: '冷冽 · 期待',
            palette: '#00E5FF',
            desc: '半速 synthwave。宽 pad 铺霓虹夜空，稀疏底鼓像远处炮击，',
            chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], // Am F C G
            roots: [45, 41, 36, 43],
            sub: 1,
            kick: [9, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0],
            hat: [0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0],
            arp: [0, -1, 1, -1, 2, -1, 1, -1, 0, -1, 1, -1, 2, -1, 1, -1],
            padLevel: 0.10
        },

        /* ---------- 正式交战：推进感、硬朗、鼓组驱动 ---------- */
        battle: {
            id: 'battle',
            name: '钢铁洪流',
            en: 'Rolling Steel',
            bpm: 128,
            mood: '推进 · 硬朗',
            palette: '#FF2A6D',
            desc: 'darksynth。四踩底鼓 + 军鼓行进 + 十六分锯齿贝斯，',
            chords: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 56, 59]], // Am G F E
            roots: [45, 43, 41, 40],
            kick: [9, 0, 0, 0, 8, 0, 0, 0, 9, 0, 0, 0, 8, 0, 0, 0],
            snare: [0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0],
            hat: [5, 3, 7, 3, 5, 3, 7, 3, 5, 3, 7, 3, 5, 3, 7, 3],
            bass: [0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 1, -1, 0, -1], // 0=根音 1=五度
            arp: [0, 1, 2, 1, 3, 2, 1, 2, 0, 1, 2, 1, 3, 2, 1, 2],
            lead: BATTLE_LEAD,
            leadFrom: 0.55,
            clapFrom: 0.85,
            padLevel: 0.05
        },

        /* ---------- BOSS：压迫、半音下行、随阶段加压 ---------- */
        boss: {
            id: 'boss',
            name: '暴君降临',
            en: 'Tyrant Descent',
            bpm: 152,
            mood: '压迫 · 失控',
            palette: '#FFD700',
            desc: '工业推进。半音下行 ostinato + 双踩，阶段越高层数越满，',
            chords: [[57, 60, 64], [56, 59, 63], [55, 58, 62], [54, 57, 61]], // Am G#m Gm F#m
            roots: [45, 44, 43, 42],
            kick: [9, 0, 7, 0, 9, 0, 7, 0, 9, 0, 7, 0, 9, 0, 7, 0],
            snare: [0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0],
            hat: [6, 4, 8, 4, 6, 4, 8, 4, 6, 4, 8, 4, 6, 4, 8, 8],
            bass: [0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 1, -1],
            lead: BOSS_LEAD,
            leadFrom: 0,        // 阶段 1 起
            alarmFrom: 1,       // 阶段 2 起加警报层
            padLevel: 0.09
        }
    };

    /* ==========================================================
     * 2. 音色（单音器 + 短包络，全部返回节点数组便于回收）
     * ========================================================== */

    /** 底鼓：正弦下滑 + 快速衰减 */
    function vKick(ctx, out, t, v) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
        g.gain.setValueAtTime(1e-5, t);
        g.gain.linearRampToValueAtTime(0.80 * v, t + 0.004);
        g.gain.exponentialRampToValueAtTime(1e-5, t + 0.20);
        o.connect(g).connect(out);
        o.start(t); o.stop(t + 0.24);
        return [o, g];
    }

    /** 军鼓：带通噪声 + 一点体声 */
    function vSnare(ctx, out, t, v) {
        const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.24);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = 1700; bp.Q.value = 0.8;
        const g = ctx.createGain();
        g.gain.setValueAtTime(1e-5, t);
        g.gain.linearRampToValueAtTime(0.42 * v, t + 0.005);
        g.gain.exponentialRampToValueAtTime(1e-5, t + 0.19);
        src.connect(bp).connect(g).connect(out);
        src.start(t); src.stop(t + 0.22);

        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(210, t);
        o.frequency.exponentialRampToValueAtTime(160, t + 0.06);
        og.gain.setValueAtTime(1e-5, t);
        og.gain.linearRampToValueAtTime(0.16 * v, t + 0.004);
        og.gain.exponentialRampToValueAtTime(1e-5, t + 0.10);
        o.connect(og).connect(out);
        o.start(t); o.stop(t + 0.12);
        return [src, bp, g, o, og];
    }

    /** 闭合 hi-hat：高通噪声短促点 */
    function vHat(ctx, out, t, v, bright) {
        const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.07);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
        hp.frequency.value = bright ? 9000 : 6800;
        const g = ctx.createGain();
        g.gain.setValueAtTime(1e-5, t);
        g.gain.linearRampToValueAtTime(0.11 * v, t + 0.002);
        g.gain.exponentialRampToValueAtTime(1e-5, t + 0.055);
        src.connect(hp).connect(g).connect(out);
        src.start(t); src.stop(t + 0.07);
        return [src, hp, g];
    }

    /** 贝斯：锯齿 + 低通，短促有颗粒 */
    function vBass(ctx, out, t, f, dur, v) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
        lp.frequency.setValueAtTime(900, t);
        lp.frequency.exponentialRampToValueAtTime(320, t + dur * 0.9);
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 0.985, t + dur);
        g.gain.setValueAtTime(1e-5, t);
        g.gain.linearRampToValueAtTime(0.26 * v, t + 0.008);
        g.gain.exponentialRampToValueAtTime(1e-5, t + dur * 0.95);
        o.connect(lp).connect(g).connect(out);
        o.start(t); o.stop(t + dur + 0.02);
        return [o, lp, g];
    }

    /** 琶音：方波/三角 + 高通，清脆电子感 */
    function vArp(ctx, out, t, f, dur, v, soft) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420;
        o.type = soft ? 'triangle' : 'square';
        o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(1e-5, t);
        g.gain.linearRampToValueAtTime((soft ? 0.10 : 0.085) * v, t + 0.006);
        g.gain.exponentialRampToValueAtTime(1e-5, t + dur * 0.95);
        o.connect(hp).connect(g).connect(out);
        o.start(t); o.stop(t + dur + 0.02);
        return [o, hp, g];
    }

    /** Pad：两枚细失谐正弦 + 慢 LFO，跨越小节（霓虹空气层） */
    function vPad(ctx, out, t, freqs, dur, v) {
        const nodes = [];
        for (let i = 0; i < freqs.length; i++) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
            o.type = 'sine';
            o.frequency.setValueAtTime(freqs[i], t);
            o.detune.value = (i % 2 === 0) ? -6 : 7;

            const lfo = ctx.createOscillator(), lg = ctx.createGain();
            lfo.frequency.value = 0.16 + i * 0.07;
            lg.gain.value = 4;
            lfo.connect(lg).connect(o.detune);

            g.gain.setValueAtTime(1e-5, t);
            g.gain.linearRampToValueAtTime(v, t + 0.55);
            g.gain.setValueAtTime(v, t + dur - 0.55);
            g.gain.exponentialRampToValueAtTime(1e-5, t + dur);
            o.connect(lp).connect(g).connect(out);
            o.start(t); o.stop(t + dur + 0.03);
            lfo.start(t); lfo.stop(t + dur + 0.03);
            nodes.push(o, lp, g, lfo, lg);
        }
        return nodes;
    }

    /** Lead：明亮锯齿短音（洋红锋利感） */
    function vLead(ctx, out, t, f, dur, v) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.setValueAtTime(3200, t);
        lp.frequency.exponentialRampToValueAtTime(1400, t + dur);
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(1e-5, t);
        g.gain.linearRampToValueAtTime(0.13 * v, t + 0.012);
        g.gain.exponentialRampToValueAtTime(1e-5, t + dur * 0.95);
        o.connect(lp).connect(g).connect(out);
        o.start(t); o.stop(t + dur + 0.02);
        return [o, lp, g];
    }

    /** 拍手：中频噪声，用于高强度层 */
    function vClap(ctx, out, t, v) {
        const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.22);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = 2100; bp.Q.value = 1.1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(1e-5, t);
        g.gain.linearRampToValueAtTime(0.30 * v, t + 0.005);
        g.gain.exponentialRampToValueAtTime(1e-5, t + 0.20);
        src.connect(bp).connect(g).connect(out);
        src.start(t); src.stop(t + 0.22);
        return [src, bp, g];
    }

    /** 吊镲：高通长衰减，用于乐句分界 */
    function vCrash(ctx, out, t, v) {
        const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 1.1);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5200;
        const g = ctx.createGain();
        g.gain.setValueAtTime(1e-5, t);
        g.gain.linearRampToValueAtTime(0.20 * v, t + 0.008);
        g.gain.exponentialRampToValueAtTime(1e-5, t + 1.0);
        src.connect(hp).connect(g).connect(out);
        src.start(t); src.stop(t + 1.05);
        return [src, hp, g];
    }

    /** 高频星点：菜单里的电子点缀 */
    function vBlip(ctx, out, t, f, v) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.12);
        g.gain.setValueAtTime(1e-5, t);
        g.gain.linearRampToValueAtTime(0.05 * v, t + 0.01);
        g.gain.exponentialRampToValueAtTime(1e-5, t + 0.5);
        o.connect(g).connect(out);
        o.start(t); o.stop(t + 0.55);
        return [o, g];
    }

    /** 警报：BOSS 二阶段起的高频扫频（金 #FFD700 只留给它） */
    function vAlarm(ctx, out, t, v) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = 1400; bp.Q.value = 3;
        o.type = 'square';
        o.frequency.setValueAtTime(620, t);
        o.frequency.linearRampToValueAtTime(1180, t + 0.42);
        o.frequency.linearRampToValueAtTime(620, t + 0.84);
        g.gain.setValueAtTime(1e-5, t);
        g.gain.linearRampToValueAtTime(0.055 * v, t + 0.06);
        g.gain.setValueAtTime(0.055 * v, t + 0.72);
        g.gain.exponentialRampToValueAtTime(1e-5, t + 0.9);
        o.connect(bp).connect(g).connect(out);
        o.start(t); o.stop(t + 0.92);
        return [o, bp, g];
    }

    /* ==========================================================
     * 3. 小节调度：把一整个小节的音符一次性排进时间轴
     * ========================================================== */
    /**
     * @param {AudioContext} ctx
     * @param {AudioNode} out 该主题的运行增益
     * @param {object} th 主题定义
     * @param {number} bar 小节序号（用于和弦轮转与乐句分界）
     * @param {number} t 该小节起始时间（ctx 时间轴）
     * @param {object} o { intensity, bossPhase }
     */
    function scheduleBar(ctx, out, th, bar, t, o) {
        const beat = 60 / th.bpm;
        const step = beat / 4;             // 十六分音符
        const barDur = beat * 4;
        const chord = th.chords[bar % th.chords.length];
        const root = th.roots[bar % th.roots.length];
        const I = clamp01(o.intensity);
        const phase = o.bossPhase | 0;
        const bag = [];

        /* ---- 鼓组 ---- */
        if (th.kick) for (let i = 0; i < 16; i++) {
            const v = th.kick[i] | 0;
            if (v > 0) bag.push(vKick(ctx, out, t + i * step, (v / 9) * 1.0));
        }
        if (th.snare) for (let i = 0; i < 16; i++) {
            const v = th.snare[i] | 0;
            if (v > 0) bag.push(vSnare(ctx, out, t + i * step, v / 9));
        }
        if (th.hat) for (let i = 0; i < 16; i++) {
            const v = th.hat[i] | 0;
            if (v > 0) bag.push(vHat(ctx, out, t + i * step, v / 8, phase >= 1));
        }

        /* ---- 贝斯（十六分 ostinato） ---- */
        if (th.bass) for (let i = 0; i < 16; i++) {
            const k = th.bass[i];
            if (k < 0) continue;
            const f = mtof(root + (k === 1 ? 7 : 0));
            // BOSS 三阶段叠加高八度，把压迫感推满
            if (phase >= 2 && i % 4 === 0) bag.push(vBass(ctx, out, t + i * step, f * 2, step * 2, 0.5));
            bag.push(vBass(ctx, out, t + i * step, f, step * 0.95, 1));
        } else if (th.sub) {
            // 菜单：每小节一次的深潜低频
            bag.push(vBass(ctx, out, t, mtof(root), barDur * 0.85, 0.9));
        }

        /* ---- 琶音 ---- */
        if (th.arp) for (let i = 0; i < 16; i++) {
            const k = th.arp[i];
            if (k < 0) continue;
            const note = chord[k % chord.length] + 12;
            bag.push(vArp(ctx, out, t + i * step, mtof(note), step * 0.9, 1, !!th.sub));
        } else if (th.sub) {
            // 菜单：更疏的星点
            bag.push(vBlip(ctx, out, t + step * 6, mtof(chord[2] + 24), 1));
            if (bar % 2 === 1) bag.push(vBlip(ctx, out, t + step * 11, mtof(chord[1] + 24), 0.7));
        }

        /* ---- Pad（霓虹空气层，跨小节呼吸） ---- */
        if (th.padLevel) {
            const pf = [mtof(chord[0]), mtof(chord[0]) * 1.5];
            bag.push(vPad(ctx, out, t, pf, barDur * 1.15, th.padLevel));
            // BOSS 加一层三全音，制造不安
            if (th.id === 'boss') bag.push(vPad(ctx, out, t, [mtof(root + 6)], barDur * 1.15, th.padLevel * 0.7));
        }

        /* ---- Lead：随强度 / BOSS 阶段解锁 ---- */
        if (th.lead && (I > (th.leadFrom || 0) || (th.id === 'boss' && phase >= (th.leadFrom || 0)))) {
            for (let i = 0; i < 16; i++) {
                const n = th.lead[i];
                if (n < 0) continue;
                bag.push(vLead(ctx, out, t + i * step, mtof(n), step * 1.1, 1));
            }
        }

        /* ---- 高强度附加层 ---- */
        if (th.clapFrom && I > th.clapFrom) bag.push(vClap(ctx, out, t + step * 12, 1));
        if (th.alarmFrom != null && phase >= th.alarmFrom) bag.push(vAlarm(ctx, out, t + step * 8, 1));
        if (th.kick && bar % 4 === 0) bag.push(vCrash(ctx, out, t, 1));

        for (let i = 0; i < bag.length; i++) autoClean(bag[i]);
        return bag.length;
    }

    /* ==========================================================
     * 4. 播放器：前瞻式调度（lookahead），避免 setInterval 漂移
     * ========================================================== */
    const LOOKAHEAD = 0.30;   // 提前量（秒）
    const TICK_MS = 45;       // 调度器心跳
    const MIX = 0.75;         // 总线 headroom：满配 Boss 层也不削波

    const player = {
        running: false,
        themeId: null,
        intensity: 0,
        bossPhase: 0,
        bar: 0,
        nextBarTime: 0,
        timer: null,
        runGain: null,     // 当前主题运行增益（用于交叉淡入淡出）
        gestureBound: false
    };

    /** 运行期实时读取，禁止在 IIFE 顶部缓存（本项目加载顺序坑） */
    function audio() { return global.CT_AUDIO || null; }

    function getCtx() {
        const A = audio();
        if (A && typeof A.init === 'function') { try { A.init(); } catch (_) { } }
        return (A && A.ctx) ? A.ctx : null;
    }

    function getBgmBus(ctx) {
        const A = audio();
        if (A && A.bus && A.bus.bgm) return A.bus.bgm;
        return ctx ? ctx.destination : null;
    }

    function isMuted() {
        const A = audio();
        return !!(A && typeof A.isMuted === 'function' && A.isMuted());
    }

    /** 首次交互前 Chrome 会挂起 AudioContext，这里补一次手势恢复 */
    function bindGestureResume() {
        if (player.gestureBound) return;
        player.gestureBound = true;
        const once = function () {
            const ctx = getCtx();
            if (ctx && ctx.state === 'suspended') {
                try { ctx.resume().then(function () { if (player.themeId) start(player.themeId); }); } catch (_) { }
            } else if (player.themeId && !player.running) {
                start(player.themeId);
            }
            global.removeEventListener('click', once, true);
            global.removeEventListener('keydown', once, true);
            global.removeEventListener('touchstart', once, true);
        };
        global.addEventListener('click', once, true);
        global.addEventListener('keydown', once, true);
        global.addEventListener('touchstart', once, true);
    }

    /** 建立一个主题运行增益并淡入 */
    function openRun(ctx, bus) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(1e-5, ctx.currentTime);
        g.gain.linearRampToValueAtTime(MIX, ctx.currentTime + 0.35);
        g.connect(bus);
        return g;
    }

    /** 关闭当前运行增益（淡出后断开） */
    function closeRun(ctx, g) {
        if (!g || !ctx) return;
        const now = ctx.currentTime;
        try {
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(g.gain.value, now);
            g.gain.linearRampToValueAtTime(1e-5, now + 0.30);
        } catch (_) { }
        setTimeout(function () { try { g.disconnect(); } catch (_) { } }, 380);
    }

    function scheduleAhead() {
        const ctx = getCtx();
        if (!ctx || !player.running || !player.runGain) return;
        const th = THEMES[player.themeId];
        if (!th) return;

        // 静音时不排程，省 CPU；恢复音量后自动续上
        if (isMuted()) { player.nextBarTime = ctx.currentTime + 0.1; return; }

        const barDur = (60 / th.bpm) * 4;
        // 落后太多（切后台回来）时重新对齐，避免一次性补几十小节
        if (player.nextBarTime < ctx.currentTime - 0.5) player.nextBarTime = ctx.currentTime + 0.08;

        while (player.nextBarTime < ctx.currentTime + LOOKAHEAD) {
            scheduleBar(ctx, player.runGain, th, player.bar, player.nextBarTime, {
                intensity: player.intensity,
                bossPhase: player.bossPhase
            });
            player.bar++;
            player.nextBarTime += barDur;
        }
    }

    /** 启动（或切换）某主题 */
    function start(themeId) {
        if (!THEMES[themeId]) return false;
        player.themeId = themeId;

        const ctx = getCtx();
        if (!ctx) { bindGestureResume(); return false; }
        if (ctx.state === 'suspended') {
            bindGestureResume();
            try { ctx.resume().catch(function () { }); } catch (_) { }
            return false;
        }
        const bus = getBgmBus(ctx);
        if (!bus) return false;

        if (player.running && player.runGain) closeRun(ctx, player.runGain);
        player.runGain = openRun(ctx, bus);
        player.bar = 0;
        player.nextBarTime = ctx.currentTime + 0.06;
        player.bossPhase = (themeId === 'boss') ? player.bossPhase : 0;

        if (!player.running) {
            player.running = true;
            player.timer = setInterval(scheduleAhead, TICK_MS);
        }
        scheduleAhead();
        global.CT_BUS && global.CT_BUS.emit && global.CT_BUS.emit('bgm:themeChanged', {
            theme: themeId, name: THEMES[themeId].name
        });
        return true;
    }

    function stop() {
        player.running = false;
        if (player.timer) { clearInterval(player.timer); player.timer = null; }
        const ctx = getCtx();
        if (ctx && player.runGain) closeRun(ctx, player.runGain);
        player.runGain = null;
        player.themeId = null;
    }

    /* ==========================================================
     * 5. 离线渲染（试听样带 / 自动化校验）
     * ========================================================== */
    /**
     * 用 OfflineAudioContext 渲染指定主题，得到一段可导出的音频
     * @param {string} themeId
     * @param {number} seconds 渲染时长（秒）
     * @param {object} [opts] { intensity, bossPhase, sampleRate }
     * @returns {Promise<AudioBuffer>}
     */
    function renderTheme(themeId, seconds, opts) {
        opts = opts || {};
        const th = THEMES[themeId];
        if (!th) return Promise.reject(new Error('unknown theme: ' + themeId));
        const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
        if (!OAC) return Promise.reject(new Error('OfflineAudioContext unavailable'));

        const sr = opts.sampleRate || 44100;
        const dur = Math.max(1, +seconds || 20);
        const ctx = new OAC(2, Math.ceil(sr * dur), sr);
        const out = ctx.createGain();
        out.gain.value = MIX;
        out.connect(ctx.destination);

        const barDur = (60 / th.bpm) * 4;
        const bars = Math.ceil(dur / barDur) + 1;
        for (let b = 0; b < bars; b++) {
            scheduleBar(ctx, out, th, b, b * barDur + 0.05, {
                intensity: opts.intensity != null ? opts.intensity : 0.75,
                bossPhase: opts.bossPhase | 0
            });
        }
        return ctx.startRendering();
    }

    /** AudioBuffer → 16bit PCM WAV 字节流 */
    function encodeWav(buffer) {
        const chs = Math.min(2, buffer.numberOfChannels);
        const len = buffer.length;
        const sr = buffer.sampleRate;
        const bytes = 44 + len * chs * 2;
        const ab = new ArrayBuffer(bytes);
        const dv = new DataView(ab);
        const ws = function (off, s) { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
        ws(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); ws(8, 'WAVE');
        ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
        dv.setUint16(22, chs, true); dv.setUint32(24, sr, true);
        dv.setUint32(28, sr * chs * 2, true); dv.setUint16(32, chs * 2, true);
        dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, len * chs * 2, true);

        const chans = [];
        for (let c = 0; c < chs; c++) chans.push(buffer.getChannelData(c));
        let off = 44;
        for (let i = 0; i < len; i++) {
            for (let c = 0; c < chs; c++) {
                let s = chans[c][i];
                s = s < -1 ? -1 : (s > 1 ? 1 : s);
                dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                off += 2;
            }
        }
        return new Uint8Array(ab);
    }

    /* ==========================================================
     * 6. 导演：把主题挂到真实游戏事件上
     *    事件名以源码 emit 为准（ui:showMainMenu / boss:spawned …）
     * ========================================================== */
    function wireDirector() {
        const BUS = global.CT_BUS;
        if (!BUS || typeof BUS.on !== 'function') return false;

        const toMenu = function () { start('menu'); };
        const toBattle = function () { start('battle'); };

        BUS.on('ui:showMainMenu', toMenu);
        BUS.on('ui:mainMenuShown', toMenu);
        BUS.on('game:exitToMenu', toMenu);

        BUS.on('mode:started', function () { start('battle'); });
        BUS.on('engine:start', function () { start('battle'); });
        BUS.on('prep:combatStart', toBattle);

        /* 统一入场口：菜单/hud 在点「出战」时都会发这个事件。
         * online.js 是自成一体的模式（完全不使用 CT_BUS），从不 emit mode:started，
         * 所以联机 PvP 只能靠这里才能拿到战斗主题。 */
        BUS.on('ui:gameStarting', function () { start('battle'); });

        // 备战 / 波次间隙：退回冷静层，让战斗更"顶"
        BUS.on('prep:start', function () { start('menu'); });
        BUS.on('prep:ready', function () { start('menu'); });
        BUS.on('wave:cleared', function () { start('menu'); });

        BUS.on('boss:spawned', function () { player.bossPhase = 0; start('boss'); });
        BUS.on('boss:phaseChanged', function (ev) {
            if (ev && ev.to != null) player.bossPhase = Math.max(0, Math.min(2, ev.to | 0));
            if (THEMES[player.themeId || ''] && player.themeId !== 'boss') start('boss');
        });
        BUS.on('boss:dead', function () { player.bossPhase = 0; start('battle'); });

        BUS.on('mode:finished', function () { start('menu'); });
        BUS.on('matchEnd', function () { start('menu'); });
        /* 结算页：不再让战斗主题继续压着战报，换回冷静层当底线 */
        BUS.on('ui:resultShown', function () { start('menu'); });

        /* ---- 强度：5 秒滑窗统计击杀 / 交火，驱动分层 ---- */
        const win = { kills: [], fire: [], idx: 0, k: 0, f: 0 };
        BUS.on('tank:dead', function () { win.k++; });
        BUS.on('wave:started', function () { win.f += 6; });
        BUS.on('weapon:fire', function () { win.f++; });
        setInterval(function () {
            const kPrev = win.kills[win.idx] || 0;
            const fPrev = win.fire[win.idx] || 0;
            const dk = win.k - kPrev, df = win.f - fPrev;
            win.kills[win.idx] = win.k; win.fire[win.idx] = win.f;
            win.idx = (win.idx + 1) % 5;
            const v = Math.min(1, dk / 6) * 0.6 + Math.min(1, df / 40) * 0.4;
            player.intensity = clamp01(v);
        }, 5000);

        return true;
    }

    /* 引擎在 main.js 末尾才定义 CT_BUS，这里延迟握手 */
    function boot() {
        /* 统一 BGM 出入口：audio-ex.js 自带一套旧 BGM 调度，加载顺序在本模块
         * 之前，这里把它连同 audio.js 的占位版一并接管，保证全局只有
         * CT_BGM 一个 BGM 权威，避免双轨叠放。 */
        const A = audio();
        if (A) {
            A.startBGM = function (themeId) { return start(themeId || 'battle'); };
            A.stopBGM = function () { stop(); };
        }

        let tries = 0;
        (function attempt() {
            if (wireDirector()) return;
            if (++tries < 40) setTimeout(attempt, 50);
        })();
        // 首屏即进主菜单：先记下意图，等首次交互解锁音频
        start('menu');
    }

    if (global.document && global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

    /* ==========================================================
     * 7. 导出
     * ========================================================== */
    global.CT_BGM = {
        THEMES: THEMES,
        start: start,
        stop: stop,
        setTheme: start,
        setIntensity: function (v) { player.intensity = clamp01(v); },
        setBossPhase: function (n) { player.bossPhase = Math.max(0, Math.min(2, n | 0)); },
        getState: function () {
            return {
                running: player.running,
                theme: player.themeId,
                name: player.themeId ? THEMES[player.themeId].name : null,
                bar: player.bar,
                intensity: player.intensity,
                bossPhase: player.bossPhase,
                muted: isMuted()
            };
        },
        renderTheme: renderTheme,
        encodeWav: encodeWav
    };

})(typeof window !== 'undefined' ? window : globalThis);

/* ==========================================================
 * CyberTank — audio-ex.js (Task 10)
 * 升级：精细合成 11 种音色 + 动态 4+2 轨 BGM
 * 覆盖 CT_AUDIO.play / startBGM / stopBGM
 * ========================================================== */
(function (global) {
    'use strict';

    /* ---------- 容错：若没有 CT_AUDIO 则创建空壳再注入 ---------- */
    if (typeof global.CT_AUDIO === 'undefined' || global.CT_AUDIO === null) {
        global.CT_AUDIO = {};
    }
    const A = global.CT_AUDIO;

    /* ---------- 若 AudioManager 类存在，优先调用其 init() ---------- */
    function ensureCtx() {
        if (typeof A.init === 'function') { try { A.init(); } catch (_) {} }
        const c = A.ctx || A._ctx || null;
        return c;
    }
    function sfxBus() {
        return (A.bus && A.bus.sfx) || (A._bus && A._bus.sfx) || ensureCtx()?.destination || null;
    }
    function bgmBus() {
        return (A.bus && A.bus.bgm) || (A._bus && A._bus.bgm) || ensureCtx()?.destination || null;
    }
    function muted() {
        return typeof A.isMuted === 'function' ? A.isMuted() : false;
    }

    /* ---------- 工具：10ms 去 click 的 setValueAtTime + ramp ---------- */
    function safeGain(g, t, v) {
        try {
            g.gain.cancelScheduledValues(t);
            g.gain.setValueAtTime(Math.max(1e-5, g.gain.value || 0), t);
            g.gain.linearRampToValueAtTime(Math.max(1e-5, v), t + 0.01);
        } catch (_) { /* ignore */ }
    }

    function noiseBuffer(ctx, dur) {
        const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
        return buf;
    }

    function noteFreq(n) {
        // MIDI note -> Hz, A4=69 => 440
        return 440 * Math.pow(2, (n - 69) / 12);
    }

    function disconnectLater(nodes, t) {
        const tt = t + 0.05;
        setTimeout(() => {
            for (let i = 0; i < nodes.length; i++) {
                try { nodes[i].disconnect(); } catch (_) {}
            }
        }, Math.max(0, Math.ceil((tt - (ensureCtx()?.currentTime || 0)) * 1000)) + 20);
    }

    /* ==========================================================
     * 精细 play(type, params) —— 覆盖原占位
     * ========================================================== */
    const _origPlay = typeof A.play === 'function' ? A.play.bind(A) : null;

    A.play = function (type, params) {
        params = params || {};
        const ctx = ensureCtx();
        if (!ctx || muted()) return false;
        // 用户手势限制：若 suspended 则拒绝触发
        if (ctx.state === 'suspended') {
            try { ctx.resume().catch(() => {}); } catch (_) {}
            return false;
        }
        const out = sfxBus();
        if (!out) return false;
        const now = ctx.currentTime;
        const volScale = (+params.volume > 0) ? +params.volume : 1;
        const nodes = [];
        const track = (n) => nodes.push(n);

        try {
            switch (type) {
                case 'shoot': {
                    const osc = ctx.createOscillator();
                    const g = ctx.createGain();
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(680, now);
                    osc.frequency.exponentialRampToValueAtTime(2205, now + 0.08);
                    g.gain.setValueAtTime(1e-5, now);
                    g.gain.linearRampToValueAtTime(0.28 * volScale, now + 0.012); // attack + safe
                    g.gain.linearRampToValueAtTime(0.06 * volScale, now + 0.04); // decay
                    g.gain.exponentialRampToValueAtTime(1e-5, now + 0.1);
                    osc.connect(g).connect(out);
                    osc.start(now);
                    osc.stop(now + 0.12);
                    track(osc); track(g);
                    break;
                }
                case 'explode': {
                    // 白噪声 burst + lowpass sweep + bass
                    const buf = noiseBuffer(ctx, 1.2);
                    const src = ctx.createBufferSource();
                    src.buffer = buf;
                    const lp = ctx.createBiquadFilter();
                    lp.type = 'lowpass';
                    lp.Q.value = 1;
                    lp.frequency.setValueAtTime(1200, now);
                    lp.frequency.linearRampToValueAtTime(120, now + 0.6);
                    const ng = ctx.createGain();
                    safeGain(ng, now, 1e-5);
                    ng.gain.linearRampToValueAtTime(0.6 * volScale, now + 0.011);
                    ng.gain.exponentialRampToValueAtTime(1e-5, now + 0.7);
                    src.connect(lp).connect(ng).connect(out);
                    src.start(now); src.stop(now + 0.8); track(src); track(lp); track(ng);

                    // bass impact
                    const osc = ctx.createOscillator();
                    const og = ctx.createGain();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(140, now);
                    osc.frequency.exponentialRampToValueAtTime(40, now + 0.35);
                    safeGain(og, now, 1e-5);
                    og.gain.linearRampToValueAtTime(0.35 * volScale, now + 0.012);
                    og.gain.exponentialRampToValueAtTime(1e-5, now + 0.45);
                    osc.connect(og).connect(out);
                    osc.start(now); osc.stop(now + 0.5); track(osc); track(og);
                    break;
                }
                case 'pickup': {
                    // C-E-G-C arpeggio
                    const notes = [523.25, 659.25, 783.99, 1046.50];
                    for (let i = 0; i < 4; i++) {
                        const osc = ctx.createOscillator();
                        const g = ctx.createGain();
                        osc.type = 'triangle';
                        const t0 = now + i * 0.06;
                        osc.frequency.setValueAtTime(notes[i], t0);
                        g.gain.setValueAtTime(1e-5, t0);
                        g.gain.linearRampToValueAtTime(0.30 * volScale, t0 + 0.01);
                        g.gain.exponentialRampToValueAtTime(1e-5, t0 + 0.12);
                        osc.connect(g).connect(out);
                        osc.start(t0); osc.stop(t0 + 0.14); track(osc); track(g);
                    }
                    break;
                }
                case 'skill': {
                    // charge 220->880 over 0.3s, then burst 1760Hz 0.15s
                    const charge = ctx.createOscillator();
                    const cg = ctx.createGain();
                    charge.type = 'square';
                    charge.frequency.setValueAtTime(220, now);
                    charge.frequency.linearRampToValueAtTime(880, now + 0.30);
                    safeGain(cg, now, 1e-5);
                    cg.gain.linearRampToValueAtTime(0.18 * volScale, now + 0.30);
                    cg.gain.exponentialRampToValueAtTime(1e-5, now + 0.32);
                    charge.connect(cg).connect(out);
                    charge.start(now); charge.stop(now + 0.34); track(charge); track(cg);

                    const burst = ctx.createOscillator();
                    const bg = ctx.createGain();
                    burst.type = 'square';
                    const tb = now + 0.30;
                    burst.frequency.setValueAtTime(1760, tb);
                    burst.frequency.exponentialRampToValueAtTime(880, tb + 0.15);
                    safeGain(bg, tb, 1e-5);
                    bg.gain.linearRampToValueAtTime(0.30 * volScale, tb + 0.01);
                    bg.gain.exponentialRampToValueAtTime(1e-5, tb + 0.18);
                    burst.connect(bg).connect(out);
                    burst.start(tb); burst.stop(tb + 0.2); track(burst); track(bg);
                    break;
                }
                case 'hit': {
                    const osc = ctx.createOscillator();
                    const g = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(1318.51, now);
                    osc.frequency.exponentialRampToValueAtTime(660, now + 0.05);
                    g.gain.setValueAtTime(1e-5, now);
                    g.gain.linearRampToValueAtTime(0.32 * volScale, now + 0.007);
                    g.gain.exponentialRampToValueAtTime(1e-5, now + 0.07);
                    osc.connect(g).connect(out);
                    osc.start(now); osc.stop(now + 0.09); track(osc); track(g);
                    break;
                }
                case 'kill': {
                    const osc = ctx.createOscillator();
                    const g = ctx.createGain();
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(440, now);
                    osc.frequency.exponentialRampToValueAtTime(110, now + 0.25);
                    safeGain(g, now, 1e-5);
                    g.gain.linearRampToValueAtTime(0.26 * volScale, now + 0.012);
                    g.gain.exponentialRampToValueAtTime(1e-5, now + 0.30);
                    osc.connect(g).connect(out);
                    osc.start(now); osc.stop(now + 0.32); track(osc); track(g);

                    // HP noise tail
                    const buf = noiseBuffer(ctx, 0.18);
                    const src = ctx.createBufferSource();
                    src.buffer = buf;
                    const hp = ctx.createBiquadFilter();
                    hp.type = 'highpass'; hp.frequency.value = 1200;
                    const ng = ctx.createGain();
                    safeGain(ng, now, 1e-5);
                    ng.gain.linearRampToValueAtTime(0.22 * volScale, now + 0.02);
                    ng.gain.exponentialRampToValueAtTime(1e-5, now + 0.20);
                    src.connect(hp).connect(ng).connect(out);
                    src.start(now); src.stop(now + 0.22); track(src); track(hp); track(ng);
                    break;
                }
                case 'boss': {
                    // long saw sweep 80 -> 440 1.15s + kick pulses 0.2s
                    const osc = ctx.createOscillator();
                    const g = ctx.createGain();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(80, now);
                    osc.frequency.linearRampToValueAtTime(440, now + 1.15);
                    safeGain(g, now, 1e-5);
                    g.gain.linearRampToValueAtTime(0.30 * volScale, now + 0.05);
                    g.gain.setValueAtTime(0.30 * volScale, now + 1.00);
                    g.gain.exponentialRampToValueAtTime(1e-5, now + 1.25);
                    osc.connect(g).connect(out);
                    osc.start(now); osc.stop(now + 1.30); track(osc); track(g);

                    // kick pulses 每 0.2s
                    for (let i = 0; i < 6; i++) {
                        const t0 = now + i * 0.2;
                        const k = ctx.createOscillator();
                        const kg = ctx.createGain();
                        k.type = 'sine';
                        k.frequency.setValueAtTime(120, t0);
                        k.frequency.exponentialRampToValueAtTime(40, t0 + 0.12);
                        kg.gain.setValueAtTime(1e-5, t0);
                        kg.gain.linearRampToValueAtTime(0.38 * volScale, t0 + 0.006);
                        kg.gain.exponentialRampToValueAtTime(1e-5, t0 + 0.15);
                        k.connect(kg).connect(out);
                        k.start(t0); k.stop(t0 + 0.17); track(k); track(kg);
                    }

                    // speech（用户手势后才可能可用，首次合成需触发过）
                    try {
                        if (global.speechSynthesis && typeof global.speechSynthesis.speak === 'function') {
                            const u = new SpeechSynthesisUtterance('Warning, boss incoming.');
                            u.volume = Math.max(0.05, (A.volume && A.volume.master != null) ? A.volume.master : 0.7);
                            u.rate = 0.95; u.pitch = 0.8;
                            // 触发后可能被拒绝，无副作用
                            try { global.speechSynthesis.speak(u); } catch (_) {}
                        }
                    } catch (_) { /* noop */ }
                    break;
                }
                case 'buy_ok': {
                    const t0a = now;
                    const a = ctx.createOscillator(), ag = ctx.createGain();
                    a.type = 'sine';
                    a.frequency.setValueAtTime(660, t0a);
                    a.frequency.linearRampToValueAtTime(990, t0a + 0.08);
                    safeGain(ag, t0a, 1e-5);
                    ag.gain.linearRampToValueAtTime(0.28 * volScale, t0a + 0.01);
                    ag.gain.exponentialRampToValueAtTime(1e-5, t0a + 0.18);
                    a.connect(ag).connect(out);
                    a.start(t0a); a.stop(t0a + 0.2); track(a); track(ag);

                    const t0b = now + 0.06;
                    const b = ctx.createOscillator(), bg = ctx.createGain();
                    b.type = 'sine';
                    b.frequency.setValueAtTime(880, t0b);
                    b.frequency.linearRampToValueAtTime(1320, t0b + 0.10);
                    safeGain(bg, t0b, 1e-5);
                    bg.gain.linearRampToValueAtTime(0.26 * volScale, t0b + 0.01);
                    bg.gain.exponentialRampToValueAtTime(1e-5, t0b + 0.20);
                    b.connect(bg).connect(out);
                    b.start(t0b); b.stop(t0b + 0.22); track(b); track(bg);
                    break;
                }
                case 'buy_fail': {
                    const t0a = now;
                    const a = ctx.createOscillator(), ag = ctx.createGain();
                    a.type = 'sine';
                    a.frequency.setValueAtTime(330, t0a);
                    a.frequency.linearRampToValueAtTime(220, t0a + 0.20);
                    safeGain(ag, t0a, 1e-5);
                    ag.gain.linearRampToValueAtTime(0.24 * volScale, t0a + 0.01);
                    ag.gain.exponentialRampToValueAtTime(1e-5, t0a + 0.26);
                    a.connect(ag).connect(out);
                    a.start(t0a); a.stop(t0a + 0.28); track(a); track(ag);

                    const t0b = now + 0.04;
                    const b = ctx.createOscillator(), bg = ctx.createGain();
                    b.type = 'sine';
                    b.frequency.setValueAtTime(220, t0b);
                    b.frequency.linearRampToValueAtTime(110, t0b + 0.20);
                    safeGain(bg, t0b, 1e-5);
                    bg.gain.linearRampToValueAtTime(0.22 * volScale, t0b + 0.01);
                    bg.gain.exponentialRampToValueAtTime(1e-5, t0b + 0.26);
                    b.connect(bg).connect(out);
                    b.start(t0b); b.stop(t0b + 0.28); track(b); track(bg);
                    break;
                }
                case 'click': {
                    const osc = ctx.createOscillator();
                    const g = ctx.createGain();
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(1760, now);
                    g.gain.setValueAtTime(1e-5, now);
                    g.gain.linearRampToValueAtTime(0.16 * volScale, now + 0.004);
                    g.gain.exponentialRampToValueAtTime(1e-5, now + 0.012);
                    osc.connect(g).connect(out);
                    osc.start(now); osc.stop(now + 0.02); track(osc); track(g);
                    break;
                }
                case 'ui': {
                    const osc = ctx.createOscillator();
                    const lp = ctx.createBiquadFilter();
                    lp.type = 'lowpass'; lp.frequency.value = 2000; lp.Q.value = 0.5;
                    const g = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(880, now);
                    osc.frequency.linearRampToValueAtTime(1100, now + 0.04);
                    safeGain(g, now, 1e-5);
                    g.gain.linearRampToValueAtTime(0.20 * volScale, now + 0.008);
                    g.gain.exponentialRampToValueAtTime(1e-5, now + 0.08);
                    osc.connect(lp).connect(g).connect(out);
                    osc.start(now); osc.stop(now + 0.10); track(osc); track(lp); track(g);
                    break;
                }
                default: {
                    if (_origPlay) return _origPlay(type, params);
                    return false;
                }
            }
        } catch (e) {
            console.warn('[CT_AUDIO.play-ex] error:', type, e);
            return false;
        }

        // 计划断开连接，避免节点堆积
        const endT = now + 2.0;
        disconnectLater(nodes, endT);
        return true;
    };

    /* ==========================================================
     * 动态 BGM：鼓机 + Bassline + Arp + Pad（intensity>0.7 +Lead+Clap）
     * ========================================================== */
    let bgmTimer = null;
    const state = A._bgmState = { running: false, intensity: 0, step: 0 };
    // 活跃节点（stop 时淡出 + 断开）
    const bgmNodes = [];

    function pushBgmNode(n) { if (n) bgmNodes.push(n); }

    function scheduleKick(ctx, out, t, beat, vol) {
        for (let b = 0; b < 4; b++) {
            if (b === 0 || b === 2) {
                const tt = t + b * beat;
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'sine';
                o.frequency.setValueAtTime(120, tt);
                o.frequency.exponentialRampToValueAtTime(45, tt + 0.14);
                g.gain.setValueAtTime(1e-5, tt);
                g.gain.linearRampToValueAtTime(0.55 * vol, tt + 0.004);
                g.gain.exponentialRampToValueAtTime(1e-5, tt + 0.18);
                o.connect(g).connect(out);
                o.start(tt); o.stop(tt + 0.22);
                pushBgmNode(o); pushBgmNode(g);
            }
        }
    }
    function scheduleSnare(ctx, out, t, beat, vol) {
        for (let b = 1; b < 4; b += 2) {
            const tt = t + b * beat;
            const buf = noiseBuffer(ctx, 0.3);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.8;
            const g = ctx.createGain();
            g.gain.setValueAtTime(1e-5, tt);
            g.gain.linearRampToValueAtTime(0.32 * vol, tt + 0.006);
            g.gain.exponentialRampToValueAtTime(1e-5, tt + 0.20);
            src.connect(bp).connect(g).connect(out);
            src.start(tt); src.stop(tt + 0.25);
            pushBgmNode(src); pushBgmNode(bp); pushBgmNode(g);
        }
    }
    function scheduleHihat(ctx, out, t, beat, vol) {
        const step = beat / 2; // 8 分音符
        for (let i = 0; i < 8; i++) {
            const tt = t + i * step;
            const buf = noiseBuffer(ctx, 0.08);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const hp = ctx.createBiquadFilter();
            hp.type = 'highpass'; hp.frequency.value = 6000; hp.Q.value = 0.5;
            const g = ctx.createGain();
            g.gain.setValueAtTime(1e-5, tt);
            g.gain.linearRampToValueAtTime(0.12 * vol, tt + 0.002);
            g.gain.exponentialRampToValueAtTime(1e-5, tt + 0.06);
            src.connect(hp).connect(g).connect(out);
            src.start(tt); src.stop(tt + 0.08);
            pushBgmNode(src); pushBgmNode(hp); pushBgmNode(g);
        }
    }
    function scheduleBass(ctx, out, t, beat, barNo, vol) {
        // A 小调 4 小节 bass riff（A1 / G / F / E），32nd 节奏型
        const roots = [noteFreq(45), noteFreq(43), noteFreq(41), noteFreq(40)]; // A1 G F E
        const root = roots[barNo % 4];
        const fifth = root * 1.5;
        const pattern = [1, 0, 1, 0, 1, 0, 1.5, 0, 1, 0, 1, 0, 1.5, 0, 1, 0]; // 16 步 (2拍子步)
        const step = beat / 4; // 16th
        for (let i = 0; i < 16; i++) {
            if (pattern[i] === 0) continue;
            const tt = t + i * step;
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass'; lp.frequency.value = 800;
            o.type = 'sawtooth';
            const f = pattern[i] === 1.5 ? fifth : root;
            o.frequency.setValueAtTime(f, tt);
            o.frequency.exponentialRampToValueAtTime(f * 0.97, tt + step * 0.8);
            g.gain.setValueAtTime(1e-5, tt);
            g.gain.linearRampToValueAtTime(0.22 * vol, tt + 0.008);
            g.gain.exponentialRampToValueAtTime(1e-5, tt + step * 0.9);
            o.connect(lp).connect(g).connect(out);
            o.start(tt); o.stop(tt + step);
            pushBgmNode(o); pushBgmNode(lp); pushBgmNode(g);
        }
    }
    function scheduleArp(ctx, out, t, beat, barNo, vol) {
        // A minor triad + octave: A3 C4 E4 A4，16 步 square 琶音
        const triads = [
            [noteFreq(57), noteFreq(60), noteFreq(64), noteFreq(69)], // Am
            [noteFreq(55), noteFreq(59), noteFreq(62), noteFreq(67)], // G
            [noteFreq(53), noteFreq(57), noteFreq(60), noteFreq(65)], // F
            [noteFreq(52), noteFreq(56), noteFreq(59), noteFreq(64)], // E
        ];
        const chord = triads[barNo % 4];
        const pattern = [0, 2, 1, 2, 3, 2, 1, 2, 0, 2, 1, 2, 3, 2, 1, 2];
        const step = beat / 4;
        for (let i = 0; i < 16; i++) {
            const tt = t + i * step;
            const f = chord[pattern[i] % 4];
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            const hp = ctx.createBiquadFilter();
            hp.type = 'highpass'; hp.frequency.value = 400;
            o.type = 'square';
            o.frequency.setValueAtTime(f, tt);
            g.gain.setValueAtTime(1e-5, tt);
            g.gain.linearRampToValueAtTime(0.10 * vol, tt + 0.006);
            g.gain.exponentialRampToValueAtTime(1e-5, tt + step * 0.9);
            o.connect(hp).connect(g).connect(out);
            o.start(tt); o.stop(tt + step);
            pushBgmNode(o); pushBgmNode(hp); pushBgmNode(g);
        }
    }
    function schedulePad(ctx, out, t, beat, barNo, vol) {
        // 两个 sine 5 度 + detune LFO，4 拍长 release 1 bar overlap
        const roots = [noteFreq(57), noteFreq(55), noteFreq(53), noteFreq(52)];
        const root = roots[barNo % 4];
        const freqs = [root, root * 1.5];
        const dur = beat * 4 * 1.2;
        const lfoDepth = 4; // Hz
        freqs.forEach((f, idx) => {
            const o = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.setValueAtTime(f, t);
            // detune LFO
            const lfo = ctx.createOscillator();
            const lfoG = ctx.createGain();
            lfo.frequency.value = 0.2 + idx * 0.1;
            lfoG.gain.value = lfoDepth;
            lfo.connect(lfoG).connect(o.detune);
            const g = ctx.createGain();
            g.gain.setValueAtTime(1e-5, t);
            g.gain.linearRampToValueAtTime(0.07 * vol, t + 0.4);
            g.gain.setValueAtTime(0.07 * vol, t + beat * 4 - 0.4);
            g.gain.exponentialRampToValueAtTime(1e-5, t + dur);
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass'; lp.frequency.value = 1400;
            o.connect(lp).connect(g).connect(out);
            o.start(t); o.stop(t + dur);
            lfo.start(t); lfo.stop(t + dur);
            pushBgmNode(o); pushBgmNode(lp); pushBgmNode(g); pushBgmNode(lfo); pushBgmNode(lfoG);
        });
    }
    function scheduleLead(ctx, out, t, beat, barNo, vol) {
        // 简单 8 步旋律 高八度
        const scale = [noteFreq(69), noteFreq(72), noteFreq(76), noteFreq(77),
                       noteFreq(79), noteFreq(81), noteFreq(84), noteFreq(88)];
        const pat = [0, 2, 4, 2, 3, 5, 4, 2];
        const step = beat / 2;
        for (let i = 0; i < 8; i++) {
            const tt = t + i * step + (barNo % 2 ? 0 : step * 0.5);
            const f = scale[pat[i] % scale.length];
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sawtooth';
            o.frequency.setValueAtTime(f, tt);
            g.gain.setValueAtTime(1e-5, tt);
            g.gain.linearRampToValueAtTime(0.14 * vol, tt + 0.01);
            g.gain.exponentialRampToValueAtTime(1e-5, tt + step * 0.9);
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass'; lp.frequency.value = 3000;
            o.connect(lp).connect(g).connect(out);
            o.start(tt); o.stop(tt + step);
            pushBgmNode(o); pushBgmNode(lp); pushBgmNode(g);
        }
    }
    function scheduleClapCrash(ctx, out, t, beat, barNo, vol) {
        // clap 第 2 拍强调 + crash 小节起始
        const cbuf = noiseBuffer(ctx, 0.25);
        const csrc = ctx.createBufferSource();
        csrc.buffer = cbuf;
        const cb = ctx.createBiquadFilter();
        cb.type = 'bandpass'; cb.frequency.value = 2200; cb.Q.value = 1.2;
        const cg = ctx.createGain();
        const ct = t + beat * 1;
        cg.gain.setValueAtTime(1e-5, ct);
        cg.gain.linearRampToValueAtTime(0.32 * vol, ct + 0.005);
        cg.gain.exponentialRampToValueAtTime(1e-5, ct + 0.22);
        csrc.connect(cb).connect(cg).connect(out);
        csrc.start(ct); csrc.stop(ct + 0.25);
        pushBgmNode(csrc); pushBgmNode(cb); pushBgmNode(cg);

        if (barNo % 2 === 0) {
            // crash
            const crbuf = noiseBuffer(ctx, 1.2);
            const crs = ctx.createBufferSource();
            crs.buffer = crbuf;
            const hp = ctx.createBiquadFilter();
            hp.type = 'highpass'; hp.frequency.value = 5000;
            const gg = ctx.createGain();
            gg.gain.setValueAtTime(1e-5, t);
            gg.gain.linearRampToValueAtTime(0.22 * vol, t + 0.01);
            gg.gain.exponentialRampToValueAtTime(1e-5, t + 1.1);
            crs.connect(hp).connect(gg).connect(out);
            crs.start(t); crs.stop(t + 1.2);
            pushBgmNode(crs); pushBgmNode(hp); pushBgmNode(gg);
        }
    }

    function bgmScheduleBar(t, barNo) {
        const ctx = ensureCtx();
        const out = bgmBus();
        if (!ctx || !out) return;
        const BPM = 120;
        const beat = 60 / BPM; // 0.5s
        const baseVol = 0.9;
        try {
            scheduleKick(ctx, out, t, beat, baseVol);
            scheduleSnare(ctx, out, t, beat, baseVol);
            scheduleHihat(ctx, out, t, beat, baseVol);
            scheduleBass(ctx, out, t, beat, barNo, baseVol);
            scheduleArp(ctx, out, t, beat, barNo, baseVol);
            schedulePad(ctx, out, t, beat, barNo, baseVol);
        } catch (e) {
            console.warn('[CT_AUDIO.bgm] main tracks err', e);
        }
    }

    function extraTracks(t, barNo) {
        const ctx = ensureCtx();
        const out = bgmBus();
        if (!ctx || !out) return;
        const BPM = 120;
        const beat = 60 / BPM;
        const v = 0.9;
        try {
            scheduleLead(ctx, out, t, beat, barNo, v);
            scheduleClapCrash(ctx, out, t, beat, barNo, v);
        } catch (e) {
            console.warn('[CT_AUDIO.bgm] extra tracks err', e);
        }
    }

    /* ---------- startBGM 覆盖 ---------- */
    const _origStartBGM = typeof A.startBGM === 'function' ? A.startBGM.bind(A) : null;
    const _origStopBGM  = typeof A.stopBGM  === 'function' ? A.stopBGM.bind(A)  : null;

    A.startBGM = function () {
        const ctx = ensureCtx();
        if (!ctx) { if (_origStartBGM) return _origStartBGM(); return; }
        if (ctx.state === 'suspended') {
            try { ctx.resume().catch(() => {}); } catch (_) {}
        }
        if (state.running) return;
        state.running = true;
        state.step = 0;
        const BPM = 120;
        const beat = 60 / BPM;
        const barMs = beat * 4 * 1000;

        function scheduleNext() {
            if (!state.running) return;
            const c = ensureCtx();
            if (!c) return;
            const t = c.currentTime + 0.05;
            try {
                bgmScheduleBar(t, state.step);
                if (state.intensity > 0.7) extraTracks(t, state.step);
            } catch (e) {
                console.warn('[CT_AUDIO.bgm] schedule err', e);
            }
            state.step++;
            bgmTimer = setTimeout(scheduleNext, barMs);
        }
        scheduleNext();

        // 清理老旧节点（防止 bgmNodes 无限增长）
        bgmGcTimer = setInterval(() => {
            try {
                for (let i = bgmNodes.length - 1; i >= 0; i--) {
                    const n = bgmNodes[i];
                    if (!n || n._gcT == null) { if (n) n._gcT = Date.now() + 5000; continue; }
                    if (Date.now() > n._gcT) {
                        try { n.disconnect(); } catch (_) {}
                        bgmNodes.splice(i, 1);
                    }
                }
            } catch (_) {}
        }, 3000);
    };

    let bgmGcTimer = null;

    A.stopBGM = function () {
        state.running = false;
        if (bgmTimer) { clearTimeout(bgmTimer); bgmTimer = null; }
        if (bgmGcTimer) { clearInterval(bgmGcTimer); bgmGcTimer = null; }
        const ctx = ensureCtx();
        // bgm bus 淡出
        const busNode = bgmBus();
        if (busNode && ctx && typeof busNode.gain !== 'undefined') {
            try {
                const g = busNode.gain;
                const now = ctx.currentTime;
                g.cancelScheduledValues(now);
                g.setValueAtTime(g.value || 0, now);
                const curVol = (A.volume && A.volume.bgm != null) ? A.volume.bgm : 0.5;
                g.linearRampToValueAtTime(0, now + 0.3);
                setTimeout(() => {
                    try { g.setValueAtTime(curVol, ctx.currentTime); } catch (_) {}
                }, 400);
            } catch (_) {}
        }
        // 断开所有活跃节点
        setTimeout(() => {
            for (let i = 0; i < bgmNodes.length; i++) {
                try { bgmNodes[i].disconnect(); } catch (_) {}
            }
            bgmNodes.length = 0;
        }, 450);
        if (_origStopBGM) { try { _origStopBGM(); } catch (_) {} }
    };

    A.updateBgmIntensity = function (val) {
        state.intensity = Math.max(0, Math.min(1, +val || 0));
    };

    /* ---------- 自动 6 秒统计 intensity（杀人数 + 子弹数 + BOSS） ---------- */
    const window6s = {
        kills: new Array(6).fill(0),
        bullets: new Array(6).fill(0),
        boss: false,
        idx: 0,
        totalKills: 0,
        totalBullets: 0,
    };

    // 监听事件总线（如存在）
    function wireBus() {
        const BUS = global.CT_BUS;
        if (!BUS || typeof BUS.on !== 'function') return;
        try {
            BUS.on('combat:kill', () => { window6s.totalKills++; });
            BUS.on('weapon:fire', () => { window6s.totalBullets++; });
            BUS.on('boss:spawn', () => { window6s.boss = true; });
            BUS.on('boss:dead',  () => { window6s.boss = false; });
        } catch (_) {}
    }

    function startAutoIntensity() {
        wireBus();
        setInterval(() => {
            const killsLast6 = window6s.totalKills - (window6s.kills[window6s.idx] || 0);
            const bulletsLast6 = window6s.totalBullets - (window6s.bullets[window6s.idx] || 0);
            window6s.kills[window6s.idx] = window6s.totalKills;
            window6s.bullets[window6s.idx] = window6s.totalBullets;
            window6s.idx = (window6s.idx + 1) % window6s.kills.length;

            const kScore = Math.min(1, killsLast6 / 10);
            const bScore = Math.min(1, bulletsLast6 / 60);
            const bossScore = window6s.boss ? 0.5 : 0;
            const v = Math.max(0, Math.min(1, kScore * 0.5 + bScore * 0.3 + bossScore));
            A.updateBgmIntensity(v);
        }, 6000);
    }

    if (global.document && typeof global.addEventListener === 'function') {
        global.addEventListener('DOMContentLoaded', startAutoIntensity, { once: true });
    }

    /* ---------- 公开暴露强度状态（调试用） ---------- */
    A.getBgmState = function () { return { running: state.running, intensity: state.intensity, step: state.step }; };

})(typeof window !== 'undefined' ? window : globalThis);

/* ==========================================================
 * CyberTank — 音频系统 audio.js
 * 负责：
 *   - 延迟创建 AudioContext（首次 play 前创建）
 *   - 首次交互（click / keydown）自动 resume（Chrome 限制）
 *   - 三通道 Bus：master / sfx / bgm
 *   - play(type, params)：11 种 type 的占位方波/噪声音
 *   - setVolume / mute / startBGM 占位
 *   Task10 再细化音色，本文件保证 Task1 期内"可听到声音"。
 * ========================================================== */
(function (global) {
    'use strict';

    /* ----------------------------------------------------------
     * 类型白名单（Task1~13 都使用这些 type，不做硬编码枚举方便扩展）
     * ---------------------------------------------------------- */
    const VALID_TYPES = [
        'shoot',    // 开火
        'explode',  // 爆炸
        'pickup',   // 拾取道具
        'skill',    // 技能释放
        'hit',      // 命中
        'kill',     // 击杀
        'boss',     // Boss 出场/咆哮
        'buy_ok',   // 商店购买成功
        'buy_fail', // 商店购买失败
        'click',    // 按钮点击 UI
        'ui'        // 通用 UI 翻页/切换
    ];

    /**
     * @class AudioManager
     * @description 单例音频管理器（挂 window.CT_AUDIO）
     */
    class AudioManager {
        constructor() {
            /** @type {AudioContext|null} 延迟创建 */
            this.ctx = null;
            /** @type {GainNode|null} 主增益 */
            this.masterGain = null;
            /** @type {{sfx:GainNode|null, bgm:GainNode|null}} 子 Bus */
            this.bus = { sfx: null, bgm: null };

            /**
             * 三通道音量（master/sfx/bgm）
             * 默认：0.7 / 0.8 / 0.5
             */
            this.volume = {
                master: 0.7,
                sfx:    0.8,
                bgm:    0.5
            };

            /** 是否全局静音 */
            this._muted = false;

            /** @private 是否已 resume 过（防止 N 次 resume） */
            this._resumed = false;
            /** @private 是否已调用 init() 建立节点图 */
            this._inited = false;

            /** @private BGM Oscillator（占位） */
            this._bgmOsc = null;
            this._bgmGain = null;
        }

        /* ==========================================================
         * 初始化 + 恢复
         * ========================================================== */
        /**
         * 建立节点图（幂等）。注意：AudioContext 允许用户手势前创建，
         * 但播放前必须 ctx.resume()。
         * @returns {AudioManager}
         */
        init() {
            if (this._inited) return this;

            // 1. 构造 AudioContext
            try {
                const AC = global.AudioContext || global.webkitAudioContext;
                if (!AC) {
                    console.warn('[CT_AUDIO] 浏览器不支持 Web Audio API');
                    return this;
                }
                this.ctx = new AC();
            } catch (e) {
                console.warn('[CT_AUDIO] 创建 AudioContext 失败', e);
                return this;
            }

            // 2. 总线图： ctx.destination ← masterGain ← [sfxGain, bgmGain]
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this._muted ? 0 : this.volume.master;
            this.masterGain.connect(this.ctx.destination);

            this.bus.sfx = this.ctx.createGain();
            this.bus.sfx.gain.value = this.volume.sfx;
            this.bus.sfx.connect(this.masterGain);

            this.bus.bgm = this.ctx.createGain();
            this.bus.bgm.gain.value = this.volume.bgm;
            this.bus.bgm.connect(this.masterGain);

            this._inited = true;

            // 3. 绑定首次交互自动 resume（满足 Chrome autoplay 限制）
            this._bindAutoResume();
            return this;
        }

        /**
         * @private 绑定 click / first-keydown 时 resume
         */
        _bindAutoResume() {
            const self = this;
            const handler = function () {
                self._ensureResumed().catch((e) => {/* noop */});
                // 成功一次就移除
                setTimeout(() => {
                    window.removeEventListener('click',      handler, true);
                    window.removeEventListener('keydown',    handler, true);
                    window.removeEventListener('touchstart', handler, true);
                }, 0);
            };
            window.addEventListener('click',      handler, true);
            window.addEventListener('keydown',    handler, true);
            window.addEventListener('touchstart', handler, true);
        }

        /**
         * 确保 context 已恢复（suspended → running）
         * @private
         * @returns {Promise<void>}
         */
        async _ensureResumed() {
            if (!this.ctx) return;
            if (this._resumed) return;
            if (this.ctx.state === 'suspended') {
                try { await this.ctx.resume(); }
                catch (e) { /* 忽略 */ }
            }
            if (this.ctx.state === 'running') this._resumed = true;
        }

        /* ==========================================================
         * 通道控制
         * ========================================================== */
        /**
         * 设置某个通道音量
         * @param {'master'|'sfx'|'bgm'} channel
         * @param {number} v 0~1（超出会 clamp）
         */
        setVolume(channel, v) {
            const val = Math.max(0, Math.min(1, +v));
            if (!isFinite(val)) return;
            this.volume[channel] = val;
            if (channel === 'master' && this.masterGain && !this._muted) {
                this.masterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.01);
            }
            if (channel === 'sfx' && this.bus.sfx) {
                this.bus.sfx.gain.setTargetAtTime(val, this.ctx.currentTime, 0.01);
            }
            if (channel === 'bgm' && this.bus.bgm) {
                this.bus.bgm.gain.setTargetAtTime(val, this.ctx.currentTime, 0.01);
            }
            global.CT_BUS && global.CT_BUS.emit('audio:volume', { channel, v: val });
        }

        /**
         * 静音开关
         * @param {boolean} b true=静音 false=恢复
         */
        mute(b) {
            this._muted = !!b;
            if (this.masterGain && this.ctx) {
                const target = this._muted ? 0 : this.volume.master;
                this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.01);
            }
            global.CT_BUS && global.CT_BUS.emit('audio:mute', { muted: this._muted });
        }

        /** @returns {boolean} 当前是否静音 */
        isMuted() { return this._muted; }

        /* ==========================================================
         * 播放 API（Task1 占位音色，Task10 细化）
         * ========================================================== */
        /**
         * 播放指定音效
         * @param {string} type shoot|explode|pickup|skill|hit|kill|boss|buy_ok|buy_fail|click|ui
         * @param {object} [params] 可选参数（volume / pitch 等，Task10 扩展）
         * @returns {boolean} 是否成功触发播放
         */
        play(type, params) {
            if (!VALID_TYPES.includes(type)) {
                console.warn('[CT_AUDIO] unknown type:', type);
                return false;
            }
            this.init();        // 懒 init
            this._ensureResumed(); // 懒 resume
            if (!this.ctx || !this.bus.sfx) return false;

            try {
                switch (type) {
                    case 'shoot':    this._playShoot(params);    break;
                    case 'explode':  this._playExplode(params);  break;
                    case 'pickup':   this._playPickup(params);   break;
                    case 'skill':    this._playSkill(params);    break;
                    case 'hit':      this._playHit(params);      break;
                    case 'kill':     this._playKill(params);     break;
                    case 'boss':     this._playBoss(params);     break;
                    case 'buy_ok':   this._playBuyOk(params);    break;
                    case 'buy_fail': this._playBuyFail(params);  break;
                    case 'click':    this._playClick(params);    break;
                    case 'ui':       this._playUi(params);       break;
                    default:         this._playClick(params);    break;
                }
                return true;
            } catch (e) {
                console.warn('[CT_AUDIO.play] error:', type, e);
                return false;
            }
        }

        /* ---------- 以下为占位音色：方波 / 三角波 / 噪声 ---------- */

        /**
         * @private 基础包络工具（ADSR 简化 A/R）
         * @param {OscillatorNode|AudioBufferSourceNode} src
         * @param {GainNode} gGain
         * @param {number} dur 总时长（秒）
         * @param {number} [peak=0.3] 峰值
         * @param {number} [attack=0.005] attack
         */
        _env(src, gGain, dur, peak, attack) {
            const t = this.ctx.currentTime;
            const pk = peak ?? 0.28;
            const atk = attack ?? 0.006;
            gGain.gain.setValueAtTime(0, t);
            gGain.gain.linearRampToValueAtTime(pk, t + atk);
            gGain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(atk + 0.02, dur));
            src.start(t);
            src.stop(t + dur + 0.05);
        }

        /** shoot：短促方波下滑（机枪） */
        _playShoot(p) {
            const ctx = this.ctx;
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.type = 'square';
            const f0 = (p && p.pitch) ? (620 * p.pitch) : 620;
            osc.frequency.setValueAtTime(f0, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(Math.max(60, f0 * 0.35), ctx.currentTime + 0.09);
            osc.connect(g).connect(this.bus.sfx);
            this._env(osc, g, 0.095, 0.18, 0.003);
        }

        /** explode：白噪声突发 + 低频方波冲击 */
        _playExplode(p) {
            const ctx = this.ctx;
            const dur = 0.45;
            // 噪声
            const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
            const ch = buf.getChannelData(0);
            for (let i = 0; i < ch.length; i++) {
                // 简单的衰减包络白噪声
                const k = 1 - i / ch.length;
                ch[i] = (Math.random() * 2 - 1) * k * k;
            }
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const g = ctx.createGain();
            // 低通，让爆声更闷
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 1800;
            src.connect(lp).connect(g).connect(this.bus.sfx);
            g.gain.setValueAtTime(0.0001, ctx.currentTime);
            g.gain.linearRampToValueAtTime(0.45, ctx.currentTime + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
            src.start();
            src.stop(ctx.currentTime + dur + 0.05);

            // 低频冲击（让爆炸更有力量）
            const osc = ctx.createOscillator();
            const g2 = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(180, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.25);
            osc.connect(g2).connect(this.bus.sfx);
            this._env(osc, g2, 0.26, 0.25, 0.005);
        }

        /** pickup：上滑三角波（金币/道具） */
        _playPickup(p) {
            const ctx = this.ctx;
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(520, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(980, ctx.currentTime + 0.16);
            osc.connect(g).connect(this.bus.sfx);
            this._env(osc, g, 0.22, 0.30, 0.008);
        }

        /** skill：合成扫频方波（技能释放） */
        _playSkill(p) {
            const ctx = this.ctx;
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(300, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(1400, ctx.currentTime + 0.22);
            osc.connect(g).connect(this.bus.sfx);
            this._env(osc, g, 0.28, 0.22, 0.008);
        }

        /** hit：短促尖峰三角波（命中） */
        _playHit(p) {
            const ctx = this.ctx;
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(260, ctx.currentTime + 0.06);
            osc.connect(g).connect(this.bus.sfx);
            this._env(osc, g, 0.075, 0.22, 0.002);
        }

        /** kill：下滑方波 + 小噪声（击杀） */
        _playKill(p) {
            const ctx = this.ctx;
            // 音头下滑
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(540, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.24);
            osc.connect(g).connect(this.bus.sfx);
            this._env(osc, g, 0.28, 0.22, 0.004);

            // 噪声尾巴
            const dur = 0.28;
            const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
            const ch = buf.getChannelData(0);
            for (let i = 0; i < ch.length; i++) {
                const k = 1 - i / ch.length;
                ch[i] = (Math.random() * 2 - 1) * k;
            }
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const g2 = ctx.createGain();
            const hp = ctx.createBiquadFilter();
            hp.type = 'highpass'; hp.frequency.value = 1200;
            src.connect(hp).connect(g2).connect(this.bus.sfx);
            g2.gain.setValueAtTime(0.0001, ctx.currentTime);
            g2.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.02);
            g2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
            src.start(); src.stop(ctx.currentTime + dur + 0.04);
        }

        /** boss：长低音方波扫频（Boss 咆哮出场） */
        _playBoss(p) {
            const ctx = this.ctx;
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(60, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(210, ctx.currentTime + 0.6);
            osc.frequency.linearRampToValueAtTime(80,  ctx.currentTime + 1.1);
            osc.connect(g).connect(this.bus.sfx);
            this._env(osc, g, 1.15, 0.26, 0.02);
        }

        /** buy_ok：双音上扬（购买成功） */
        _playBuyOk(p) {
            const ctx = this.ctx;
            const notes = [660, 990];
            const offset = [0, 0.08];
            for (let i = 0; i < 2; i++) {
                const osc = ctx.createOscillator();
                const g   = ctx.createGain();
                osc.type = 'triangle';
                const t0 = ctx.currentTime + offset[i];
                osc.frequency.setValueAtTime(notes[i], t0);
                osc.connect(g).connect(this.bus.sfx);
                g.gain.setValueAtTime(0, t0);
                g.gain.linearRampToValueAtTime(0.25, t0 + 0.008);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
                osc.start(t0); osc.stop(t0 + 0.22);
            }
        }

        /** buy_fail：双音下降失败提示 */
        _playBuyFail(p) {
            const ctx = this.ctx;
            const notes = [330, 210];
            const offset = [0, 0.09];
            for (let i = 0; i < 2; i++) {
                const osc = ctx.createOscillator();
                const g   = ctx.createGain();
                osc.type = 'square';
                const t0 = ctx.currentTime + offset[i];
                osc.frequency.setValueAtTime(notes[i], t0);
                osc.connect(g).connect(this.bus.sfx);
                g.gain.setValueAtTime(0, t0);
                g.gain.linearRampToValueAtTime(0.2, t0 + 0.006);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
                osc.start(t0); osc.stop(t0 + 0.26);
            }
        }

        /** click：短促 UI 点击（高频 + 衰减） */
        _playClick(p) {
            const ctx = this.ctx;
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(1100, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.035);
            osc.connect(g).connect(this.bus.sfx);
            this._env(osc, g, 0.045, 0.12, 0.002);
        }

        /** ui：柔和三角波（翻页/切换） */
        _playUi(p) {
            const ctx = this.ctx;
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(440, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(660, ctx.currentTime + 0.08);
            osc.connect(g).connect(this.bus.sfx);
            this._env(osc, g, 0.13, 0.14, 0.006);
        }

        /* ==========================================================
         * BGM 占位（Task10 实现完整循环 + 多层）
         * ========================================================== */
        /**
         * 启动 BGM（占位：简单低频方波铺底 + 5 度循环）
         */
        startBGM() {
            this.init();
            this._ensureResumed();
            if (!this.ctx || !this.bus.bgm) return;
            if (this._bgmOsc) return; // 幂等

            const ctx = this.ctx;
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.type = 'triangle';
            // 低音 A 循环（110 / 165 / 220）
            const sequence = [110, 165, 138.59, 165];
            const step = 0.6;
            const startT = ctx.currentTime + 0.05;
            for (let i = 0; i < 64; i++) {
                const f = sequence[i % sequence.length];
                osc.frequency.setValueAtTime(f, startT + i * step);
            }
            osc.connect(g).connect(this.bus.bgm);
            g.gain.value = 0;
            g.gain.linearRampToValueAtTime(0.08, startT + 0.5);
            osc.start(startT);

            this._bgmOsc = osc;
            this._bgmGain = g;
            // 64 步 * 0.6s = 38.4s 后自动再启动一次（简单循环占位）
            this._bgmTimer = setTimeout(() => {
                this.stopBGM();
                this.startBGM();
            }, 38000);
        }

        /** 停止 BGM */
        stopBGM() {
            if (this._bgmOsc) {
                try {
                    const g = this._bgmGain;
                    if (g && this.ctx) {
                        g.gain.cancelScheduledValues(this.ctx.currentTime);
                        g.gain.setValueAtTime(g.gain.value, this.ctx.currentTime);
                        g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);
                    }
                    const osc = this._bgmOsc;
                    setTimeout(() => {
                        try { osc.stop(); } catch (e) {}
                    }, 400);
                } catch (e) { /* noop */ }
                this._bgmOsc = null;
                this._bgmGain = null;
            }
            if (this._bgmTimer) { clearTimeout(this._bgmTimer); this._bgmTimer = 0; }
        }
    }

    /* ==========================================================
     * 单例挂载（支持热更新复用）
     * ========================================================== */
    if (!global.CT_AUDIO) global.CT_AUDIO = new AudioManager();

})(typeof window !== 'undefined' ? window : globalThis);

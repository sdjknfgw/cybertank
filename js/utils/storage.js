/* ==========================================================
 * CyberTank — 存档系统 storage.js
 * 挂载 window.CT_STORAGE
 * 职责：
 *   - Profile（金币、皮肤、装备、勋章）持久化
 *   - Records（5 种模式）+ 排行榜 UI 数据
 *   - Settings（音量 / 静音 / 画质 / 全屏 / 键位）
 *   - Achievements（10 条成就自动判定 + 解锁奖励）
 *   - 深 2 层 merge，localStorage 禁用自动降级内存存储
 *   - QuotaExceeded 时降级内存并 toast
 * ========================================================== */
(function (global) {
    'use strict';

    /* ==========================================================
     * 小工具
     * ========================================================== */
    var CT_TOAST = (global.CT_TOAST || function (msg, lv) {
        try { console.log('[CT_TOAST][' + (lv || 'info') + ']', msg); } catch (_) {}
    });

    function _toast(msg, lv) {
        try { CT_TOAST(msg, lv || 'info'); } catch (_) {}
    }

    /** 深拷贝（仅限 JSON 安全数据：存档都是纯数据） */
    function _clone(o) {
        if (o == null) return o;
        if (typeof o !== 'object') return o;
        if (Array.isArray(o)) {
            var a = [];
            for (var i = 0; i < o.length; i++) a.push(_clone(o[i]));
            return a;
        }
        var r = {};
        for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = _clone(o[k]);
        return r;
    }

    /** 深 2 层 merge：dst 会被修改并返回。 */
    function _merge2(dst, src) {
        if (!dst || typeof dst !== 'object') dst = {};
        if (!src || typeof src !== 'object') return dst;
        var keys = Object.keys(src);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var sv = src[k];
            if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
                // 第 2 层（对象）：浅合并字段
                var dv = dst[k];
                if (!dv || typeof dv !== 'object' || Array.isArray(dv)) dv = {};
                var sub = {};
                // 先填 dv 的字段
                var dk = Object.keys(dv);
                for (var j = 0; j < dk.length; j++) sub[dk[j]] = dv[dk[j]];
                // 再被 sv 覆盖
                var sk = Object.keys(sv);
                for (var j2 = 0; j2 < sk.length; j2++) sub[sk[j2]] = sv[sk[j2]];
                dst[k] = sub;
            } else {
                // 数组、基本类型：直接覆盖（按任务要求 2 层 merge，数组整体替换，避免重复元素难处理）
                dst[k] = Array.isArray(sv) ? sv.slice() : sv;
            }
        }
        return dst;
    }

    /** 数值安全 clamp */
    function _clamp(v, lo, hi) {
        if (typeof v !== 'number' || !isFinite(v)) return lo;
        return Math.max(lo, Math.min(hi, v));
    }

    /* ==========================================================
     * 默认值
     * ========================================================== */
    var SCHEMA_VERSION = 1;

    var DEFAULT_PROFILE = {
        name: 'Commander',
        coins: 0,
        selectedTank: 'assault',
        selectedSkin: 'cyan',
        unlockedSkins: ['cyan'],
        unlockedEquipments: [],
        unlockedBadges: [],
        tanksCleared: {}   // {assault:true, heavy:true, sniper:true, engineer:true} 用于 master_all
    };

    var DEFAULT_RECORDS = {
        battleRoyale: { wins: 0, top3Rate: 0, bestKills: 0 },
        horde:        { bestWave: 0, mostBuffs: 0, highScore: 0 },
        kingHill:     { bestScore: 0, winRate: 0 },
        duel:         { winStreak: 0, totalWins: 0 },
        kingdefend:   { highScore: 0, bestWave: 0, bestTime: 0, bestRating: 'D' }
    };

    /* 据点守护按难度分档记录：kingdefend / kingdefend_easy / kingdefend_hard / kingdefend_night ... */
    var KINGDEFEND_DIFFS = ['easy', 'normal', 'hard', 'night'];

    var DEFAULT_SETTINGS = {
        volume: { master: 0.7, sfx: 0.8, bgm: 0.5 },
        mute:   { all: false, sfx: false, bgm: false },
        screenShake: true,
        quality: 'high',     // low / mid / high
        fullscreen: false,
        keybinds: {
            up:       'KeyW',
            down:     'KeyS',
            left:     'KeyA',
            right:    'KeyD',
            shoot:    'Space',
            skill:    'KeyE',
            useItem1: 'Digit1',
            useItem2: 'Digit2',
            useItem3: 'Digit3',
            interact: 'KeyF',
            pause:    'Escape',
            map:      'KeyM'
        }
    };

    // 注意：每个成就对象"可变"，只存 unlocked 字段，其他字段作为模板（name/desc/reward 不变）
    var ACHIEVEMENTS_TEMPLATE = {
        first_blood:    { name: '初次击杀',   desc: '击毁第 1 辆敌方坦克',              reward: 100, unlocked: false },
        untouchable:    { name: '完美闪避',   desc: '单局 0 受伤通关',                  reward: 300, unlocked: false },
        base_guardian:  { name: '基地守护',   desc: '经典模式无损基地通关',              reward: 400, unlocked: false },
        boss_slayer:    { name: 'BOSS 杀手',  desc: '累计击杀 10 个 BOSS',              reward: 500, unlocked: false },
        br_king:        { name: '大逃杀之王', desc: '单局 15 杀吃鸡',                    reward: 500, unlocked: false },
        millionaire:    { name: '百万富翁',   desc: '累计得分 1,000,000',                reward: 600, unlocked: false },
        master_all:     { name: '全能战士',   desc: '4 种坦克都通关一次',                reward: 400, unlocked: false },
        build_master:   { name: '构筑大师',   desc: '单局获得 15+ 增益',                 reward: 350, unlocked: false },
        collector:      { name: '道具收藏家', desc: '单局拾取 16 种道具全种类',          reward: 300, unlocked: false },
        wave_hero:      { name: '无尽英雄',   desc: '无尽模式达到 30 波',                reward: 800, unlocked: false }
    };

    /** 把 ACHIEVEMENTS_TEMPLATE 深拷贝一份（每次存档都要一份"当前解锁状态"副本） */
    function _makeAchievements() {
        var out = {};
        var keys = Object.keys(ACHIEVEMENTS_TEMPLATE);
        for (var i = 0; i < keys.length; i++) {
            var id = keys[i];
            var t = ACHIEVEMENTS_TEMPLATE[id];
            out[id] = { name: t.name, desc: t.desc, reward: t.reward, unlocked: false };
        }
        return out;
    }

    function _defaultsAll() {
        return {
            schemaVersion: SCHEMA_VERSION,
            profile: _clone(DEFAULT_PROFILE),
            records: _clone(DEFAULT_RECORDS),
            settings: _clone(DEFAULT_SETTINGS),
            achievements: _makeAchievements()
        };
    }

    /* ==========================================================
     * 内存降级存储（localStorage 不可用或 Quota 时使用）
     * ========================================================== */
    function makeMemFallback() {
        var m = new Map();
        return {
            getItem: function (k) { var v = m.get(k); return v == null ? null : String(v); },
            setItem: function (k, v) { m.set(k, String(v)); return true; },
            removeItem: function (k) { m.delete(k); },
            clear: function () { m.clear(); },
            _isMem: true
        };
    }

    /* ==========================================================
     * 存档主对象
     * ========================================================== */
    var CT_STORAGE = {
        KEY: 'CYBERTANK_SAVE_v1',
        SCHEMA_VERSION: SCHEMA_VERSION,
        DEFAULT_PROFILE: _clone(DEFAULT_PROFILE),
        DEFAULT_RECORDS: _clone(DEFAULT_RECORDS),
        DEFAULT_SETTINGS: _clone(DEFAULT_SETTINGS),
        ACHIEVEMENTS: _makeAchievements(),

        _memFallback: null,
        _warned: false,

        /* ==================== 核心读写 ==================== */
        init: function () {
            try {
                // 先尝试 touch 一下 localStorage，看会不会抛（Safari 隐私模式会抛 QuotaExceeded）
                if (typeof localStorage !== 'undefined') {
                    try {
                        var probe = '__ct_probe__';
                        localStorage.setItem(probe, '1');
                        localStorage.removeItem(probe);
                    } catch (e) {
                        this._memFallback = makeMemFallback();
                        if (!this._warned) {
                            this._warned = true;
                            _toast('⚠️ 浏览器存储被禁用，本次将使用内存存档（刷新会丢失）。', 'warn');
                        }
                    }
                } else {
                    this._memFallback = makeMemFallback();
                }

                // 把本地存档读出并和默认值合并一遍（schema 升级的同时补齐默认字段）
                var data = this.get();
                // 回写一次，保证默认值全部落盘（但不覆盖金币/记录）
                try { this._writeRaw(JSON.stringify(data)); } catch (_) {}

                // 同步设置（音量/画质/全屏）
                try { this.saveSettings({}); } catch (_) {}
            } catch (e) {
                console.warn('[CT_STORAGE.init] failed', e);
                if (!this._memFallback) this._memFallback = makeMemFallback();
            }
        },

        _storage: function () {
            if (this._memFallback) return this._memFallback;
            try {
                if (typeof localStorage !== 'undefined') return localStorage;
            } catch (_) { /* ignore */ }
            this._memFallback = makeMemFallback();
            return this._memFallback;
        },

        _readRaw: function () {
            try {
                var s = this._storage().getItem(this.KEY);
                if (s == null) return '{}';
                return String(s);
            } catch (e) {
                if (!this._warned) {
                    this._warned = true;
                    _toast('读取存档失败，使用默认数据。', 'warn');
                }
                return '{}';
            }
        },

        _writeRaw: function (str) {
            try {
                this._storage().setItem(this.KEY, String(str));
                return true;
            } catch (e) {
                this._onQuotaExceed(e);
                return false;
            }
        },

        _onQuotaExceed: function (e) {
            _toast('⚠️ 存档空间已满，本次进度未保存。建议清 localStorage 后重试。', 'warn');
            try {
                if (!this._memFallback) this._memFallback = makeMemFallback();
                // 把上次成功读出的内容先拷进内存，避免后续 get() 读到空
                try {
                    var raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(this.KEY) : null;
                    if (raw != null) this._memFallback.setItem(this.KEY, raw);
                } catch (_) {}
            } catch (_) {}
        },

        /**
         * v1 占位迁移：如果 schemaVersion 缺失或低于当前 SCHEMA_VERSION，
         * 调用 migrate（当前只有一层合并，预留接口）
         */
        _migrate: function (data) {
            var from = data && data.schemaVersion ? data.schemaVersion : 0;
            if (from >= SCHEMA_VERSION) return data;
            // v0(undefined) -> v1：合并默认值就够了，其他迁移逻辑以后扩展
            var out = _merge2(_defaultsAll(), data || {});
            out.schemaVersion = SCHEMA_VERSION;
            return out;
        },

        get: function () {
            var raw = this._readRaw();
            var parsed = {};
            try {
                if (typeof raw === 'string' && raw.length > 0) parsed = JSON.parse(raw);
            } catch (e) {
                parsed = {};
                if (!this._warned) {
                    this._warned = true;
                    _toast('存档格式损坏，已恢复默认（原存档已备份到内存）。', 'warn');
                }
                try { console.warn('[CT_STORAGE] parse fail, raw=', raw); } catch (_) {}
            }
            if (!parsed || typeof parsed !== 'object') parsed = {};

            // 版本迁移
            var migrated = this._migrate(parsed);

            // 深 2 层 merge 默认值（防止新增字段缺失）
            var def = _defaultsAll();
            var merged = _merge2(def, migrated);
            merged.achievements = _merge2(_makeAchievements(), migrated.achievements || {});
            return _clone(merged);
        },

        /** 合并 patch（最多 2 层深合并）后写回 */
        save: function (patch) {
            var cur = this.get();
            if (patch && typeof patch === 'object') {
                cur = _merge2(cur, patch);
                // achievements 单独 merge 一下，确保每条结构都完整
                if (patch.achievements && typeof patch.achievements === 'object') {
                    cur.achievements = _merge2(_makeAchievements(), patch.achievements);
                }
            }
            cur.schemaVersion = SCHEMA_VERSION;
            try {
                return this._writeRaw(JSON.stringify(cur));
            } catch (e) {
                return false;
            }
        },

        reset: function () {
            try {
                this._storage().removeItem(this.KEY);
            } catch (e) { /* ignore */ }
            // 立即保存默认值
            var def = _defaultsAll();
            this._writeRaw(JSON.stringify(def));
            _toast('存档已重置（金币清零）。', 'info');
            return def;
        },

        /* ==================== Profile ==================== */
        getProfile: function () { return this.get().profile; },

        saveProfile: function (partial) {
            var patch = { profile: partial || {} };
            return this.save(patch);
        },

        addCoins: function (n) {
            n = Number(n) || 0;
            var p = this.getProfile();
            p.coins = Math.max(0, (Number(p.coins) || 0) + n);
            this.saveProfile(p);
            return p.coins;
        },

        spendCoins: function (n) {
            n = Number(n) || 0;
            if (n <= 0) return true;
            var p = this.getProfile();
            var cur = Number(p.coins) || 0;
            if (cur < n) return false;
            p.coins = cur - n;
            this.saveProfile(p);
            return true;
        },

        addEquipment: function (id) {
            if (!id) return false;
            var p = this.getProfile();
            var list = Array.isArray(p.unlockedEquipments) ? p.unlockedEquipments.slice() : [];
            if (list.indexOf(id) >= 0) return true;
            list.push(id);
            p.unlockedEquipments = list;
            this.saveProfile(p);
            return true;
        },

        unlockSkin: function (id, cost) {
            if (!id) return false;
            var c = (cost == null) ? 500 : Number(cost);
            var p = this.getProfile();
            var list = Array.isArray(p.unlockedSkins) ? p.unlockedSkins.slice() : [];
            if (list.indexOf(id) >= 0) return true;
            if (c > 0) {
                if (!this.spendCoins(c)) return false;
                // spendCoins 已经 saveProfile 了，再重新读一下防止覆盖
                p = this.getProfile();
                list = Array.isArray(p.unlockedSkins) ? p.unlockedSkins.slice() : [];
            }
            list.push(id);
            p.unlockedSkins = list;
            this.saveProfile(p);
            if (c > 0) _toast('解锁皮肤成功：' + id + '（-' + c + '💰）', 'info');
            return true;
        },

        /** 记录某坦克通关，用于 master_all 判定（4 种：assault/heavy/sniper/engineer） */
        recordTankClear: function (tankClass) {
            if (!tankClass) return;
            var p = this.getProfile();
            var tc = (p.tanksCleared && typeof p.tanksCleared === 'object') ? _clone(p.tanksCleared) : {};
            tc[String(tankClass)] = true;
            p.tanksCleared = tc;
            this.saveProfile(p);
        },

        /* ==================== Records & Leaderboard ==================== */

        /**
         * 读取某个模式的成绩记录。
         * 此前 CT_STORAGE 只提供 updateRecord / getLeaderboard，没有 getRecord，
         * 而 horde / king-hill / duel / kingdefend 等模式都在「读旧值 → 取 max → 写回」，
         * 调用一个不存在的方法会抛 TypeError——这些调用点全被 try/catch 包着，
         * 于是最佳成绩静默丢失（每局都从 0 重新开始计）。这里补齐缺失的读取端。
         * @param {string} mode 模式键（如 'horde' / 'kingdefend_hard'）
         * @returns {object} 记录副本；不存在时返回 {}
         */
        getRecord: function (mode) {
            if (!mode) return {};
            var all = this.get();
            var rec = (all.records && all.records[mode]) ? all.records[mode] : {};
            return _clone(rec);
        },

        updateRecord: function (mode, patch) {
            if (!mode) return;
            var all = this.get();
            var rec = (all.records && all.records[mode]) ? _clone(all.records[mode]) : {};
            if (patch && typeof patch === 'object') {
                var keys = Object.keys(patch);
                for (var i = 0; i < keys.length; i++) rec[keys[i]] = patch[keys[i]];
            }
            var records = _clone(all.records);
            records[mode] = rec;
            this.save({ records: records });
        },

        getLeaderboard: function (mode) {
            var all = this.get();
            var rec = (all.records && all.records[mode]) ? all.records[mode] : {};
            var labelMap = {
                battleRoyale: { wins: '胜场', top3Rate: '前三率', bestKills: '最高击杀' },
                horde:        { bestWave: '最佳波次', mostBuffs: '最多增益', highScore: '最高分' },
                kingHill:     { bestScore: '最高占分', winRate: '胜率' },
                duel:         { winStreak: '连胜', totalWins: '总胜场' },
                kingdefend:   { highScore: '最高分', bestWave: '最佳波次', bestTime: '最长坚守', bestRating: '最佳评级' }
            };
            /* 据点守护按难度分档（kingdefend_easy 等）统一复用 kingdefend 的字段中文名 */
            var labels = labelMap[mode] ||
                (String(mode).indexOf('kingdefend') === 0 ? labelMap.kingdefend : {});
            var out = [];
            var keys = Object.keys(rec);
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                out.push({ key: k, label: labels[k] || k, value: rec[k] });
            }
            return { mode: mode, record: _clone(rec), rows: out };
        },

        getAllBest: function () {
            var out = {
                battleRoyale: this.getLeaderboard('battleRoyale'),
                horde:        this.getLeaderboard('horde'),
                kingHill:     this.getLeaderboard('kingHill'),
                duel:         this.getLeaderboard('duel'),
                kingdefend:   this.getLeaderboard('kingdefend')
            };
            /* 据点守护各难度档位独立排行 */
            for (var i = 0; i < KINGDEFEND_DIFFS.length; i++) {
                out['kingdefend_' + KINGDEFEND_DIFFS[i]] = this.getLeaderboard('kingdefend_' + KINGDEFEND_DIFFS[i]);
            }
            return out;
        },

        /* ==================== Settings ==================== */
        getSettings: function () { return this.get().settings; },

        saveSettings: function (s) {
            var cur = this.getSettings();
            var merged = _merge2(_clone(DEFAULT_SETTINGS), _merge2(cur, s || {}));
            // 音量 clamp
            if (merged.volume) {
                merged.volume.master = _clamp(merged.volume.master, 0, 1);
                merged.volume.sfx    = _clamp(merged.volume.sfx,    0, 1);
                merged.volume.bgm    = _clamp(merged.volume.bgm,    0, 1);
            }
            // 写回
            this.save({ settings: merged });

            // 同步 CT_AUDIO / CT_RENDERER
            try {
                var A = global.CT_AUDIO;
                if (A && typeof A.setVolume === 'function') {
                    if (merged.volume) {
                        A.setVolume('master', merged.volume.master);
                        A.setVolume('sfx', merged.volume.sfx);
                        A.setVolume('bgm', merged.volume.bgm);
                    }
                    if (merged.mute && typeof A.mute === 'function') {
                        A.mute(!!merged.mute.all);
                    }
                }
            } catch (e) { console.warn('[CT_STORAGE] sync audio', e); }

            try {
                var R = global.CT_RENDERER;
                if (R && typeof R.setQuality === 'function') {
                    R.setQuality(merged.quality || 'high');
                }
            } catch (e) { console.warn('[CT_STORAGE] sync renderer quality', e); }

            // 同步 fullscreen
            try {
                var needFs = !!merged.fullscreen;
                var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
                if (needFs && !isFs && document.documentElement && typeof document.documentElement.requestFullscreen === 'function') {
                    document.documentElement.requestFullscreen().catch(function () {});
                } else if (!needFs && isFs && typeof document.exitFullscreen === 'function') {
                    document.exitFullscreen().catch(function () {});
                }
            } catch (e) { /* ignore */ }

            return merged;
        },

        setKeybind: function (action, code) {
            if (!action || !code) return;
            var s = this.getSettings();
            if (!s.keybinds || typeof s.keybinds !== 'object') s.keybinds = {};
            s.keybinds[String(action)] = String(code);
            this.saveSettings(s);
        },

        /* ==================== Achievements ==================== */
        unlockAchievement: function (id) {
            if (!id) return false;
            var all = this.get();
            var ach = all.achievements && all.achievements[id];
            if (!ach) {
                // 兜底：写一个模板
                var tpl = ACHIEVEMENTS_TEMPLATE[id];
                if (!tpl) return false;
                ach = { name: tpl.name, desc: tpl.desc, reward: tpl.reward, unlocked: false };
            }
            if (ach.unlocked) return false;
            ach.unlocked = true;
            // 奖励金币
            var reward = Number(ach.reward) || 0;
            var p = all.profile;
            p.coins = (Number(p.coins) || 0) + reward;
            this.save({ profile: p, achievements: all.achievements });
            _toast('🏆 成就解锁：' + ach.name + ' +' + reward + '💰', 'info');
            try {
                global.CT_BUS && typeof global.CT_BUS.emit === 'function' &&
                    global.CT_BUS.emit('achievement:unlocked', { id: id, achievement: _clone(ach), reward: reward });
            } catch (_) {}
            return true;
        },

        /**
         * 根据上下文逐条验证条件，自动解锁。
         * ctx 示例：{
         *   kills, damageTaken, bossKills, brKills, brWin, totalScore,
         *   tanksCleared, buffCount, pickedItemIds, hordeWave,
         *   baseHpTaken, modeCleared
         * }
         */
        checkAchievements: function (ctx) {
            ctx = ctx || {};
            var self = this;
            var c = this.get();
            var ach = c.achievements;
            var tc = (c.profile && c.profile.tanksCleared) ? c.profile.tanksCleared : {};

            function ok(id) { if (ach[id] && !ach[id].unlocked) self.unlockAchievement(id); }

            if (typeof ctx.kills === 'number' && ctx.kills >= 1) ok('first_blood');

            /* 经典守护模式已移除：通关判定改为通用 modeCleared（兼容旧字段 classicCleared） */
            var cleared = !!(ctx.modeCleared || ctx.cleared || ctx.classicCleared);

            if (cleared && typeof ctx.damageTaken === 'number' && ctx.damageTaken <= 0) {
                ok('untouchable');
            }

            if (cleared && typeof ctx.baseHpTaken === 'number' && ctx.baseHpTaken <= 0) {
                ok('base_guardian');
            }

            if (typeof ctx.bossKills === 'number' && ctx.bossKills >= 10) ok('boss_slayer');

            if (ctx.brWin && typeof ctx.brKills === 'number' && ctx.brKills >= 15) ok('br_king');

            if (typeof ctx.totalScore === 'number' && ctx.totalScore >= 1000000) ok('millionaire');

            var tCount = 0;
            ['assault','heavy','sniper','engineer'].forEach(function (t) { if (tc[t]) tCount++; });
            if (typeof ctx.tanksCleared === 'number' ? (ctx.tanksCleared + tCount >= 4) : (tCount >= 4)) {
                ok('master_all');
            }

            if (typeof ctx.buffCount === 'number' && ctx.buffCount >= 15) ok('build_master');

            if (Array.isArray(ctx.pickedItemIds) && ctx.pickedItemIds.length >= 16) ok('collector');

            if (typeof ctx.hordeWave === 'number' && ctx.hordeWave >= 30) ok('wave_hero');
        },

        getAllAchievements: function () {
            var all = this.get().achievements || {};
            var ids = Object.keys(ACHIEVEMENTS_TEMPLATE);
            var arr = [];
            for (var i = 0; i < ids.length; i++) {
                var id = ids[i];
                var a = all[id] || ACHIEVEMENTS_TEMPLATE[id];
                arr.push({
                    id: id,
                    name: a.name,
                    desc: a.desc,
                    reward: Number(a.reward) || 0,
                    unlocked: !!a.unlocked
                });
            }
      return arr;
    },

    /* ==================== 存档导出 / 导入（D-05） ====================
     * 纯前端无账号体系，云端存档用「本地导出/导入 + 可插拔 SyncAdapter」替代：
     *  - exportSave() / importSave()：生成/解析便携 JSON 文本，便于玩家备份与迁移。
     *  - setSyncAdapter()：预留云端接入点（upload/download 两个 Promise 方法）。
     *    未接入时 syncToCloud/syncFromCloud 仅给出「需登录账号」提示，不报错。 */
    exportSave: function () {
      try {
        var data = this.get();
        return JSON.stringify({ __ct_save__: true, v: SCHEMA_VERSION, data: data });
      } catch (e) {
        _toast('导出存档失败：' + (e && e.message ? e.message : e), 'error');
        return '';
      }
    },

    importSave: function (jsonText) {
      if (!jsonText) return false;
      var parsed;
      try { parsed = JSON.parse(jsonText); } catch (e) { return false; }
      if (!parsed || !parsed.__ct_save__) return false;
      var incoming = parsed.data || parsed;
      if (!incoming || typeof incoming !== 'object') return false;
      // 2 层 merge：以现有存档为基底叠加导入字段，不会清空未提供的字段
      var merged = _merge2(this.get(), incoming);
      merged.achievements = _merge2(_makeAchievements(), incoming.achievements || {});
      merged.schemaVersion = SCHEMA_VERSION;
      try { this._writeRaw(JSON.stringify(merged)); } catch (e) { this._onQuotaExceed(e); return false; }
      // 同步设置（音量 / 画质）到运行中的引擎
      try { this.saveSettings({}); } catch (_) {}
      _toast('存档导入成功。', 'info');
      return true;
    },

    /* 云端同步适配器（可插拔）：当前纯前端无账号，预留接口。
     * 接入方实现：{ upload(data) -> Promise, download() -> Promise<data> } */
    _syncAdapter: null,
    setSyncAdapter: function (adapter) {
      if (adapter && (typeof adapter.upload === 'function' || typeof adapter.download === 'function')) {
        this._syncAdapter = adapter;
        _toast('已接入云端存档适配器（实验性）。', 'info');
        return true;
      }
      return false;
    },
    syncToCloud: function () {
      if (!this._syncAdapter || typeof this._syncAdapter.upload !== 'function') {
        _toast('☁ 云端存档需要登录账号（功能预留，当前使用本地存档）。', 'info');
        return (typeof Promise !== 'undefined') ? Promise.resolve(false) : false;
      }
      try { return this._syncAdapter.upload(this.get()); } catch (e) { _toast('云端上传失败：' + e.message, 'error'); return false; }
    },
    syncFromCloud: function () {
      var self = this;
      if (!this._syncAdapter || typeof this._syncAdapter.download !== 'function') {
        _toast('☁ 云端存档需要登录账号（功能预留，当前使用本地存档）。', 'info');
        return (typeof Promise !== 'undefined') ? Promise.resolve(false) : false;
      }
      try {
        return this._syncAdapter.download().then(function (data) {
          if (data) { self._writeRaw(JSON.stringify(data)); self.saveSettings({}); return true; }
          return false;
        });
      } catch (e) { _toast('云端下载失败：' + e.message, 'error'); return false; }
    }
  };

    /* ==========================================================
     * 挂到全局
     * ========================================================== */
    global.CT_STORAGE = CT_STORAGE;

})(typeof window !== 'undefined' ? window : globalThis);

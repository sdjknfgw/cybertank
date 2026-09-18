/* ==========================================================
 * CyberTank — 联机段位系统（PvP Rank / Tier）
 * window.CT_PVP
 * 段位划分（基于 pvpRating 积分，初始 1000）：
 *   青铜 0+ · 白银 1100+ · 黄金 1300+ · 铂金 1500+ · 钻石 1700+ · 王者 1900+
 * 积分规则（BO5）：
 *   胜：+25/-2×负局数（3:0 +25 · 3:1 +23 · 3:2 +21）
 *   负：-16/+2×胜局数（0:3 -16 · 1:3 -14 · 2:3 -12），下限 900
 * ========================================================== */
(function (global) {
    'use strict';

    const TIERS = [
        { name: '青铜', emoji: '🥉', color: '#c98f5a', min: 0 },
        { name: '白银', emoji: '🥈', color: '#c7d0dd', min: 1100 },
        { name: '黄金', emoji: '🥇', color: '#ffd54a', min: 1300 },
        { name: '铂金', emoji: '💠', color: '#7ef0d4', min: 1500 },
        { name: '钻石', emoji: '💎', color: '#7ec8ff', min: 1700 },
        { name: '王者', emoji: '👑', color: '#ff2a6d', min: 1900 },
    ];

    const DEFAULT_RATING = 1000;

    function clampRating(r) {
        r = Number(r);
        if (!isFinite(r)) r = DEFAULT_RATING;
        return Math.max(900, Math.min(3999, Math.round(r)));
    }

    /** 积分 → 段位对象 {name, emoji, color, min} */
    function tierOf(rating) {
        const r = Number(rating) || DEFAULT_RATING;
        let t = TIERS[0];
        for (let i = 0; i < TIERS.length; i++) if (r >= TIERS[i].min) t = TIERS[i];
        return t;
    }

    /** 积分 → 下一段位（王者返回 null） */
    function nextTierOf(rating) {
        const t = tierOf(rating);
        const i = TIERS.indexOf(t);
        return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : null;
    }

    /** 段位徽章 HTML 片段（emoji + 名称 + 分），用于大厅/榜单/房间列表 */
    function tierBadge(rating, withScore) {
        const t = tierOf(rating);
        const r = clampRating(rating);
        return '<span style="color:' + t.color + '">' + t.emoji + ' ' + t.name +
            (withScore ? ' <span style="opacity:.75">' + r + '</span>' : '') + '</span>';
    }

    /** 结算积分变化：胜 25-2×负局，负 -(16-2×胜局) */
    function ratingDelta(win, roundsWon, roundsLost) {
        const rw = Math.max(0, Math.min(3, Number(roundsWon) || 0));
        const rl = Math.max(0, Math.min(3, Number(roundsLost) || 0));
        return win ? (25 - 2 * rl) : -(16 - 2 * rw);
    }

    /** 当前登录用户的 PvP 资料（未登录返回 null） */
    function myProfile() {
        try {
            const BE = global.CT_BACKEND;
            const u = BE && BE.getUser && BE.getUser();
            if (!u || !u.username) return null;
            return {
                name: u.username,
                rating: clampRating(u.pvpRating),
                wins: Math.max(0, Number(u.pvpWins) || 0),
                losses: Math.max(0, Number(u.pvpLosses) || 0),
            };
        } catch (_) { return null; }
    }

    global.CT_PVP = {
        TIERS: TIERS,
        DEFAULT_RATING: DEFAULT_RATING,
        clampRating: clampRating,
        tierOf: tierOf,
        nextTierOf: nextTierOf,
        tierBadge: tierBadge,
        ratingDelta: ratingDelta,
        myProfile: myProfile,
    };
})(typeof window !== 'undefined' ? window : globalThis);

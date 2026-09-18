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
    const FLOOR_RATING = 900;
    let _iconSeq = 0;   // SVG 渐变 ID 计数（同页多徽章防 ID 撞车）

    /* #rrggbb + alpha → rgba() */
    function hexA(hex, a) {
        const h = String(hex || '#ffffff').replace('#', '');
        const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

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

    /* ---------- 统一段位徽章：六边形护盾 + V 形纹章（等级 1~6） ----------
     * 六个段位同一形状，仅段位色与纹章数不同；SVG 用于 DOM（大厅/榜单/结算卡），
     * Canvas 版用于游戏内绘制（VS 卡/HUD/等待界面），两版视觉完全一致 */
    const SHIELD = [[12, 1], [22.2, 6.8], [22.2, 20.2], [12, 27], [1.8, 20.2], [1.8, 6.8]];

    /** 段位徽章 SVG（内联，tierIcon(tierOf(rating), size)） */
    function tierIcon(tier, size) {
        size = Number(size) || 18;
        const lvl = TIERS.indexOf(tier) + 1, c = tier.color;
        const gid = 'ctTierG' + (++_iconSeq);
        let chev = '';
        for (let i = 0; i < lvl; i++) {
            const y = 10 + i * 2.5;
            chev += '<path d="M8.5 ' + y + ' L12 ' + (y + 2.2) + ' L15.5 ' + y +
                '" fill="none" stroke="' + c + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
        }
        return '<svg width="' + size + '" height="' + Math.round(size * 28 / 24) + '" viewBox="0 0 24 28" ' +
            'style="flex:none;filter:drop-shadow(0 0 3px ' + hexA(c, .55) + ')">' +
            '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="' + c + '" stop-opacity=".55"/>' +
            '<stop offset="1" stop-color="' + c + '" stop-opacity=".12"/></linearGradient></defs>' +
            '<path d="M12 1 L22.2 6.8 V20.2 L12 27 L1.8 20.2 V6.8 Z" fill="url(#' + gid + ')" stroke="' + c + '" stroke-width="1.4"/>' +
            chev + '</svg>';
    }

    /** 段位徽章 Canvas 版：以 (cx,cy) 为中心画 size 宽的护盾（与 SVG 同构） */
    function drawTierBadge(ctx, cx, cy, size, rating) {
        const t = tierOf(rating), lvl = TIERS.indexOf(t) + 1;
        const s = size / 24, hh = size * 28 / 24;
        const x0 = cx - size / 2, y0 = cy - hh / 2;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x0 + SHIELD[0][0] * s, y0 + SHIELD[0][1] * s);
        for (let i = 1; i < SHIELD.length; i++) ctx.lineTo(x0 + SHIELD[i][0] * s, y0 + SHIELD[i][1] * s);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, y0, 0, y0 + hh);
        g.addColorStop(0, hexA(t.color, .55)); g.addColorStop(1, hexA(t.color, .12));
        ctx.shadowColor = hexA(t.color, .55); ctx.shadowBlur = 4 * s;
        ctx.fillStyle = g; ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = t.color; ctx.lineWidth = Math.max(1, 1.4 * s); ctx.stroke();
        ctx.lineWidth = Math.max(1, 1.5 * s);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = t.color;
        for (let i = 0; i < lvl; i++) {
            const y = y0 + (10 + i * 2.5) * s;
            ctx.beginPath();
            ctx.moveTo(x0 + 8.5 * s, y);
            ctx.lineTo(x0 + 12 * s, y + 2.2 * s);
            ctx.lineTo(x0 + 15.5 * s, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    /** 段位徽章 HTML 片段（徽章图标 + 名称 + 分），用于大厅/榜单/房间列表/结算卡 */
    function tierBadge(rating, withScore) {
        const t = tierOf(rating);
        const r = clampRating(rating);
        return '<span style="display:inline-flex;align-items:center;gap:5px;color:' + t.color + '">' +
            tierIcon(t, 17) +
            '<b style="font-weight:700">' + t.name + '</b>' +
            (withScore ? '<span style="opacity:.8;font-family:ui-monospace,monospace">' + r + '</span>' : '') +
            '</span>';
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
        tierIcon: tierIcon,
        drawTierBadge: drawTierBadge,
        hexA: hexA,
        ratingDelta: ratingDelta,
        myProfile: myProfile,
    };
})(typeof window !== 'undefined' ? window : globalThis);

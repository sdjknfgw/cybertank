/* CYBERTANK · Shop UI (Task) · window.CT_UI_SHOP · 14 检查点全实现 */
(function () {
  'use strict';
  const EB = () => window.CT_BUS || window.EventBus || { on() {}, emit() {}, off() {} };
  const bus = EB();
  const $r = (s) => document.querySelector(s);
  const RR = { common: 0, rare: 1, epic: 2, legendary: 3 };
  const RH = { common: '1px', rare: '2px', epic: '3px', legendary: '3px' };
  const RL = { common: '普 通', rare: '稀 有', epic: '史 诗', legendary: '传 奇' };
  const TABS = [{ k: 'consumable', l: '🎒 道具' }, { k: 'buff', l: '⚔️ 增益' }, { k: 'equipment', l: '🛡️ 装备' }, { k: 'special', l: '💎 特供' }];
  const FB = { common: '#9ca3af', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b' };
  function el(t, h, s, a) { const d = document.createElement(t); if (h != null) d.innerHTML = h; if (s) Object.assign(d.style, s); if (a) for (const k in a) d.setAttribute(k, a[k]); return d; }
  function rv(n, fb) { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v && v.length ? v : (fb || ''); }
  function rc(r) { return rv('--rarity-' + r, FB[r] || '#888'); }
  const CY = () => rv('--neon-cyan', '#00e5ff'), MG = () => rv('--neon-magenta', '#ff2bd6'), AU = () => rv('--coin-gold', '#ffc93c');

  /* ================== 独立 Canvas FX (z-60) · 检查点 9 ================== */
  class SPFX {
    constructor(h) {
      this.c = el('canvas', '', { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 60 }, { id: 'shop-fx-local' });
      this.x = this.c.getContext('2d'); h.appendChild(this.c); this.h = h; this.is = []; this.run = false; this.rsz();
      window.addEventListener('resize', () => this.rsz());
    }
    rsz() {
      const r = this.h.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      this.c.width = r.width * dpr; this.c.height = r.height * dpr;
      this.c.style.width = r.width + 'px'; this.c.style.height = r.height + 'px';
      this.x.setTransform(dpr, 0, 0, dpr, 0, 0); this.W = r.width; this.H = r.height;
    }
    burstBuySuccess(br, pr) {
      if (!br || !pr) return;
      const px = br.left + br.width / 2 - pr.left, py = br.top + br.height / 2 - pr.top;
      for (let i = 0; i < 16; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2, s = 2 + Math.random() * 4; this.is.push({ K: 'C', x: px, y: py, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, l: 1, d: 0.012 + Math.random() * 0.01, r: 3 + Math.random() * 2, g: 0.18, rot: Math.random() * 6.28 }); }
      for (let i = 0; i < 2; i++) this.is.push({ K: 'R', x: px, y: py, rr: 6, mx: 60 + i * 28, l: 1, d: 0.030 - i * 0.008, c: i ? MG() : AU() });
      this.go();
    }
    go() {
      if (this.run) return; this.run = true;
      const lp = () => { this.tk(); if (this.is.length) requestAnimationFrame(lp); else this.run = false; };
      requestAnimationFrame(lp);
    }
    tk() {
      const x = this.x; x.clearRect(0, 0, this.W, this.H);
      for (let i = this.is.length - 1; i >= 0; i--) {
        const p = this.is[i];
        if (p.K === 'R') {
          p.rr += (p.mx - p.rr) * 0.09; p.l -= p.d; if (p.l <= 0) { this.is.splice(i, 1); continue; }
          x.strokeStyle = p.c; x.lineWidth = 2; x.globalAlpha = Math.max(0, p.l);
          x.shadowColor = p.c; x.shadowBlur = 14; x.beginPath(); x.arc(p.x, p.y, p.rr, 0, 6.283); x.stroke();
          x.shadowBlur = 0; x.globalAlpha = 1;
        } else {
          p.x += p.vx; p.y += p.vy; p.vx *= 0.985; p.vy += p.g; p.rot += 0.3; p.l -= p.d;
          if (p.l <= 0) { this.is.splice(i, 1); continue; }
          x.save(); x.translate(p.x, p.y); x.rotate(p.rot); x.fillStyle = AU();
          x.globalAlpha = Math.max(0, p.l); x.shadowColor = AU(); x.shadowBlur = 12;
          x.beginPath(); x.arc(0, 0, p.r, 0, 6.283); x.fill();
          x.globalAlpha = Math.max(0, p.l) * 0.8; x.fillStyle = '#fff6c2';
          x.fillRect(-p.r * 0.7, -p.r * 0.25, p.r * 1.4, p.r * 0.5);
          x.shadowBlur = 0; x.globalAlpha = 1; x.restore();
        }
      }
    }
    destroy() { this.is.length = 0; this.c.remove(); }
  }

  /* ================== 四角装饰 / 背景 FX / 坦克预览 ================== */
  function corners(p) {
    const mk = (clr, pos) => el('div', '', { cssText: 'position:absolute;width:8px;height:8px;border-style:solid;border-color:' + clr + ';filter:drop-shadow(0 0 4px ' + clr + ');' + (pos.t ? 'top:' + pos.t + ';' : '') + (pos.b ? 'bottom:' + pos.b + ';' : '') + (pos.l ? 'left:' + pos.l + ';' : '') + (pos.r ? 'right:' + pos.r + ';' : '') + 'border-width:' + pos.bw + ';' });
    const cy = CY(), mg = MG();
    [mk(cy, { t: '-1px', l: '-1px', bw: '2px 0 0 2px' }), mk(cy, { t: '-1px', r: '-1px', bw: '2px 2px 0 0' }),
     mk(mg, { b: '-1px', l: '-1px', bw: '0 0 2px 2px' }), mk(mg, { b: '-1px', r: '-1px', bw: '0 2px 2px 0' })].forEach(c => p.appendChild(c));
  }
  function bgfx(p) {
    p.appendChild(el('div', '', { position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none', backgroundImage: 'linear-gradient(rgba(0,229,255,0.045) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,0.045) 1px,transparent 1px)', backgroundSize: '24px 24px' }));
    const s = el('div', '', { position: 'absolute', left: 0, right: 0, top: 0, height: '4px', background: 'linear-gradient(180deg,transparent,rgba(0,229,255,0.32),transparent)', pointerEvents: 'none' });
    s.classList.add('anim-scanLine'); p.appendChild(s);
  }
  function tankPrev(cv, pl) {
    try {
      const x = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = 80 * dpr; cv.height = 80 * dpr; cv.style.width = '80px'; cv.style.height = '80px';
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, 80, 80);
      const eq = Array.isArray(pl && pl.equipments) ? pl.equipments : [];
      const cx = 40, cy = 46;
      x.fillStyle = 'rgba(0,0,0,0.45)'; x.beginPath(); x.ellipse(cx, cy + 18, 26, 5, 0, 0, 6.283); x.fill();
      const tg = eq.includes('E02');
      x.fillStyle = tg ? 'rgba(0,229,255,0.28)' : '#1a2240'; x.fillRect(cx - 24, cy + 2, 48, 12);
      x.strokeStyle = tg ? CY() : '#33406a'; x.lineWidth = 1.2; x.strokeRect(cx - 24, cy + 2, 48, 12);
      if (eq.includes('E03')) { x.fillStyle = 'rgba(168,85,247,0.22)'; x.fillRect(cx - 22, cy - 8, 44, 12); x.strokeStyle = rc('epic'); x.strokeRect(cx - 22, cy - 8, 44, 12); }
      const g = x.createLinearGradient(cx - 22, cy - 10, cx + 22, cy + 6);
      g.addColorStop(0, '#2e4278'); g.addColorStop(0.5, '#4561a8'); g.addColorStop(1, '#1c2852'); x.fillStyle = g;
      x.beginPath(); x.moveTo(cx - 22, cy + 2); x.lineTo(cx - 18, cy - 10); x.lineTo(cx + 18, cy - 10); x.lineTo(cx + 22, cy + 2); x.closePath(); x.fill();
      x.strokeStyle = CY(); x.lineWidth = 1; x.shadowColor = CY(); x.shadowBlur = 6; x.stroke(); x.shadowBlur = 0;
      x.fillStyle = '#3a5398'; x.beginPath(); x.arc(cx, cy - 10, 10, 0, 6.283); x.fill(); x.strokeStyle = CY(); x.stroke();
      const bt = eq.includes('E01') ? 4.2 : 2.8; x.fillStyle = eq.includes('E01') ? '#dfe8ff' : '#88a3d8';
      x.fillRect(cx - 1, cy - 26, bt, 18); x.strokeStyle = '#fff'; x.lineWidth = 0.6; x.strokeRect(cx - 1, cy - 26, bt, 18);
      if (eq.includes('E05')) { x.strokeStyle = rc('rare'); x.lineWidth = 1; x.beginPath(); x.arc(cx, cy - 26, 5, 0, 6.283); x.stroke(); }
      if (eq.includes('E04')) { const fg = x.createRadialGradient(cx - 20, cy + 4, 0, cx - 20, cy + 4, 10); fg.addColorStop(0, '#ff66e0'); fg.addColorStop(1, 'transparent'); x.fillStyle = fg; x.fillRect(cx - 30, cy - 2, 12, 12); }
    } catch (e) { /* ignore */ }
  }

  /* ================== 商品卡片 renderCard ================== */
  function rCard(it, idx, C) {
    const r = it.rarity || 'common', c = rc(r), ep = RR[r] >= 2;
    const coins = C.player.coins || 0, disc = Number(C.shop.discount) || 1, fp = Math.ceil(it.price * disc);
    const hasDisc = disc < 1, sold = (it.stockLeft || 0) <= 0, poor = coins < fp;
    /* 前置链检查：B06 需 B01、B11 需 B06 等。此前金币足够但前置未买时
     * 点击只 shake 无提示 → 用户以为"金币足够却买不了"。现在置灰并标注前置 */
    const shAll = window.CT_SHOP;
    const def = shAll && shAll.ITEMS ? shAll.ITEMS[it.id] : null;
    const preId = def && def.prereq;
    const preOk = !preId || (Array.isArray(C.player.purchasedBuffs) && C.player.purchasedBuffs.includes(preId));
    const preName = preId && shAll && shAll.ITEMS && shAll.ITEMS[preId] ? shAll.ITEMS[preId].name : preId;
    const cd = el('div', '', { position: 'relative', display: 'flex', flexDirection: 'column', borderRadius: '14px', padding: '12px', minHeight: '280px', background: 'linear-gradient(180deg, rgba(10,16,36,0.82), rgba(8,12,26,0.95))', border: '1px solid ' + c, boxShadow: '0 0 12px ' + c + '55, inset 0 0 14px ' + c + '14', transition: 'transform 180ms ease, box-shadow 200ms ease, filter 200ms ease', overflow: 'hidden', cursor: sold ? 'default' : 'pointer', filter: sold ? 'grayscale(0.6) opacity(0.7)' : '' }, { 'data-cat': it.cat, 'data-id': it.id, class: 'card-' + r });
    cd.appendChild(el('div', '', { position: 'absolute', top: 0, left: 0, right: 0, height: RH[r], background: c, boxShadow: '0 0 14px ' + c + 'dd' }));
    if (ep) {
      const s = 'position:absolute;width:10px;height:10px;border-style:solid;border-color:' + c + ';filter:drop-shadow(0 0 4px ' + c + ');';
      [{ t: '10px', l: '10px', w: '2px 0 0 2px' }, { t: '10px', r: '10px', w: '2px 2px 0 0' }, { b: '10px', l: '10px', w: '0 0 2px 2px' }, { b: '10px', r: '10px', w: '0 2px 2px 0' }].forEach(p => cd.appendChild(el('div', '', { cssText: s + (p.t ? 'top:' + p.t + ';' : '') + (p.b ? 'bottom:' + p.b + ';' : '') + (p.l ? 'left:' + p.l + ';' : '') + (p.r ? 'right:' + p.r + ';' : '') + 'border-width:' + p.w + ';' })));
    }
    if (r === 'legendary') {
      cd.appendChild(el('div', '', { position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,201,60,0.06) 0 6px, rgba(255,43,214,0.05) 6px 12px)', pointerEvents: 'none' })).classList.add('hologram');
      const bm = el('div', '', { position: 'absolute', top: 0, bottom: 0, left: '-30%', width: '60%', background: 'linear-gradient(90deg, transparent, rgba(255,201,60,0.22), transparent)', transform: 'skewX(-18deg)' });
      bm.classList.add('anim-shine'); cd.appendChild(bm);
    }
    const ia = el('div', '', { height: '120px', marginTop: RH[r], position: 'relative', background: c + '14', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 18px ' + c + '22', overflow: 'hidden' });
    ia.appendChild(el('div', '', { position: 'absolute', width: '110px', height: '110px', background: 'radial-gradient(circle,' + c + '66 0%,transparent 65%)', filter: 'blur(18px)', pointerEvents: 'none' }));
    const ic = el('div', it.icon || '✦', { fontSize: '56px', lineHeight: 1, position: 'relative', textShadow: '0 0 12px ' + c + 'aa' });
    ic.classList.add('anim-floatY'); ia.appendChild(ic); cd.appendChild(ia);
    const r1 = el('div', '', { display: 'flex', justifyContent: 'space-between', padding: '6px 2px 0' });
    r1.appendChild(el('div', RL[r] || 'COMMON', { padding: '2px 8px', borderRadius: '999px', fontSize: '9px', fontFamily: 'JetBrains Mono,monospace', letterSpacing: '0.1em', border: '1px solid ' + c, color: c, background: c + '18', boxShadow: '0 0 6px ' + c + '55' }));
    r1.appendChild(el('div', it.stockLeft === Infinity ? '∞' : '×' + (it.stockLeft || 0), { fontSize: '10px', color: 'var(--text-lo)', fontFamily: 'JetBrains Mono,monospace' }));
    cd.appendChild(r1);
    cd.appendChild(el('div', it.name || 'Item', { padding: '6px 2px 0', color: 'var(--text-hi)', fontSize: '15px', fontWeight: 700 }));
    cd.appendChild(el('div', it.desc || '', { padding: '2px 2px 8px', color: 'var(--text-lo)', fontSize: '11px', lineHeight: 1.45, minHeight: '32px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }));
    const pr = el('div', '', { display: 'flex', alignItems: 'center', gap: '6px', padding: '0 2px 6px' });
    if (hasDisc) {
      pr.appendChild(el('span', it.price + ' 💰', { color: 'var(--text-lo)', fontSize: '11px', textDecoration: 'line-through', textDecorationColor: MG() }));
      pr.appendChild(el('span', '-' + Math.round((1 - disc) * 100) + '%', { padding: '1px 6px', borderRadius: '999px', fontSize: '10px', background: 'rgba(255,43,214,0.16)', color: MG(), border: '1px solid rgba(255,43,214,0.45)' }));
    }
    const pv = el('span', fp + ' 💰', { fontSize: '14px', fontWeight: 800, fontFamily: 'JetBrains Mono,monospace' });
    pv.classList.add('text-glow-gold'); pr.appendChild(pv); cd.appendChild(pr);
    const bw = el('div', '', { marginTop: 'auto', padding: '4px 0 2px' });
    const btn = el('button', '', { width: '100%', padding: '10px 8px', borderRadius: '8px', fontWeight: 800, fontSize: !preOk ? '11px' : '13px', fontFamily: 'Share Tech Mono,monospace', letterSpacing: !preOk ? '0.04em' : '0.18em', cursor: 'pointer', position: 'relative', overflow: 'hidden', border: '1px solid ' + c, color: (poor || !preOk) ? 'var(--danger)' : 'var(--text-hi)', background: (poor || !preOk) ? 'rgba(30,41,59,0.5)' : 'linear-gradient(135deg,' + c + '33,' + c + '0a 60%,rgba(255,255,255,0.04))', boxShadow: (poor || !preOk) ? 'none' : '0 0 10px ' + c + '66, inset 0 0 10px ' + c + '22', transition: 'all 160ms ease' });
    btn.innerHTML = sold ? '已售罄' : (!preOk ? '需前置: ' + (preName || '') : (poor ? '金币不足' : '购  买')); btn.disabled = !!sold || !!poor || !preOk;
    if (!preOk) btn.title = '需先购买前置商品：' + (preName || preId);
    if (!btn.disabled) { const sh = el('div', '', { position: 'absolute', inset: 0, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)', transform: 'translateX(-120%) skewX(-20deg)', pointerEvents: 'none' }); sh.classList.add('anim-shine'); btn.appendChild(sh); }
    btn.addEventListener('mouseenter', () => { if (btn.disabled) return; cd.style.transform = 'translateY(-3px)'; cd.style.boxShadow = '0 10px 26px ' + c + '88, inset 0 0 22px ' + c + '33'; });
    btn.addEventListener('mouseleave', () => { cd.style.transform = ''; cd.style.boxShadow = '0 0 12px ' + c + '55, inset 0 0 14px ' + c + '14'; });
    bw.appendChild(btn); cd.appendChild(bw);
    if (sold) cd.appendChild(el('div', 'SOLD OUT', { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%) rotate(-12deg)', padding: '6px 14px', border: '3px solid #6b7280', color: '#6b7280', fontFamily: 'JetBrains Mono,monospace', fontWeight: 800, fontSize: '20px', letterSpacing: '0.12em', borderRadius: '6px', background: 'rgba(30,41,59,0.55)', pointerEvents: 'none' }));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) { cd.classList.remove('anim-shake'); void cd.offsetWidth; cd.classList.add('anim-shake'); const ob = btn.style.background; btn.style.background = 'rgba(255,56,96,0.28)'; if (C.coinEl) C.coinEl.dataset.flash = '1'; setTimeout(() => btn.style.background = ob, 220); return; }
      const res = C.shop.purchase(C.player, it.id);
      if (!res || !res.ok) {
        /* 失败原因 toast：此前只 shake 不解释，"金币足够却买不了"实际是
         * 前置未购/售罄/已拥有等原因，用户无从得知 */
        try {
          const modal = window.CT_UI_MODAL;
          if (modal && typeof modal.showToast === 'function') modal.showToast('购买失败：' + ((res && res.msg) || '未知原因'), 'error');
        } catch (e) { }
        cd.classList.remove('anim-shake'); void cd.offsetWidth; cd.classList.add('anim-shake'); btn.style.background = 'rgba(255,56,96,0.28)'; if (C.coinEl) C.coinEl.dataset.flash = '1'; setTimeout(() => btn.style.background = '', 220); return;
      }
      try { const br2 = btn.getBoundingClientRect(), pr2 = C.panel.getBoundingClientRect(); C.fx.burstBuySuccess(br2, pr2); } catch (err) { }
      if (C.invEl) { C.invEl.classList.remove('anim-shake'); void C.invEl.offsetWidth; C.invEl.classList.add('anim-shake'); }
      if (C.rf) C.rf(); if (C.sc) C.sc(); if (C.si) C.si(); if (C.cv) tankPrev(C.cv, C.player);
    });
    return cd;
  }

  /* ================== 主对象 ================== */
  const S = {
    /* 实例代数：每次 open 递增。close 的延迟 done 回调执行时若代数已变
     * （说明期间开过新商店），必须跳过清空 —— 否则新商店会被旧实例的
     * setTimeout(done, 320) 意外清掉 → "选完增益后商店闪退"的根因 */
    _gen: 0,
    open(opts) {
      /* 防重入：若上一实例的资源还活着（timer/observer/引擎句柄），先彻底清理。
       * 此前直接覆盖 S._tm 等属性，旧 interval 泄漏后其 rem 递减到 0 会
       * 调 S.close() 关掉正在展示的新商店 */
      if (S._tm) { try { clearInterval(S._tm); } catch (e) {} S._tm = null; }
      if (S._ro2) { try { S._ro2.disconnect(); } catch (e) {} S._ro2 = null; }
      if (S._mfo) { try { S._mfo.disconnect(); } catch (e) {} S._mfo = null; }
      if (S._et) {
        try {
          const eng0 = window.CT_ENGINE;
          if (eng0 && typeof eng0.unregisterUpdate === 'function') eng0.unregisterUpdate(S._et);
        } catch (e) {}
        S._et = null;
      }
      S._gen = (S._gen || 0) + 1;
      const o = opts || {}, pl = o.player || { coins: 0, equipments: [], inventory: [], purchasedBuffs: [] }, boss = !!o.isBoss;
      const dur = Math.max(5, Number(o.duration) || 30), oC = typeof o.onClose === 'function' ? o.onClose : () => { };
      const sh = window.CT_SHOP || { currentStock: [], discount: 1, refreshCost: 20, locked: false, purchase() { return { ok: 0 }; }, manualRefresh() { return { ok: 0 }; }, lock() { this.locked = 1; }, refreshStock() { return []; } };
      try { sh.unlock && sh.unlock(); sh.resetRefreshCost && sh.resetRefreshCost(); } catch (e) { }
      if (!sh.currentStock || !sh.currentStock.length) try { sh.refreshStock(boss, boss ? 16 : 12); } catch (e) { }

      let root = $r('#shop-ui-root'); if (!root) { root = el('div', '', { position: 'fixed', inset: 0, zIndex: 2000 }, { id: 'shop-ui-root' }); document.body.appendChild(root); }
      /* index.html 预置的 .hidden 类是 display:none !important，会压过内联 display:block
       * → 打开时必须移除该类，否则商店永远不可见（"商店不出现"的样式层根因） */
      root.classList.remove('hidden');
      root.innerHTML = ''; root.style.display = 'block';

      // 检查点 1：遮罩 + 面板
      const mk = el('div', '', { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.68)', backdropFilter: 'blur(5px)' });
      mk.classList.add('anim-fadeIn'); mk.style.animationDuration = '300ms'; root.appendChild(mk);
      /* 居中容器：flex 布局而非 left/top + translate —— anim-scaleIn 的 keyframes
       * transform:scale(1)（animation-fill-mode:both）会永久覆盖内联 translate(-50%,-50%)，
       * 此前面板左上角停在屏幕中心、整体向右下溢出 → "商店看不见全貌"的根因 */
      const wrap = el('div', '', { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' });
      const pn = el('div', '', { position: 'relative', width: 'min(1080px, 94vw)', height: 'min(720px, 90vh)', boxSizing: 'border-box', borderRadius: '14px', overflow: 'hidden', background: 'var(--panel-bg)', backdropFilter: 'blur(12px)', border: '1px solid var(--panel-border)', padding: '16px', display: 'flex', flexDirection: 'column', transformOrigin: 'center', pointerEvents: 'auto' });
      pn.classList.add('glow-cyan-md', 'anim-scaleIn'); pn.style.animationDuration = '400ms';
      corners(pn); bgfx(pn);
      const fx = new SPFX(pn);

      // ===== 检查点 4：标题栏 =====
      const hd = el('div', '', { display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr', alignItems: 'center', height: '64px', marginBottom: '8px', position: 'relative', zIndex: 2 });
      const lg = el('div', '', { display: 'flex', alignItems: 'center', gap: '10px' });
      const lb = el('div', '◈', { width: '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: CY(), background: 'rgba(0,229,255,0.12)', border: '1px solid var(--neon-cyan)', boxShadow: '0 0 10px rgba(0,229,255,0.5)', fontFamily: 'Share Tech Mono,monospace' });
      const lt = el('div', '<div style="font-family:\'Share Tech Mono\',monospace;font-size:18px;letter-spacing:0.08em;" class="text-glow-cyan">CYBER_SHOP</div><div style="font-size:10px;color:var(--text-lo);font-family:\'JetBrains Mono\',monospace;">v2.77 · ' + (boss ? 'BOSS 特供节' : '第 9 节 补给') + '</div>');
      lg.appendChild(lb); lg.appendChild(lt); hd.appendChild(lg);
      const cc = el('div', '', { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px' });
      const cEl = el('div', '', { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 14px', borderRadius: '999px', background: 'rgba(255,201,60,0.10)', border: '1px solid rgba(255,201,60,0.35)' });
      const cIc = el('span', '💰', { fontSize: '18px' }); cIc.classList.add('anim-coinPulse');
      const cVl = el('span', String(pl.coins || 0), { fontFamily: 'JetBrains Mono,monospace', fontWeight: 800, fontSize: '15px', transition: 'color 200ms ease' });
      cVl.classList.add('text-glow-gold'); cEl.appendChild(cIc); cEl.appendChild(cVl); cc.appendChild(cEl);
      // 倒计时 检查点 4 + 13
      let rem = dur;
      const tEl = el('div', '', { padding: '6px 14px', borderRadius: '8px', minWidth: '110px', textAlign: 'center', fontFamily: 'JetBrains Mono,monospace', fontWeight: 800, fontSize: '15px', border: '1px solid rgba(0,229,255,0.35)', color: CY(), background: 'rgba(0,229,255,0.08)', transition: 'all 300ms ease' });
      tEl.classList.add('text-glow-cyan');
      function sT() {
        tEl.textContent = String(Math.max(0, rem)).padStart(2, '0') + 's';
        if (rem > 20) { tEl.style.color = CY(); tEl.style.borderColor = 'rgba(0,229,255,0.35)'; tEl.style.background = 'rgba(0,229,255,0.08)'; tEl.classList.remove('anim-blink'); }
        else if (rem > 10) { tEl.style.color = 'var(--warning)'; tEl.style.borderColor = 'rgba(255,179,0,0.45)'; tEl.style.background = 'rgba(255,179,0,0.08)'; tEl.classList.remove('anim-blink'); }
        else { tEl.style.color = MG(); tEl.style.borderColor = 'rgba(255,43,214,0.55)'; tEl.style.background = 'rgba(255,43,214,0.10)'; tEl.classList.add('anim-blink'); }
      }
      sT(); cc.appendChild(tEl);
      const dsc = Number(sh.discount) || 1;
      if (dsc < 1) { const db = el('div', '全场 ' + Math.round(dsc * 100) + '%', { padding: '4px 10px', fontSize: '11px', fontWeight: 800, borderRadius: '999px', color: MG(), border: '1px solid rgba(255,43,214,0.5)', background: 'rgba(255,43,214,0.10)', fontFamily: 'JetBrains Mono,monospace' }); db.classList.add('anim-scalePulse'); cc.appendChild(db); }
      hd.appendChild(cc);
      const cw = el('div', '', { display: 'flex', justifyContent: 'flex-end' });
      const xb = el('button', '✕', { width: '38px', height: '38px', borderRadius: '10px', fontSize: '16px', fontWeight: 700, fontFamily: 'JetBrains Mono,monospace', color: MG(), cursor: 'pointer', background: 'rgba(255,43,214,0.08)', border: '1px solid rgba(255,43,214,0.45)', transition: 'all 160ms ease' });
      xb.addEventListener('mouseenter', () => xb.classList.add('glow-magenta-sm'));
      xb.addEventListener('mouseleave', () => xb.classList.remove('glow-magenta-sm'));
      xb.addEventListener('mousedown', () => xb.style.transform = 'scale(0.95)');
      xb.addEventListener('mouseup', () => xb.style.transform = '');
      xb.addEventListener('click', () => S.close());
      cw.appendChild(xb); hd.appendChild(cw);
      // 金币红闪观察 (检查点 10)
      const mfo = new MutationObserver(() => { if (cEl.dataset.flash === '1') { cVl.style.color = 'var(--danger)'; setTimeout(() => { cVl.style.color = ''; cEl.dataset.flash = ''; }, 260); } });
      mfo.observe(cEl, { attributes: true, attributeFilter: ['data-flash'] });

      // ===== 检查点 5：Tab + 下划线滑动 =====
      const tr = el('div', '', { display: 'flex', gap: '8px', position: 'relative', paddingBottom: '6px', marginBottom: '10px', zIndex: 2 });
      const ti = el('div', '', { display: 'flex', gap: '8px', position: 'relative' });
      let cur = TABS[0].k, tEls = {};
      TABS.forEach(t => {
        const a = t.k === cur;
        const tb = el('button', t.l, { padding: '8px 18px', borderRadius: '8px 8px 0 0', fontSize: '12px', fontWeight: 700, fontFamily: 'JetBrains Mono,monospace', letterSpacing: '0.05em', cursor: 'pointer', border: a ? '1px solid rgba(0,229,255,0.30)' : '1px solid rgba(255,255,255,0.08)', background: a ? 'rgba(0,229,255,0.10)' : 'transparent', color: a ? CY() : 'var(--text-mid)', transition: 'all 200ms ease', position: 'relative' });
        if (a) tb.classList.add('glow-cyan-sm');
        tb.addEventListener('mouseenter', () => { if (!a) { tb.style.color = CY(); tb.style.borderColor = 'rgba(0,229,255,0.22)'; } });
        tb.addEventListener('mouseleave', () => { if (!a) { tb.style.color = 'var(--text-mid)'; tb.style.borderColor = 'rgba(255,255,255,0.08)'; } });
        tEls[t.k] = tb; ti.appendChild(tb);
      });
      const tln = el('div', '', { position: 'absolute', bottom: '-1px', height: '2px', background: 'linear-gradient(90deg, transparent, var(--neon-cyan), transparent)', boxShadow: '0 0 8px var(--neon-cyan)', transition: 'left 280ms cubic-bezier(.34,1.56,.64,1), width 280ms cubic-bezier(.34,1.56,.64,1)' });
      tr.appendChild(ti); tr.appendChild(tln);
      setTimeout(() => S._tabLine(tEls[cur], tln, ti), 0);

      // ===== 主体：侧栏 + 网格区 (检查点 11) =====
      const mn = el('div', '', { display: 'flex', gap: '12px', flex: 1, minHeight: 0, position: 'relative', zIndex: 2 });
      const sd = el('div', '', { width: '240px', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '8px', borderRight: '1px dashed rgba(0,229,255,0.18)' });
      sd.classList.add('hide-sm');
      const ep = el('div', '', { padding: '10px', borderRadius: '10px', background: 'rgba(10,16,36,0.70)', border: '1px solid rgba(0,229,255,0.18)' });
      ep.innerHTML = '<div style="display:flex;align-items:center;gap:6px;font-weight:800;font-size:12px;color:var(--neon-cyan);font-family:\'JetBrains Mono\',monospace;"><span style="width:3px;height:14px;background:var(--neon-cyan);box-shadow:0 0 6px var(--neon-cyan);"></span>敌情预告 · 下一波</div>';
      const eL = el('div', '', { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' });
      const dots = boss ? [{ n: 'BOSS · 泰坦 ' + 'ΣΩ' [Math.floor(Math.random() * 2)], c: '#ff2bd6' }] : [{ n: '普通坦克 × 6', c: '#64748b' }, { n: '快速坦克 × 3', c: '#22d3ee' }, { n: '精英 × 2', c: '#a855f7' }];
      dots.forEach(d => { const r = el('div', '', { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-mid)', fontFamily: 'JetBrains Mono,monospace' }); r.appendChild(el('span', '', { width: '8px', height: '8px', borderRadius: '50%', background: d.c, boxShadow: '0 0 6px ' + d.c })); r.appendChild(el('span', d.n)); eL.appendChild(r); });
      if (boss) { const bh = el('div', '', { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', padding: '6px', borderRadius: '8px', background: 'rgba(255,43,214,0.08)', border: '1px solid rgba(255,43,214,0.32)' }); bh.innerHTML = '<div style="font-size:26px;filter:drop-shadow(0 0 6px rgba(255,43,214,0.8));">👹</div><div style="flex:1;"><div style="font-size:12px;font-weight:800;color:var(--neon-magenta);">BOSS 降临</div><div style="font-size:10px;color:var(--text-lo);display:flex;gap:6px;margin-top:4px;"><span title="全屏爆裂" style="border:1px solid rgba(255,43,214,0.4);padding:1px 5px;border-radius:999px;">💥</span><span title="召唤小兵" style="border:1px solid rgba(0,229,255,0.4);padding:1px 5px;border-radius:999px;">🌀</span></div></div>'; ep.appendChild(bh); }
      ep.appendChild(eL); sd.appendChild(ep);
      // 已购道具 5 格 (5×48)
      const invP = el('div', '', { padding: '10px', borderRadius: '10px', background: 'rgba(10,16,36,0.70)', border: '1px solid rgba(0,229,255,0.18)' });
      invP.innerHTML = '<div style="font-weight:800;font-size:12px;color:var(--neon-cyan);font-family:\'JetBrains Mono\',monospace;margin-bottom:8px;">已购道具</div>';
      const invG = el('div', '', { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' });
      for (let i = 0; i < 5; i++) invG.appendChild(el('div', '', { height: '48px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', transition: 'all 200ms ease' }));
      invP.appendChild(invG); sd.appendChild(invP);
      // 改装预览 mini canvas 80x80
      const mdP = el('div', '', { padding: '10px', borderRadius: '10px', background: 'rgba(10,16,36,0.70)', border: '1px solid rgba(168,85,247,0.24)', marginTop: 'auto' });
      mdP.innerHTML = '<div style="font-weight:800;font-size:12px;color:var(--rarity-epic);font-family:\'JetBrains Mono\',monospace;margin-bottom:6px;">改装预览</div>';
      const tcv = el('canvas', '', { width: '80px', height: '80px', borderRadius: '10px', background: 'radial-gradient(circle at 50% 60%, rgba(0,229,255,0.08), rgba(5,7,15,0.8))', border: '1px solid rgba(168,85,247,0.35)', display: 'block', margin: '0 auto' });
      mdP.appendChild(tcv); sd.appendChild(mdP);
      setTimeout(() => tankPrev(tcv, pl), 0);
      mn.appendChild(sd);
      // 网格
      const gw = el('div', '', { flex: 1, overflowY: 'auto', padding: '0 4px 0 8px', position: 'relative' });
      const gd = el('div', '', { display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }, { class: 'grid-cols-shop' });
      gw.appendChild(gd); mn.appendChild(gw);

      // ===== 检查点 11 / 12：底部刷新栏 + 进度条发光 =====
      const ft = el('div', '', { height: '48px', marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', borderTop: '1px solid rgba(0,229,255,0.18)', background: 'linear-gradient(90deg, rgba(0,229,255,0.06), rgba(255,255,255,0) 40%, rgba(255,255,255,0) 60%, rgba(255,43,214,0.06))', borderRadius: '0 0 12px 12px', position: 'relative', zIndex: 2 });
      const rb = el('button', '', { padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, fontFamily: 'Share Tech Mono,monospace', letterSpacing: '0.12em', cursor: 'pointer', background: 'linear-gradient(135deg, rgba(0,229,255,0.10), rgba(255,43,214,0.08))', border: '1px solid var(--neon-cyan)', color: 'var(--text-hi)', display: 'inline-flex', alignItems: 'center', gap: '6px', transition: 'all 160ms ease', position: 'relative', overflow: 'hidden' }, { id: 'shop-refresh-btn' });
      rb.innerHTML = '🔄 刷新商品 (<span data-cost>' + (sh.refreshCost || 20) + '💰</span>)';
      const rsh = el('div', '', { position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)', transform: 'translateX(-120%) skewX(-20deg)' });
      rsh.classList.add('anim-shine'); rb.appendChild(rsh);
      rb.addEventListener('mouseenter', () => rb.classList.add('glow-cyan-sm'));
      rb.addEventListener('mouseleave', () => rb.classList.remove('glow-cyan-sm'));
      let auto = 60;
      const aw = el('div', '', { display: 'flex', alignItems: 'center', gap: '10px' });
      aw.appendChild(el('div', '下次自动刷新:', { fontSize: '11px', color: 'var(--text-mid)', fontFamily: 'JetBrains Mono,monospace' }));
      const aV = el('div', '60s', { fontSize: '12px', fontWeight: 800, color: CY(), fontFamily: 'JetBrains Mono,monospace', minWidth: '36px' });
      const pW = el('div', '', { width: '128px', height: '6px', borderRadius: '999px', background: 'rgba(0,0,0,0.55)', overflow: 'hidden', border: '1px solid rgba(0,229,255,0.22)' });
      const pF = el('div', '', { width: '100%', height: '100%', background: 'linear-gradient(90deg, var(--neon-cyan), var(--neon-magenta))', boxShadow: '0 0 8px rgba(0,229,255,0.6), 0 0 12px rgba(255,43,214,0.4)', transition: 'width 1s linear' });
      pW.appendChild(pF); aw.appendChild(aV); aw.appendChild(pW); ft.appendChild(rb); ft.appendChild(aw);

      // 组装
      pn.appendChild(hd); pn.appendChild(tr); pn.appendChild(mn); pn.appendChild(ft); wrap.appendChild(pn); root.appendChild(wrap);

      // ctx
      const C = { panel: pn, shop: sh, player: pl, fx, coinEl: cEl, invEl: invG, cv: tcv, rf: null, sc: null, si: null };
      function sC() { cVl.textContent = String(pl.coins || 0); const cs = rb.querySelector('[data-cost]'); if (cs) cs.textContent = (sh.refreshCost || 20) + ''; }
      /* 库存格渲染：Tank.addInventory 存的是 { id, def }，图标/名字都在 def 上。
       * 此前直接读 it.icon / it.name（undefined）→ 商店内看自己背包永远是空白 ✦，
       * 表现就是「买了道具但道具栏看不见」。现在从 it.def 取，并按同名合并显示 ×N。 */
      function sI() {
        const sl = invG.children, iv = Array.isArray(pl.inventory) ? pl.inventory : [];
        for (let i = 0; i < sl.length; i++) {
          const s = sl[i]; s.innerHTML = ''; s.style.borderStyle = 'dashed'; s.style.background = 'rgba(255,255,255,0.02)'; s.style.borderColor = '';
          const it = iv[i]; if (!it) continue;
          const def = it.def || it;                       // 兼容 {id,def} 结构与直接 def
          const col = rc(def.rarity || 'common');
          s.style.borderStyle = 'solid'; s.style.borderColor = col; s.style.background = col + '14';
          s.innerHTML = def.icon || def.emoji || '✦';
          s.title = (def.name || '道具') + (def.desc ? ' — ' + def.desc : '');
        }
      }
      function re() { gd.innerHTML = ''; const st = Array.isArray(sh.currentStock) ? sh.currentStock : []; st.forEach((x, i) => gd.appendChild(rCard(x, i, C))); S._switchTab(cur, gd); }
      C.rf = re; C.sc = sC; C.si = sI; re(); sC(); sI();

      // Tab 切换 & underline slide (检查点 5)
      TABS.forEach(t => {
        tEls[t.k].addEventListener('click', () => {
          cur = t.k;
          /* TABS 元素字段是 {k, l} —— 此前误写 k.key（undefined），
           * tEls[undefined] 取不到按钮 → tb.style 抛 TypeError（Tab 点击报错根因） */
          TABS.forEach(k => {
            const tb = tEls[k.k], a = k.k === cur;
            tb.style.background = a ? 'rgba(0,229,255,0.10)' : 'transparent';
            tb.style.border = a ? '1px solid rgba(0,229,255,0.30)' : '1px solid rgba(255,255,255,0.08)';
            tb.style.color = a ? CY() : 'var(--text-mid)';
            if (a) tb.classList.add('glow-cyan-sm'); else tb.classList.remove('glow-cyan-sm');
          });
          S._tabLine(tEls[cur], tln, ti);
          S._switchTab(cur, gd);
        });
      });
      // 刷新绑定
      rb.addEventListener('click', () => {
        if (sh.locked) return;
        const r = sh.manualRefresh && sh.manualRefresh(pl, boss);
        if (!r || !r.ok) { rb.classList.remove('anim-shake'); void rb.offsetWidth; rb.classList.add('anim-shake'); return; }
        auto = 60; re(); sC(); try { bus.emit && bus.emit('shop:refreshed', r); } catch (e) { }
      });

      // tick 主循环 (setInterval + 监听 prep:tick 双保险)
      const tick = () => {
        rem = Math.max(0, rem - 1); auto = Math.max(0, auto - 1); sT();
        aV.textContent = auto + 's'; pF.style.width = Math.max(0, auto / 60 * 100) + '%';
        if (auto <= 0) { try { const r = sh.manualRefresh && sh.manualRefresh(pl, boss); if (r && r.ok) { auto = 60; re(); sC(); } } catch (e) { auto = 60; } }
        if (rem <= 3 && !sh.locked) {
          try { sh.lock && sh.lock(); } catch (e) { sh.locked = 1; }
          gd.querySelectorAll('button').forEach(b => { b.disabled = 1; b.style.background = 'rgba(30,41,59,0.55)'; b.style.color = 'var(--text-disable)'; });
          rb.disabled = 1; rb.style.opacity = 0.5;
        }
        if (rem <= 0) S.close();
      };
      S._tm = setInterval(tick, 1000);
      /* 此前每次 open 都向 ENGINE 注册一个空转回调（S._et）且从不注销，
       * 跨波次累积泄漏 —— 倒计时已由 setInterval 驱动，直接删除该注册 */

      // 响应式 4 断点 (检查点 14): grid-cols-shop lg/md/sm 已在 style.css 定义
      const ro = new ResizeObserver(() => S._tabLine(tEls[cur], tln, ti));
      ro.observe(pn);
      S._ctx = C; S._oc = oC; S._fx = fx; S._ro = root; S._ro2 = ro; S._mfo = mfo;
    },
    _tabLine(tb, ln, host) {
      try {
        const r = tb.getBoundingClientRect(), hr = host.getBoundingClientRect();
        const w = Math.max(24, r.width * 0.8);
        const l = (r.left - hr.left) + (r.width - w) / 2;
        ln.style.left = l + 'px'; ln.style.width = w + 'px';
      } catch (e) { }
    },
    _switchTab(cat, gd) {
      if (!gd) return;
      gd.querySelectorAll('[data-cat]').forEach(n => { n.style.display = n.getAttribute('data-cat') === cat ? '' : 'none'; });
    },
    close() {
      const C = S._ctx, oC = S._oc, root = S._ro;
      const gen = S._gen; // 记录本次关闭对应的实例代数
      if (S._tm) { clearInterval(S._tm); S._tm = null; }
      if (S._ro2) { try { S._ro2.disconnect(); } catch (e) { } S._ro2 = null; }
      if (S._mfo) { try { S._mfo.disconnect(); } catch (e) { } S._mfo = null; }
      try { bus.emit && bus.emit('shop:closed'); } catch (e) { }
      S._ctx = S._oc = S._fx = S._ro = null;
      /* done 延迟 320ms 执行。期间若 S.open() 已开新店（代数变化），
       * 绝不能清空 root —— 否则新商店刚弹出就被清掉（闪退） */
      const done = () => {
        if (gen !== S._gen) return;
        if (C && C.fx) try { C.fx.destroy(); } catch (e) { }
        if (root) { root.innerHTML = ''; root.style.display = 'none'; root.classList.add('hidden'); }
        if (typeof oC === 'function') try { oC(); } catch (e) { }
      };
      if (root) {
        const mk = root.querySelector(':scope > div:first-child');
        const pn = root.querySelector('.glow-cyan-md');
        if (mk) { mk.style.transition = 'opacity 280ms ease'; mk.style.opacity = '0'; }
        if (pn) { pn.style.transition = 'transform 300ms ease, opacity 300ms ease'; pn.style.transform = 'scale(0.88)'; pn.style.opacity = '0'; }
        setTimeout(done, 320);
      } else done();
    },
    hide() { S.close(); },
  };
  window.CT_UI_SHOP = S;

  /* ---- 事件接线：prep-phase 每波备战期 emit 'ui:showShop' ----
   * 此前无任何监听者 → 商店 UI 从不显示（"商店每波都要出现"的断链根因）。 */
  (function bindShopEvents() {
    const b = window.CT_BUS || bus;
    if (typeof b.on !== 'function') return;
    b.on('ui:showShop', (e) => {
      try { S.open(e || {}); } catch (err) { console.error('[shop-ui] open failed', err); }
    });
    /* 结束对局时强制关店（CT_EXIT_TO_MENU 也会调用 hide） */
    b.on('game:exitToMenu', () => { try { S.close(); } catch (e) { } });
  })();
})();

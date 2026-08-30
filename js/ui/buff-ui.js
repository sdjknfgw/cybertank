/* CYBERTANK · Buff UI (Task) · window.CT_UI_BUFF */
(function () {
  'use strict';
  const EB = () => window.CT_BUS || window.EventBus || { on() {}, emit() {}, off() {} };
  const $ = (sel) => document.querySelector(sel);
  const RC = { common: '--rarity-common', rare: '--rarity-rare', epic: '--rarity-epic', legendary: '--rarity-legendary' };
  const RR = { common: 0, rare: 1, epic: 2, legendary: 3 };
  const RL = { common: '普 通', rare: '稀 有', epic: '史 诗', legendary: '传 奇' };
  const BH = { common: '2px', rare: '2px', epic: '3px', legendary: '3px' };
  const FT = { common: '#9ca3af', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b' };
  function el(t, h, s, a) { const d = document.createElement(t); if (h != null) d.innerHTML = h; if (s) Object.assign(d.style, s); if (a) for (const k in a) d.setAttribute(k, a[k]); return d; }
  function rv(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function rc(r) { const v = rv(RC[r] || ''); return v && v.length ? v : FT[r] || '#888'; }
  function kf() { if (kf.done) return; kf.done = 1; document.head.appendChild(el('style',
    '@keyframes spin{to{transform:rotate(360deg)}}@keyframes spinr{to{transform:rotate(-360deg)}}' +
    '.grid-bg{background-image:linear-gradient(rgba(0,229,255,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,0.05) 1px,transparent 1px);background-size:24px 24px;}' +
    '.cor-p{position:absolute;width:14px;height:14px;border-style:solid;pointer-events:none;}')); }

  /* ======= Canvas FX: burst + fly (独立 rAF, 不阻塞) ======= */
  class FX {
    constructor(p) {
      this.c = el('canvas', '', { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: 80 });
      this.x = this.c.getContext('2d'); this.p = p; this.ps = []; this.fs = []; this.on = false;
      p.appendChild(this.c); this.rsz(); window.addEventListener('resize', () => this.rsz());
    }
    rsz() {
      const r = this.p.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      this.c.width = r.width * dpr; this.c.height = r.height * dpr;
      this.c.style.width = r.width + 'px'; this.c.style.height = r.height + 'px';
      this.x.setTransform(dpr, 0, 0, dpr, 0, 0); this.W = r.width; this.H = r.height;
    }
    burst(x, y, col) {
      for (let i = 0; i < 22; i++) { const a = Math.random() * 6.283, s = 1.5 + Math.random() * 4.5; this.ps.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, l: 1, d: 0.012 + Math.random() * 0.02, r: 1.5 + Math.random() * 2.2, c: col }); }
      for (let i = 0; i < 2; i++) this.ps.push({ R: 1, x, y, rr: 4 + i * 2, mx: 58 + i * 18, l: 1, d: 0.035 - i * 0.01, c: col });
      this.go();
    }
    fly(fr, to, col, cb) {
      const pr = this.p.getBoundingClientRect();
      this.fs.push({ x: fr.left + fr.width / 2 - pr.left, y: fr.top + fr.height / 2 - pr.top, tx: to.left + to.width / 2 - pr.left, ty: to.top + to.height / 2 - pr.top, t: 0, c: col, cb });
      this.go();
    }
    go() {
      if (this.on) return; this.on = true;
      const lp = () => { this.tick(); if (this.ps.length || this.fs.length) requestAnimationFrame(lp); else this.on = false; };
      requestAnimationFrame(lp);
    }
    tick() {
      const x = this.x; x.clearRect(0, 0, this.W, this.H);
      for (let i = this.ps.length - 1; i >= 0; i--) {
        const p = this.ps[i];
        if (p.R) {
          p.rr += (p.mx - p.rr) * 0.09; p.l -= p.d; if (p.l <= 0) { this.ps.splice(i, 1); continue; }
          x.strokeStyle = p.c; x.globalAlpha = Math.max(0, p.l); x.lineWidth = 2;
          x.shadowColor = p.c; x.shadowBlur = 12; x.beginPath(); x.arc(p.x, p.y, p.rr, 0, 6.283); x.stroke();
          x.shadowBlur = 0; x.globalAlpha = 1;
        } else {
          p.x += p.vx; p.y += p.vy; p.vx *= 0.96; p.vy *= 0.96; p.vy += 0.05; p.l -= p.d;
          if (p.l <= 0) { this.ps.splice(i, 1); continue; }
          x.fillStyle = p.c; x.globalAlpha = Math.max(0, p.l); x.shadowColor = p.c; x.shadowBlur = 10;
          x.beginPath(); x.arc(p.x, p.y, p.r, 0, 6.283); x.fill(); x.shadowBlur = 0; x.globalAlpha = 1;
        }
      }
      for (let i = this.fs.length - 1; i >= 0; i--) {
        const f = this.fs[i]; f.t += 0.035;
        if (f.t >= 1) { if (f.cb) try { f.cb(); } catch (e) {} this.fs.splice(i, 1); continue; }
        const t = f.t, s1 = (1 - t) * (1 - t), s2 = 2 * (1 - t) * t, s3 = t * t;
        const mx = (f.x + f.tx) / 2, my = Math.min(f.y, f.ty) - 50;
        const x_ = s1 * f.x + s2 * mx + s3 * f.tx, y_ = s1 * f.y + s2 * my + s3 * f.ty;
        x.fillStyle = f.c; x.shadowColor = f.c; x.shadowBlur = 18; x.globalAlpha = 1 - t * 0.3;
        x.beginPath(); x.arc(x_, y_, 6, 0, 6.283); x.fill();
        x.globalAlpha = (1 - t) * 0.4; x.beginPath(); x.arc(x_, y_, 14, 0, 6.283); x.fill();
        x.shadowBlur = 0; x.globalAlpha = 1;
      }
    }
    destroy() { this.ps.length = 0; this.fs.length = 0; this.c.remove(); }
  }

  function card(card, pick, fx, pn) {
    const r = card.rarity || 'common', c = rc(r), ep = RR[r] >= 2;
    const rt = el('div', '', { position: 'relative', width: '280px', height: '372px', borderRadius: '8px', overflow: 'hidden', background: 'linear-gradient(180deg, rgba(10,16,36,0.88), rgba(8,12,26,0.95))', border: '1px solid ' + c, boxShadow: '0 0 14px ' + c + '55, inset 0 0 18px ' + c + '14', transition: 'transform 200ms ease, box-shadow 200ms ease', cursor: 'pointer' });
    if (r === 'legendary') rt.classList.add('hologram');
    rt.appendChild(el('div', '', { position: 'absolute', top: 0, left: 0, right: 0, height: BH[r], background: c, boxShadow: '0 0 14px ' + c + 'cc' }));
    if (ep) {
      const ps = [{ t: '8px', l: '8px', w: '3px 0 0 3px' }, { t: '8px', r: '8px', w: '3px 3px 0 0' }, { b: '8px', l: '8px', w: '0 0 3px 3px' }, { b: '8px', r: '8px', w: '0 3px 3px 0' }];
      ps.forEach(p => rt.appendChild(el('div', '', { cssText: 'position:absolute;width:14px;height:14px;border-style:solid;border-color:' + c + ';filter:drop-shadow(0 0 4px ' + c + ');' + (p.t ? 'top:' + p.t + ';' : '') + (p.b ? 'bottom:' + p.b + ';' : '') + (p.l ? 'left:' + p.l + ';' : '') + (p.r ? 'right:' + p.r + ';' : '') + 'border-width:' + p.w + ';' })));
    }
    const iw = el('div', '', { height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c + '14', position: 'relative', marginTop: BH[r], overflow: 'hidden' });
    iw.appendChild(el('div', '', { position: 'absolute', width: '120px', height: '120px', background: 'radial-gradient(circle,' + c + '55 0%,transparent 65%)', filter: 'blur(20px)', pointerEvents: 'none' }));
    if (ep) {
      iw.appendChild(el('div', '', { position: 'absolute', width: '104px', height: '104px', border: '2px dashed ' + c, borderRadius: '50%', boxShadow: '0 0 12px ' + c + '66' })).style.animation = 'spin 8s linear infinite';
      iw.appendChild(el('div', '', { position: 'absolute', width: '82px', height: '82px', border: '1px solid ' + c, borderRadius: '50%', boxShadow: 'inset 0 0 10px ' + c + '44' })).style.animation = 'spinr 12s linear infinite';
    }
    const ic = el('div', card.icon || '★', { fontSize: '5rem', lineHeight: 1, transition: 'transform 200ms ease' });
    ic.classList.add('anim-floatY'); iw.appendChild(ic); rt.appendChild(iw);
    const mr = el('div', '', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px 0' });
    mr.appendChild(el('div', RL[r] || 'COMMON', { padding: '2px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 800, fontFamily: 'JetBrains Mono,monospace', letterSpacing: '0.12em', color: c, border: '1px solid ' + c, background: c + '14', boxShadow: '0 0 8px ' + c + '44' }));
    mr.appendChild(el('div', card.stackable === 'unique' ? '唯一·不可叠' : ('可叠 × ' + (card.maxStacks || '∞')), { fontSize: '10px', color: 'var(--text-lo)', fontFamily: 'JetBrains Mono,monospace' }));
    rt.appendChild(mr);
    rt.appendChild(el('div', card.name || 'Unknown Buff', { padding: '8px 12px 2px', color: 'var(--text-hi)', fontSize: '15px', fontWeight: 700, textShadow: '0 0 8px ' + c + '44' }));
    /* 完整效果描述：显示在卡片名称正下方，不再截断（此前 -webkit-line-clamp:2 只显示 2 行） */
    rt.appendChild(el('div', card.desc || card.description || '', { padding: '2px 12px 0', color: 'var(--text-mid)', fontSize: '11px', lineHeight: 1.55, minHeight: '88px', whiteSpace: 'normal', overflow: 'visible' }));
    const br = el('div', '', { padding: '10px 12px 12px', position: 'absolute', left: 0, right: 0, bottom: 0 });
    const bt = el('button', '选  择', { flex: 1, padding: '10px 18px', width: '100%', background: 'linear-gradient(135deg,' + c + '28,' + c + '0a 60%, rgba(255,255,255,0.04))', border: '1px solid ' + c, color: 'var(--text-hi)', borderRadius: '8px', fontSize: '13px', fontWeight: 700, letterSpacing: '0.2em', fontFamily: 'Share Tech Mono,monospace', cursor: 'pointer', position: 'relative', overflow: 'hidden', boxShadow: '0 0 10px ' + c + '66, inset 0 0 10px ' + c + '22' });
    const sh = el('div', '', { position: 'absolute', inset: 0, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)', transform: 'translateX(-120%) skewX(-20deg)' });
    sh.classList.add('anim-shine'); bt.appendChild(sh); br.appendChild(bt); rt.appendChild(br);
    rt.addEventListener('mouseenter', () => { rt.style.transform = 'translateY(-6px)'; rt.style.boxShadow = '0 10px 30px ' + c + '88, inset 0 0 22px ' + c + '33'; ic.style.transform = 'scale(1.10)'; });
    rt.addEventListener('mouseleave', () => { rt.style.transform = ''; rt.style.boxShadow = '0 0 14px ' + c + '55, inset 0 0 18px ' + c + '14'; ic.style.transform = ''; });
    rt.addEventListener('click', () => {
      const rct = rt.getBoundingClientRect(), pr = pn.getBoundingClientRect();
      fx.burst(rct.left + rct.width / 2 - pr.left, rct.top + rct.height / 2 - pr.top, c);
      const bar = BUFF.barEl, to = (bar && bar.getClientRects().length) ? bar.getBoundingClientRect() : { left: innerWidth / 2 - 80, top: 72, width: 160, height: 36 };
      fx.fly(rct, to, c, () => { try { pick(card); } catch (e) {} });
    });
    return rt;
  }

  const BUFF = {
    barEl: null,
    showSelection(o = {}) {
      const cards = Array.isArray(o.cards) ? o.cards : [];
      const mods = o.modifiers || {}, onSelect = typeof o.onSelect === 'function' ? o.onSelect : () => { };
      const onReroll = typeof o.onReroll === 'function' ? o.onReroll : () => { };
      const wave = o.wave || 'N', rl = Math.max(0, Number(mods.rerollLeft) || 0), ru = !!mods.rarityUp;
      let root = $('#buff-ui-root'); if (!root) { root = el('div', '', { position: 'fixed', inset: 0, zIndex: 2100 }, { id: 'buff-ui-root' }); document.body.appendChild(root); }
      /* index.html 预置 .hidden（display:none !important）会压过内联 display:block
       * → 打开时必须移除该类，否则增益三选一永远不可见（"增益未启用"的样式层根因） */
      root.classList.remove('hidden');
      root.innerHTML = ''; root.style.display = 'block'; kf();
      const mk = el('div', '', { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.70)', backdropFilter: 'blur(4px)' });
      mk.classList.add('anim-fadeIn'); mk.style.animationDuration = '300ms'; root.appendChild(mk);
      /* 与 shop-ui 同根因：anim-scaleIn（fill-mode:both）的 transform 会覆盖内联
       * translate(-50%,-50%) → 面板偏移右下。改用 flex 容器居中。 */
      const wrap = el('div', '', { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' });
      const pn = el('div', '', { position: 'relative', width: 'min(980px, 94vw)', boxSizing: 'border-box', minHeight: '420px', maxHeight: '90vh', overflowY: 'auto', padding: '24px', borderRadius: '14px', pointerEvents: 'auto' });
      pn.className = 'neon-panel panel-cyan grid-bg anim-scaleIn'; pn.style.animationDuration = '400ms';
      const sc = el('div', '', { position: 'absolute', left: 0, right: 0, top: 0, height: '4px', background: 'linear-gradient(180deg,transparent,rgba(0,229,255,0.35),transparent)' });
      sc.classList.add('anim-scanLine'); pn.appendChild(sc);
      const hd = el('div', '', { display: 'flex', alignItems: 'baseline', justifyContent: 'center', flexDirection: 'column', textAlign: 'center', marginBottom: '20px' });
      hd.appendChild(el('div', '第 ' + wave + ' 波 完成！', { fontSize: '28px', fontFamily: 'Share Tech Mono,monospace' })).classList.add('text-glow-gold');
      hd.appendChild(el('div', '选择 1 项永久增益' + (ru ? ' · ✨ 稀有度提升已激活' : ''), { fontSize: '13px', color: 'var(--neon-cyan)', marginTop: '4px', textShadow: '0 0 6px rgba(0,229,255,0.5)', letterSpacing: '0.12em' }));
      pn.appendChild(hd);
      const row = el('div', '', { display: 'flex', justifyContent: 'center', gap: '32px', padding: '0 12px', flexWrap: 'wrap' });
      const fx = new FX(pn);
      /* 选中卡片：调用 onSelect 回调（若模式传入）+ 广播 ui:buffSelected 事件。
       * 此前只调 onSelect，而模式 emit 的事件不带该回调 → 点击卡片后增益从未被应用
       * （"选择增益模块未启用"的根因）。事件带上 defId，各模式监听后调用
       * BUFF.applySelection 真正生效。 */
      const pick = (x) => {
        try { onSelect(x); } catch (e) { }
        try { EB().emit('ui:buffSelected', { defId: x && x.id, card: x, mode: o.mode }); } catch (e) { }
        BUFF.close();
      };
      (cards.length ? cards : [{}, {}, {}]).forEach(c => row.appendChild(card(c, pick, fx, pn)));
      pn.appendChild(row);
      const ft = el('div', '', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '22px', padding: '0 4px' });
      const rb = el('button', '<span style="margin-right:6px">🔄</span>重 掷<span style="margin-left:8px;font-size:11px;color:var(--text-lo)">(剩余 ' + rl + ' 次)</span>', { padding: '10px 22px', fontSize: '13px', fontWeight: 700, color: rl > 0 ? 'var(--text-hi)' : 'var(--text-disable)', letterSpacing: '0.18em', fontFamily: 'Share Tech Mono,monospace', background: rl > 0 ? 'linear-gradient(135deg,rgba(0,229,255,0.12),rgba(255,43,214,0.08))' : 'rgba(30,41,59,0.5)', border: '1px solid ' + (rl > 0 ? 'var(--neon-cyan)' : 'rgba(255,255,255,0.08)'), borderRadius: '8px', boxShadow: rl > 0 ? '0 0 10px rgba(0,229,255,0.45)' : 'none', cursor: rl > 0 ? 'pointer' : 'not-allowed', opacity: rl > 0 ? 1 : 0.5, position: 'relative', overflow: 'hidden' });
      rb.addEventListener('click', () => { if (rl > 0) try { onReroll(); } catch (e) { } });
      const rc2 = el('div', '', { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' });
      const sk = el('button', '跳 过（无增益）', { padding: '10px 22px', fontSize: '12px', color: 'var(--text-mid)', fontFamily: 'JetBrains Mono,monospace', background: 'transparent', border: '1px solid rgba(255,43,214,0.35)', borderRadius: '8px', cursor: 'pointer' });
      sk.addEventListener('mouseenter', () => { sk.style.borderColor = 'var(--neon-magenta)'; sk.style.color = 'var(--neon-magenta)'; sk.style.boxShadow = '0 0 10px rgba(255,43,214,0.45)'; });
      sk.addEventListener('mouseleave', () => { sk.style.borderColor = 'rgba(255,43,214,0.35)'; sk.style.color = 'var(--text-mid)'; sk.style.boxShadow = 'none'; });
      sk.addEventListener('click', () => {
        try { onSelect(null); } catch (e) { }
        /* 跳过也要广播（defId 为空 → 模式直接结束选择进入下一阶段），
         * 否则模式永远停留在 BUFF_SELECT 阶段 */
        try { EB().emit('ui:buffSelected', { defId: null, skipped: true, mode: o.mode }); } catch (e) { }
        BUFF.close();
      });
      rc2.appendChild(sk); rc2.appendChild(el('div', '提示：跳过不会获得任何增益', { fontSize: '10px', color: 'var(--text-lo)', marginTop: '4px', textAlign: 'right' }));
      ft.appendChild(rb); ft.appendChild(rc2); pn.appendChild(ft);
      wrap.appendChild(pn); root.appendChild(wrap); BUFF._fx = fx;
    },
    close() {
      const root = $('#buff-ui-root'); if (!root) return;
      const mk = root.querySelector(':scope > div:first-child');
      const pn = root.querySelector('.neon-panel');
      if (mk) { mk.style.transition = 'opacity 280ms ease'; mk.style.opacity = '0'; }
      if (pn) { pn.style.transition = 'transform 280ms ease, opacity 280ms ease'; pn.style.transform = 'scale(0.88)'; pn.style.opacity = '0'; }
      setTimeout(() => { if (BUFF._fx) { try { BUFF._fx.destroy(); } catch (e) { } BUFF._fx = null; } root.innerHTML = ''; root.style.display = 'none'; root.classList.add('hidden'); }, 300);
    },
    renderBar(buffs) {
      if (!Array.isArray(buffs)) buffs = [];
      /* 只渲染进 HUD 面板（#hud-buff-content）。此前 buff-ui 会自建一条独立浮栏，
       * 与 HUD 面板并存导致屏幕出现两条增益栏；现在 HUD 顶部静态状态栏已移除、
       * 增益展示统一交给倒计时胶囊（#hud-buff-timer），面板不存在时直接跳过，
       * 避免再生成第二条浮栏与胶囊重叠。 */
      const hudContent = document.getElementById('hud-buff-content');
      if (!hudContent) return;
      const bar = hudContent;
      Object.assign(hudContent.style, { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' });
      /* 无增益：清空面板（不再显示「无激活增益」占位文案） */
      if (!buffs.length) {
        bar.innerHTML = '';
        return;
      }
      bar.innerHTML = '';
      buffs.slice(0, 12).forEach(b => {
        const r = b.rarity || (b.def && b.def.rarity) || 'common', c = rc(r);
        const s = Number(b.stacks) || 1, d = b.def || b;
        const nd = el('div', '', { position: 'relative', width: '36px', height: '36px', borderRadius: '50%', background: 'radial-gradient(circle at 30% 30%,' + c + '22,rgba(8,12,26,0.95))', border: '2px solid ' + c, boxShadow: '0 0 10px ' + c + '99, inset 0 0 6px ' + c + '33', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'transform 150ms ease' });
        nd.appendChild(el('span', d.icon || '✦', { fontSize: '20px', lineHeight: 1 }));
        if (s > 1) nd.appendChild(el('div', String(s), { position: 'absolute', top: '-4px', right: '-4px', minWidth: '16px', height: '16px', padding: '0 4px', borderRadius: '999px', background: 'var(--neon-magenta)', color: '#fff', fontSize: '10px', fontWeight: 800, fontFamily: 'JetBrains Mono,monospace', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 6px rgba(255,43,214,0.8)' }));
        const tx = typeof d.description === 'function' ? (() => { try { return d.description(s, d.valuePerStack || 0); } catch (e) { return d.desc || d.name; } })() : (d.desc || d.name || '');
        const tp = el('div', '<b style="color:' + c + '">' + (d.name || '增益') + '</b> · ' + tx + (s > 1 ? ' · <span style="color:var(--neon-magenta)">' + s + ' 层</span>' : ''), { position: 'absolute', left: '50%', top: 'calc(100% + 8px)', transform: 'translateX(-50%)', background: 'rgba(5,7,15,0.95)', border: '1px solid ' + c, borderRadius: '6px', padding: '6px 10px', whiteSpace: 'nowrap', fontSize: '11px', color: 'var(--text-hi)', boxShadow: '0 0 12px ' + c + '66', display: 'none', zIndex: 80, fontFamily: 'JetBrains Mono,monospace' });
        nd.appendChild(tp);
        nd.addEventListener('mouseenter', () => { tp.style.display = 'block'; nd.style.transform = 'scale(1.08)'; });
        nd.addEventListener('mouseleave', () => { tp.style.display = 'none'; nd.style.transform = ''; });
        bar.appendChild(nd);
      });
      if (buffs.length > 12) {
        const m = el('div', '+' + (buffs.length - 12), { width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(0,229,255,0.14)', border: '2px solid var(--neon-cyan)', color: 'var(--neon-cyan)', fontSize: '12px', fontWeight: 700, fontFamily: 'JetBrains Mono,monospace', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 8px rgba(0,229,255,0.6)', cursor: 'pointer', position: 'relative' });
        const t = el('div', '已装备 ' + buffs.length + ' 项增益', { position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', fontSize: '11px', background: 'rgba(5,7,15,0.95)', border: '1px solid var(--neon-cyan)', padding: '6px 10px', borderRadius: '6px', display: 'none', color: 'var(--text-hi)', whiteSpace: 'nowrap', boxShadow: '0 0 10px rgba(0,229,255,0.5)' });
        m.appendChild(t); m.addEventListener('mouseenter', () => t.style.display = 'block'); m.addEventListener('mouseleave', () => t.style.display = 'none');
        bar.appendChild(m);
      }
    },
  };

  function bind() {
    try {
      const b = EB(); if (typeof b.on !== 'function') return;
      b.on('ui:showBuffSelection', e => BUFF.showSelection(e || {}));
      b.on('buff:changed', e => BUFF.renderBar((e && (e.buffs || e.playerBuffs)) || (Array.isArray(e) && e) || []));
      /* 退出对局 → 增益栏清空（避免下一局残留上一局的增益图标） */
      b.on('game:exitToMenu', () => BUFF.renderBar([]));
    } catch (e) { }
  }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true }); else bind(); } else bind();
  window.CT_UI_BUFF = BUFF;
})();

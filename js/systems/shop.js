/* CYBERTANK · Shop System · window.CT_SHOP · Task 6 · 无 DOM UI */
(function () {
  'use strict';
  // --- 外部依赖安全降级 ---
  const CP = window.CT_POWERUP || { PowerupDefs: {} };
  const CS = window.CT_STORAGE || { addEquipment(){}, saveProfile(){}, getProfile(){return{coins:0};} };
  const CB = window.EventBus || window.CT_BUS || { on(){}, emit(){}, off(){} };
  /* CT_POWERUP 导出的属性名是 PowerupDefs（此前误读 CP.DEFS → undefined，
   * 买到的道具是 {id} 残缺对象：无 apply/emoji → "买了东西无法使用"的根因） */
  const $ = (t,id)=> (CP.PowerupDefs[id]||{id}); // 道具 DEFS 快捷
  const M = (t)=>(t.muls = t.muls||{});   // muls 快捷
  const F = (t)=>(t.flags = t.flags||{}); // flags 快捷
  const P = (t,id)=> { t.purchasedBuffs = t.purchasedBuffs||[]; t.purchasedBuffs.push(id); };
  const E = (t)=>({ok:true});

  /* ========== 40 商品定义 ========== */
  const ITEMS = {
    // --- P 消耗道具 18 种 ---
    P01:{id:'P01',cat:'consumable',name:'生命包',icon:'🔴',rarity:'common',price:40,stock:Infinity,desc:'+1 HP（上限+1）',onPurchase(t){t.addInventory&&t.addInventory($(t,'P01'));return E();}},
    P02:{id:'P02',cat:'consumable',name:'急速引擎',icon:'⚡',rarity:'common',price:50,stock:Infinity,desc:'移速 +50%，持续 8s',onPurchase(t){t.addInventory&&t.addInventory($(t,'P02'));return E();}},
    P03:{id:'P03',cat:'consumable',name:'三重射击',icon:'🔱',rarity:'rare',price:80,stock:Infinity,desc:'3 发扇形弹幕，持续 10s',onPurchase(t){t.addInventory&&t.addInventory($(t,'P03'));return E();}},
    P04:{id:'P04',cat:'consumable',name:'无敌护盾',icon:'🛡️',rarity:'rare',price:100,stock:Infinity,desc:'免疫伤害 5s',onPurchase(t){t.addInventory&&t.addInventory($(t,'P04'));return E();}},
    P05:{id:'P05',cat:'consumable',name:'激光炮',icon:'💠',rarity:'rare',price:300,stock:Infinity,desc:'穿透激光 × 3 发',onPurchase(t){t.addInventory&&t.addInventory($(t,'P05'));return E();}},
    P06:{id:'P06',cat:'consumable',name:'磁吸装置',icon:'🧲',rarity:'common',price:40,stock:Infinity,desc:'自动吸附附近金币 15s',onPurchase(t){t.addInventory&&t.addInventory($(t,'P06'));return E();}},
    P07:{id:'P07',cat:'consumable',name:'金币袋',icon:'💰',rarity:'common',price:30,stock:Infinity,desc:'立即获得 80 💰',onPurchase(t){t.coins=(t.coins||0)+80;return{ok:true,coins:80};}},
    P08:{id:'P08',cat:'consumable',name:'传送卷轴',icon:'🌀',rarity:'common',price:60,stock:Infinity,desc:'随机传送到安全位置',onPurchase(t){/* Tank 没有 randomTeleport 方法（此前静默无效），随机挪到地图内安全区 */const w=2400,h=1600;t.pos.x=100+Math.random()*(w-200);t.pos.y=100+Math.random()*(h-200);t.vel.x=0;t.vel.y=0;return E();}},
    P09:{id:'P09',cat:'consumable',name:'升级芯片',icon:'🔧',rarity:'rare',price:200,stock:Infinity,desc:'主炮等级 +1，伤害 × 1.25',onPurchase(t){t.gunLevel=(t.gunLevel||1)+1;M(t).dmg=(t.muls.dmg||1)*1.25;return E();}},
    P10:{id:'P10',cat:'consumable',name:'战术核弹',icon:'☢️',rarity:'epic',price:500,stock:Infinity,desc:'全屏爆炸，对所有敌人造成 99 伤害',onPurchase(t){t.addInventory&&t.addInventory($(t,'P10'));return E();}},
    P11:{id:'P11',cat:'consumable',name:'增益重掷骰',icon:'🎲',rarity:'rare',price:150,stock:Infinity,desc:'下次 3 选 1 增益可重抽 1 次',onPurchase(t){F(t).nextBuffReroll=true;return E();}},
    P12:{id:'P12',cat:'consumable',name:'稀有度提升卡',icon:'✨',rarity:'epic',price:300,stock:Infinity,desc:'下次增益稀有度强制提升一级',onPurchase(t){F(t).nextBuffRarityUp=true;return E();}},
    P13:{id:'P13',cat:'consumable',name:'建造模块',icon:'🧱',rarity:'common',price:60,stock:Infinity,desc:'获得 4 块可放置砖墙',onPurchase(t){F(t).pendingBrickPlace=(t.flags.pendingBrickPlace||0)+4;return E();}},
    P14:{id:'P14',cat:'consumable',name:'地雷 × 3',icon:'💣',rarity:'common',price:120,stock:Infinity,desc:'获得 3 枚高爆炸地雷',onPurchase(t){t.addInventory&&t.addInventory(CP.PowerupDefs.P14||{id:'P14',count:3});return E();}},
    P15:{id:'P15',cat:'consumable',name:'侦察无人机',icon:'🛸',rarity:'rare',price:180,stock:Infinity,duration:20,desc:'全地图敌人位置暴露 20s',onPurchase(t){/* 直接 push tempBuff（由 tank.js 每秒递减、hud.js revealFn 渲染、HUD 胶囊读同一份数据）。max=总时长快照供进度环使用；战斗外阶段计时冻结，商店窗口内购买不会被空烧 */if(Array.isArray(t.tempBuffs))t.tempBuffs.push({type:'mapReveal',mul:1,dur:20,max:20,born:performance.now()/1000});return E();}},
    P16:{id:'P16',cat:'consumable',name:'撤退信标',icon:'📡',rarity:'rare',price:250,stock:Infinity,desc:'立即传送回己方基地',onPurchase(t){/* Tank 没有 teleportToBase 方法（此前静默无效），直接传回出生点 */const bs=t.spawnPos||{x:t.pos.x,y:t.pos.y};t.pos.x=bs.x;t.pos.y=bs.y;t.vel.x=0;t.vel.y=0;return E();}},
    P17:{id:'P17',cat:'consumable',name:'维修工具包',icon:'🧰',rarity:'common',price:70,stock:Infinity,desc:'立即恢复 2 HP（不超上限）',onPurchase(t){const m=t.maxHp||t.hp||1;const h=Math.min(2,m-(t.hp||0));t.hp=Math.min(m,(t.hp||0)+2);return{ok:true,healed:h};}},
    P18:{id:'P18',cat:'consumable',name:'弹药补给箱',icon:'📦',rarity:'common',price:55,stock:Infinity,duration:15,desc:'射速 +30%，持续 15s',onPurchase(t){/* 直接 push tempBuff 生效。此前缺 duration 字段又不在 PowerupDefs 里，HUD 购买回调拿不到时长 → 买了之后顶部倒计时胶囊完全不显示（效果有、显示无）。max 供进度环使用 */if(Array.isArray(t.tempBuffs))t.tempBuffs.push({type:'fireRate',mul:1.3,dur:15,max:15,born:performance.now()/1000});return E();}},
    // --- B 本局增益 12 种 · 前置链 B01→B06→B11 / B02→B07 ---
    B01:{id:'B01',cat:'buff',name:'火力模块 Mk1',icon:'🔥',rarity:'common',price:120,stock:Infinity,prereq:null,desc:'伤害 +10%（本局永久）',onPurchase(t){M(t).dmg=(t.muls.dmg||1)*1.10;P(t,'B01');return E();}},
    B02:{id:'B02',cat:'buff',name:'射速模块 Mk1',icon:'🏹',rarity:'common',price:120,stock:Infinity,prereq:null,desc:'射速 +10%（本局永久）',onPurchase(t){M(t).fireRate=(t.muls.fireRate||1)*1.10;P(t,'B02');return E();}},
    B03:{id:'B03',cat:'buff',name:'引擎模块 Mk1',icon:'🚀',rarity:'common',price:120,stock:Infinity,prereq:null,desc:'移速 +10%（本局永久）',onPurchase(t){M(t).speed=(t.muls.speed||1)*1.10;P(t,'B03');return E();}},
    B04:{id:'B04',cat:'buff',name:'装甲模块 Mk1',icon:'🪖',rarity:'common',price:120,stock:Infinity,prereq:null,desc:'减伤 +10%（递减叠加）',onPurchase(t){M(t).dr=1-(1-(t.muls.dr||0))*0.90;P(t,'B04');return E();}},
    B05:{id:'B05',cat:'buff',name:'生命强化',icon:'❤️‍🔥',rarity:'common',price:150,stock:Infinity,prereq:null,desc:'最大 HP +1 并完全回满',onPurchase(t){t.maxHp=(t.maxHp||t.hp||1)+1;t.hp=t.maxHp;P(t,'B05');return E();}},
    B06:{id:'B06',cat:'buff',name:'火力模块 Mk2',icon:'🔥',rarity:'rare',price:350,stock:Infinity,prereq:'B01',desc:'伤害 +25%（需已购买 Mk1）',onPurchase(t){M(t).dmg=(t.muls.dmg||1)*1.25;P(t,'B06');return E();}},
    B07:{id:'B07',cat:'buff',name:'射速模块 Mk2',icon:'🏹',rarity:'rare',price:350,stock:Infinity,prereq:'B02',desc:'射速 +25%（需已购买 Mk1）',onPurchase(t){M(t).fireRate=(t.muls.fireRate||1)*1.25;P(t,'B07');return E();}},
    B08:{id:'B08',cat:'buff',name:'穿甲模块',icon:'🗡️',rarity:'rare',price:400,stock:Infinity,prereq:null,desc:'子弹穿透数 +1',onPurchase(t){M(t).pierce=(t.muls.pierce||0)+1;P(t,'B08');return E();}},
    B09:{id:'B09',cat:'buff',name:'爆炸模块',icon:'💥',rarity:'rare',price:300,stock:Infinity,prereq:null,desc:'溅射伤害 × 1.40',onPurchase(t){M(t).splash=(t.muls.splash||1)*1.40;P(t,'B09');return E();}},
    B10:{id:'B10',cat:'buff',name:'金币磁铁',icon:'🪙',rarity:'rare',price:200,stock:Infinity,prereq:null,desc:'所有金币收益 × 1.50',onPurchase(t){M(t).coinGain=(t.muls.coinGain||1)*1.50;P(t,'B10');return E();}},
    B11:{id:'B11',cat:'buff',name:'火力模块 Mk3',icon:'☄️',rarity:'epic',price:900,stock:Infinity,prereq:'B06',desc:'伤害 +60%（需已购买 Mk2）',onPurchase(t){M(t).dmg=(t.muls.dmg||1)*1.60;P(t,'B11');return E();}},
    B12:{id:'B12',cat:'buff',name:'传奇核心',icon:'🌟',rarity:'legendary',price:2000,stock:1,prereq:null,desc:'全属性 × 1.20（每局限 1 次）',onPurchase(t){M(t);t.muls.dmg=(t.muls.dmg||1)*1.20;t.muls.fireRate=(t.muls.fireRate||1)*1.20;t.muls.speed=(t.muls.speed||1)*1.20;t.muls.dr=1-(1-(t.muls.dr||0))*0.80;t.muls.pierce=(t.muls.pierce||0)+1;P(t,'B12');return E();}},
    // --- E 装备 5 种 · 跨局持久化 ---
    E01:{id:'E01',cat:'equipment',name:'铬合金炮管',icon:'🔩',rarity:'rare',price:300,stock:Infinity,isPersistent:true,visual:{barrel:{thickness:1.4,color:'#e0e8f0'}},desc:'子弹初速 +15%，炮管加粗',onPurchase(t){if(Array.isArray(t.equipments)&&t.equipments.includes('E01'))return{ok:false,msg:'已装备'};CS.addEquipment&&CS.addEquipment('E01');t.equipments=Array.isArray(t.equipments)?[...t.equipments,'E01']:['E01'];t.bulletSpeedMul=(t.bulletSpeedMul||1)*1.15;return E();}},
    E02:{id:'E02',cat:'equipment',name:'碳纤维履带',icon:'🦿',rarity:'rare',price:350,stock:Infinity,isPersistent:true,visual:{track:{glowCyan:true}},desc:'地形牵引力拉满（冰/泥地减速减半）',onPurchase(t){if(Array.isArray(t.equipments)&&t.equipments.includes('E02'))return{ok:false,msg:'已装备'};CS.addEquipment&&CS.addEquipment('E02');t.equipments=Array.isArray(t.equipments)?[...t.equipments,'E02']:['E02'];t.tractionOverride=1;return E();}},
    E03:{id:'E03',cat:'equipment',name:'反应装甲板',icon:'🛡️',rarity:'epic',price:500,stock:Infinity,isPersistent:true,visual:{sideArmor:true},desc:'15% 概率完全闪避子弹',onPurchase(t){if(Array.isArray(t.equipments)&&t.equipments.includes('E03'))return{ok:false,msg:'已装备'};CS.addEquipment&&CS.addEquipment('E03');t.equipments=Array.isArray(t.equipments)?[...t.equipments,'E03']:['E03'];t.missRoll=(t.missRoll||0)+0.15;return E();}},
    E04:{id:'E04',cat:'equipment',name:'能量核心',icon:'🔋',rarity:'epic',price:800,stock:Infinity,isPersistent:true,visual:{exhaustFlameColor:'#bf00ff'},desc:'技能冷却 × 0.80（CD 更短）',onPurchase(t){if(Array.isArray(t.equipments)&&t.equipments.includes('E04'))return{ok:false,msg:'已装备'};CS.addEquipment&&CS.addEquipment('E04');t.equipments=Array.isArray(t.equipments)?[...t.equipments,'E04']:['E04'];t.skillCdMul=(t.skillCdMul||1)*0.80;return E();}},
    E05:{id:'E05',cat:'equipment',name:'量子瞄准镜',icon:'🔭',rarity:'rare',price:600,stock:Infinity,isPersistent:true,visual:{scope:true},desc:'子弹散射 × 0.5（更精准）',onPurchase(t){if(Array.isArray(t.equipments)&&t.equipments.includes('E05'))return{ok:false,msg:'已装备'};CS.addEquipment&&CS.addEquipment('E05');t.equipments=Array.isArray(t.equipments)?[...t.equipments,'E05']:['E05'];t.spreadMul=(t.spreadMul||1)*0.50;return E();}},
    // --- S BOSS 特供 5 种 · bossOnly:true 仅 BOSS 波出现 ---
    S01:{id:'S01',cat:'special',name:'BOSS 杀手弹头',icon:'🎯',rarity:'epic',price:800,stock:1,bossOnly:true,desc:'对 BOSS 造成的伤害 ×2（本局永久）',onPurchase(t){t.bossDmgMul=(t.bossDmgMul||1)*2;return E();}},
    S02:{id:'S02',cat:'special',name:'立场发生器',icon:'🔵',rarity:'epic',price:600,stock:1,bossOnly:true,desc:'开启 30s 基础护盾，减免 70% 伤害',onPurchase(t){F(t).baseShield={duration:30,dr:0.70};return E();}},
    S03:{id:'S03',cat:'special',name:'轨道轰炸指令',icon:'🛰️',rarity:'legendary',price:1500,stock:1,bossOnly:true,desc:'立即对当前 BOSS 造成 40% 最大 HP 伤害',onPurchase(t){if(typeof t.dealBossPercentDamage==='function')t.dealBossPercentDamage(0.40);else{F(t).pendingOrbitalStrike=0.40;}return E();}},
    S04:{id:'S04',cat:'special',name:'克隆坦克',icon:'👯',rarity:'legendary',price:1200,stock:1,bossOnly:true,desc:'生成 2 个 AI 分身（50% 属性）跟随作战',onPurchase(t){F(t).pendingCloneSpawn=2;return E();}},
    S05:{id:'S05',cat:'special',name:'时间沙漏',icon:'⏳',rarity:'epic',price:1000,stock:1,bossOnly:true,desc:'下一波敌人延迟 10s 出现',onPurchase(t){const s=window.CT_STATE||(t.game&&t.game.state)||{};s.spawnDelay=(s.spawnDelay||0)+10;return E();}},
  };

  /* ========== 配置 ========== */
  const RW = { common:55, rare:28, epic:13, legendary:4 };
  const RAR = ['common','rare','epic','legendary'];
  const DC = { consumable:[5,7], buff:[3,5], equipment:[1,2], special:[0,1] };

  /* ========== 工具 ========== */
  const _r=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
  function _wp(w){
    let t=0;for(const v of Object.values(w))t+=v;
    let r=Math.random()*t;
    for(const[k,v]of Object.entries(w))if((r-=v)<=0)return k;
    return Object.keys(w)[0];
  }
  const _stock=(r,c)=>r==='legendary'||c==='special'?1:(r==='epic'?2:Infinity);
  const _clone=i=>Object.assign({},i,{stockLeft:_stock(i.rarity,i.cat)});
  const _pool=(c,b)=>Object.values(ITEMS).filter(i=>i.cat===c&&(b||!i.bossOnly));
  const _byR=(p,r)=>p.filter(i=>i.rarity===r);

  function _pick(c,b,used){
    const p=_pool(c,b).filter(i=>!used.has(i.id));
    if(!p.length)return null;
    for(let a=0;a<3;a++){const s=_byR(p,_wp(RW));if(s.length)return s[_r(0,s.length-1)];}
    return p[_r(0,p.length-1)];
  }

  /* ========== refreshStock ========== */
  function refreshStock(isBoss=false,total=isBoss?16:12){
    const res=[],used=new Set();
    const cats=['consumable','buff','equipment','special'];
    const al={};let A=0;
    for(const c of cats){
      const[lo,hi]=DC[c];
      if(c==='special'&&!isBoss){al[c]=0;continue;}
      const n=Math.min(hi,Math.max(lo,_r(lo,hi)));
      al[c]=n;A+=n;
    }
    let d=total-A;
    while(d!==0){if(d>0){al.consumable++;d--;}else if(al.consumable>DC.consumable[0]){al.consumable--;d++;}else break;}
    const tot=Object.values(al).reduce((s,n)=>s+n,0);
    if(tot<total)al.consumable+=(total-tot);
    for(const c of cats)for(let i=0;i<al[c];i++){const it=_pick(c,isBoss,used);if(it){used.add(it.id);res.push(_clone(it));}}
    // BOSS 保底：≥1 件 special
    if(isBoss&&!res.some(x=>x.cat==='special')){
      const sp=Object.values(ITEMS).filter(i=>i.cat==='special'&&!used.has(i.id));
      if(sp.length){
        const pk=sp[_r(0,sp.length-1)];used.add(pk.id);res.push(_clone(pk));
        while(res.length>total){const idx=res.findIndex(x=>x.cat!=='special'&&x.rarity!=='legendary');if(idx<0)break;res.splice(idx,1);}
      }
    }
    CT_SHOP.currentStock=res;
    return res;
  }

  /* ========== purchase ========== */
  function purchase(player,itemId){
    if(!player)return{ok:false,msg:'无效玩家'};
    if(CT_SHOP.locked)return{ok:false,msg:'准备期即将结束，商店已锁定'};
    const idx=CT_SHOP.currentStock.findIndex(x=>x.id===itemId);
    if(idx<0)return{ok:false,msg:'商品不存在'};
    const si=CT_SHOP.currentStock[idx];
    if(si.stockLeft<=0)return{ok:false,msg:'该商品已售罄'};
    const d=ITEMS[itemId];if(!d)return{ok:false,msg:'商品定义缺失'};
    if(d.prereq&&!(player.purchasedBuffs||[]).includes(d.prereq))return{ok:false,msg:`需先购买前置：${ITEMS[d.prereq]?.name||d.prereq}`};
    if(d.isPersistent){
      const eq=(player.equipments||CS.getProfile?.()?.equipments||[]);
      if(eq.includes(itemId))return{ok:false,msg:'已拥有该装备'};
    }
    const fp=Math.ceil(d.price*CT_SHOP.discount);
    if((player.coins||0)<fp)return{ok:false,msg:'金币不足'};
    player.coins-=fp;si.stockLeft-=1;
    const invBefore=Array.isArray(player.inventory)?player.inventory.length:0;
    let ret;try{ret=(typeof d.onPurchase==='function')?d.onPurchase(player):{ok:true};}catch(e){ret={ok:false,msg:'购买回调异常：'+e.message};}
    if(ret&&ret.ok===false){player.coins+=fp;si.stockLeft+=1;return ret;}
    /* 是否进了道具栏：按购买前后 inventory 长度差判定。
     * 不在每个 onPurchase 里手写标记 —— 40 个商品极易漏标/标错，
     * 用数据本身判定可保证「购买 → 显示」两环节永远一致。 */
    const invAfter=Array.isArray(player.inventory)?player.inventory.length:0;
    const stored=invAfter>invBefore;
    CS.saveProfile&&CS.saveProfile();
    CB.emit&&CB.emit('shop:purchased',{item:d,player,finalPrice:fp,stored:stored});
    return{ok:true,finalPrice:fp};
  }

  /* ========== manualRefresh · 20→40→80→160→320→640（上限） ========== */
  function manualRefresh(player,isBoss=false){
    if(!player)return{ok:false,msg:'无效玩家'};
    if(CT_SHOP.locked)return{ok:false,msg:'准备期即将结束，商店已锁定'};
    const cost=CT_SHOP.refreshCost;
    if((player.coins||0)<cost)return{ok:false,msg:'金币不足，无法刷新'};
    player.coins-=cost;
    CT_SHOP.refreshCost=Math.min(640,CT_SHOP.refreshCost*2);
    CS.saveProfile&&CS.saveProfile();
    const items=refreshStock(isBoss);
    CB.emit&&CB.emit('shop:refreshed',{items,cost,player});
    return{ok:true,items,cost};
  }

  /* ========== 折扣 & 锁 ========== */
  const setDiscount=d=>{CT_SHOP.discount=Math.max(0.5,Math.min(1.0,Number(d)||1.0));return CT_SHOP.discount;};
  const lock=()=>{CT_SHOP.locked=true;CB.emit&&CB.emit('shop:locked');};
  const unlock=()=>{CT_SHOP.locked=false;CB.emit&&CB.emit('shop:unlocked');};
  const resetRefreshCost=()=>{CT_SHOP.refreshCost=20;};

  /* ========== 金币经济闭环 ========== */
  const CT={normal:5,fast:8,elite:20,boss:200};

  // 击杀奖励
  function _onTankDead(e){
    e=e||{};const{dead,killer}=e;
    /* Tank 没有 isPlayer 字段（实际用 type==='player'）—— 此前用
     * killer.isPlayer 判定恒为 false → 击杀金币从不发放 */
    if(!killer||killer.type!=='player'||!dead||dead.type==='player')return;
    const rk=dead.rank||(dead.isBoss?'boss':'normal');
    const mc=killer.muls?.coinGain||1,ms=killer.muls?.scoreGain||1;
    const b=CT[rk]??5;
    killer.coins=(killer.coins||0)+Math.round(b*mc);
    killer.score=(killer.score||0)+Math.round(b*ms*10);
    CB.emit&&CB.emit('shop:coinsGained',{target:killer,coins:Math.round(b*mc),reason:'kill',rank:rk});
  }

  // 波次奖励
  function _onWaveEnded(e){
    e=e||{};const{wave,player}=e;
    if(!player||!wave)return;
    const g=30*wave;player.coins=(player.coins||0)+g;
    CS.saveProfile&&CS.saveProfile();
    CB.emit&&CB.emit('shop:coinsGained',{target:player,coins:g,reason:'wave',wave});
  }

  // 占点排名奖励
  function rewardKingHillRanking(players,ranks){
    if(!Array.isArray(players)||!players.length)return[];
    const rw=[100,60,30],out=[],ord=ranks&&ranks.length?ranks:players.map((_,i)=>i);
    for(let k=0;k<Math.min(ord.length,3);k++){
      const idx=ord[k],p=players[idx];if(!p)continue;
      const g=rw[k]||0;p.coins=(p.coins||0)+g;
      out.push({index:idx,coins:g,rank:k+1});
    }
    CS.saveProfile&&CS.saveProfile();return out;
  }

  // 复活支付
  function tryResurrectPayment(player,cost=100){
    if(!player)return false;
    if((player.coins||0)<cost)return false;
    player.coins-=cost;
    if(typeof player.revive==='function')player.revive();
    else{player.hp=player.maxHp||(player.hp||1);player.dead=false;}
    CS.saveProfile&&CS.saveProfile();
    CB.emit&&CB.emit('shop:resurrectPaid',{player,cost});return true;
  }

  // 自动注册 hook
  function _registerHooks(){
    const bus=window.EventBus||window.CT_BUS;
    if(!bus||typeof bus.on!=='function')return;
    bus.on('tank:dead',_onTankDead);
    bus.on('wave:ended',_onWaveEnded);
  }
  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',_registerHooks,{once:true});
    else _registerHooks();
  }else _registerHooks();

  /* ========== 导出全局 ========== */
  const CT_SHOP={
    ITEMS,RARITY_WEIGHTS:Object.assign({},RW),DEFAULT_COUNTS:Object.assign({},DC),RARITIES:RAR.slice(),
    currentStock:[],refreshCost:20,discount:1.0,locked:false,
    refreshStock,purchase,manualRefresh,setDiscount,lock,unlock,resetRefreshCost,
    rewardKingHillRanking,tryResurrectPayment,
    _debug:{_onTankDead,_onWaveEnded,_weightedPick:_wp,_rand:_r},
  };
  window.CT_SHOP=CT_SHOP;
})();

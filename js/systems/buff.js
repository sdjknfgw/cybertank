/**
 * CYBERTANK · 增益系统 (Task 5)
 * 50 种增益定义 + 三选一抽卡 + 递减叠加 + 坦克兼容 + 保底
 * 全部挂 window.CT_BUFF，无 DOM UI（UI 由 buff-ui.js 后续任务做）
 */
(function () {
  'use strict';
  // ====== 内部工具 ======
  function clone(o){return JSON.parse(JSON.stringify(o));}
  function rand(){return Math.random();}
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function weightedPick(w){var t=0,k;for(k in w)t+=w[k];var r=rand()*t,a=0;for(k in w){a+=w[k];if(r<a)return k;}return k;}
  /* 事件总线：主通道是 CT_BUS（此前误用 window.EventBus —— 它从未被创建，
   * buff:changed 事件全部静默丢弃 → buff-ui 的增益栏永远收不到通知，"增益效果不显示"的根因） */
  function getEB(){return window.CT_BUS||window.EventBus||{emit:function(){}};}

  // stackType: 'multiply' 递减 1-(1-a)^stacks; 'linear' a*stacks; stackable:'unique' 仅 1 层；maxStacks 封顶
  var DEFS = {
    // ====== 火力 11 F01~F11 ======
    F01:{id:'F01',name:'高速射击',icon:'⚡',rarity:'common',cat:'fire',valuePerStack:0.18,stackType:'multiply',maxStacks:0.63,
      apply:function(t,v){t.muls.fireRate*=(1+v);},unapply:function(t,v){t.muls.fireRate/=(1+v);},
      description:function(s,v){return'射速 +'+Math.round(v*100)+'%（'+s+'层）';}},
    F02:{id:'F02',name:'强化弹药',icon:'💥',rarity:'common',cat:'fire',valuePerStack:0.15,stackType:'multiply',maxStacks:0.55,
      apply:function(t,v){t.muls.damage*=(1+v);},unapply:function(t,v){t.muls.damage/=(1+v);},
      description:function(s,v){return'伤害 +'+Math.round(v*100)+'%（'+s+'层）';}},
    F03:{id:'F03',name:'扩容弹夹',icon:'📦',rarity:'common',cat:'fire',valuePerStack:2,stackType:'linear',maxStacks:10,
      apply:function(t,v){t.muls.maxBulletsOffset=(t.muls.maxBulletsOffset||0)+v;},unapply:function(t,v){t.muls.maxBulletsOffset-=v;},
      description:function(s,v){return'同屏子弹数 +'+v+'（'+s+'层）';}},
    F04:{id:'F04',name:'重型火炮',icon:'🔫',rarity:'rare',cat:'fire',stackable:'unique',valuePerStack:0,
      apply:function(t){t.muls.damage*=1.35;t.muls.fireRate*=0.92;},unapply:function(t){t.muls.damage/=1.35;t.muls.fireRate/=0.92;},
      description:function(){return'伤害 +35%，射速 -8%（不可叠加）';}},
    F05:{id:'F05',name:'三重射击',icon:'🎯',rarity:'rare',cat:'fire',stackable:'unique',valuePerStack:0,
      apply:function(t){t.muls.tripleShot=1;},unapply:function(t){t.muls.tripleShot=0;},
      description:function(){return'每次射击发射 3 发子弹（不可叠加）';}},
    F06:{id:'F06',name:'穿甲弹',icon:'🛡️',rarity:'common',cat:'fire',valuePerStack:1,stackType:'linear',maxStacks:4,
      apply:function(t,v){t.muls.pierceOffset=(t.muls.pierceOffset||0)+v;},unapply:function(t,v){t.muls.pierceOffset-=v;},
      description:function(s,v){return'穿透 +'+v+'（'+s+'层，最多+4）';}},
    F07:{id:'F07',name:'爆裂弹头',icon:'💣',rarity:'rare',cat:'fire',valuePerStack:0.50,stackType:'multiply',maxStacks:2.0,
      apply:function(t,v){t.muls.splashDmg*=(1+v);t.muls.splashRadius*=(1+v*0.5);},
      unapply:function(t,v){t.muls.splashDmg/=(1+v);t.muls.splashRadius/=(1+v*0.5);},
      description:function(s,v){return'爆炸范围与伤害 +'+Math.round(v*100)+'%（'+s+'层）';}},
    F08:{id:'F08',name:'链式引爆',icon:'⛓️',rarity:'epic',cat:'fire',valuePerStack:0.10,stackType:'linear',maxStacks:0.5,baseChance:0.5,
      apply:function(t,v){t._buffF08Chance=0.5+v;},unapply:function(t){t._buffF08Chance=0;},
      description:function(s,v){return'击杀时 '+(Math.round((0.5+v)*100))+'% 概率引爆附近敌人（'+s+'层）';}},
    F09:{id:'F09',name:'超电磁炮',icon:'⚡',rarity:'epic',cat:'fire',valuePerStack:1,stackType:'linear',maxStacks:3,baseInterval:6,
      apply:function(t,v){t._buffF09Interval=Math.max(2,6-v);t._buffF09Count=0;},unapply:function(t){t._buffF09Interval=t._buffF09Count=0;},
      description:function(s,v){return'每 '+Math.max(2,6-v)+' 发子弹装填超重弹（伤害×4 穿透3）（'+s+'层）';}},
    F10:{id:'F10',name:'杀戮狂热',icon:'🔥',rarity:'epic',cat:'fire',stackable:'unique',valuePerStack:0,
      apply:function(t){t._buffF10Cd=0;},unapply:function(t){t._buffF10Cd=0;},
      description:function(){return'击杀后 3 秒内射速 +50%（不可叠加，刷新持续时间）';}},
    F11:{id:'F11',name:'🌠轨道炮',icon:'🌠',rarity:'legendary',cat:'fire',valuePerStack:1,stackType:'linear',maxStacks:5,baseCd:8,
      apply:function(t,v){t._buffF11Cd=Math.max(3,8-v);t._buffF11Timer=0;},unapply:function(t){t._buffF11Cd=t._buffF11Timer=0;},
      description:function(s,v){return'每 '+Math.max(3,8-v)+'s 召唤卫星激光打击（'+s+'层）';}},

    // ====== 防御 10 D01~D10 ======
    D01:{id:'D01',name:'纳米装甲',icon:'🛡️',rarity:'common',cat:'defense',valuePerStack:0.12,stackType:'multiply',maxStacks:0.75,
      apply:function(t,v){var c=t.muls.dr||0;t.muls.dr=1-(1-c)*(1-v);},unapply:function(t,v){var c=t.muls.dr||0;t.muls.dr=1-(1-c)/(1-v);},
      description:function(s,v){return'伤害减免 +'+Math.round(v*100)+'%（'+s+'层，上限75%）';}},
    D02:{id:'D02',name:'结构强化',icon:'🧱',rarity:'common',cat:'defense',valuePerStack:1,stackType:'linear',maxStacks:10,
      apply:function(t,v){t.muls.maxHpOffset=(t.muls.maxHpOffset||0)+v;if(t.addMaxHp)t.addMaxHp(v);},
      unapply:function(t,v){t.muls.maxHpOffset-=v;if(t.subMaxHp)t.subMaxHp(v);},
      description:function(s,v){return'最大生命 +'+v+'（'+s+'层）';}},
    D03:{id:'D03',name:'自愈模块',icon:'💚',rarity:'rare',cat:'defense',valuePerStack:1.5,stackType:'linear',maxStacks:12,baseInterval:15,
      apply:function(t,v){t._buffD03Interval=Math.max(3,15-v);t._buffD03Timer=0;},unapply:function(t){t._buffD03Interval=t._buffD03Timer=0;},
      description:function(s,v){return'每 '+Math.max(3,15-v)+'s 回复 1 HP（'+s+'层）';}},
    D04:{id:'D04',name:'反应护盾',icon:'💠',rarity:'rare',cat:'defense',valuePerStack:0.08,stackType:'linear',maxStacks:0.6,baseChance:0.2,
      apply:function(t,v){t._buffD04Chance=Math.min(0.6,0.2+v);},unapply:function(t){t._buffD04Chance=0;},
      description:function(s,v){return Math.round(Math.min(0.6,0.2+v)*100)+'% 概率完全闪避（'+s+'层，上限60%）';}},
    D05:{id:'D05',name:'能量壁垒',icon:'🔷',rarity:'common',cat:'defense',valuePerStack:1,stackType:'linear',maxStacks:6,
      apply:function(t,v){t.muls.shieldMaxOffset=(t.muls.shieldMaxOffset||0)+v;if(t.addShield)t.addShield(v);},
      unapply:function(t,v){t.muls.shieldMaxOffset-=v;},
      description:function(s,v){return'护盾上限 +'+v+'（'+s+'层）';}},
    D06:{id:'D06',name:'紧急修复',icon:'🧰',rarity:'rare',cat:'defense',valuePerStack:1,stackType:'linear',maxStacks:5,baseUses:1,
      apply:function(t,v){t._buffD06Max=v;},unapply:function(t){t._buffD06Max=0;},
      description:function(s,v){return'HP<30% 时自动回满（每局 '+v+' 次，'+s+'层）';}},
    D07:{id:'D07',name:'力场偏转',icon:'🌀',rarity:'epic',cat:'defense',valuePerStack:0.08,stackType:'linear',maxStacks:0.65,baseChance:0.25,
      apply:function(t,v){t._buffD07Chance=Math.min(0.85,0.25+v);},unapply:function(t){t._buffD07Chance=0;},
      description:function(s,v){return Math.round(Math.min(0.85,0.25+v)*100)+'% 概率反弹敌弹（'+s+'层）';}},
    D08:{id:'D08',name:'幽灵相位',icon:'👻',rarity:'epic',cat:'defense',valuePerStack:3,stackType:'linear',maxStacks:24,baseCd:30,duration:2,
      apply:function(t,v){t._buffD08Cd=Math.max(6,30-v);t._buffD08Timer=0;t._buffD08Active=false;},
      unapply:function(t){t._buffD08Cd=t._buffD08Timer=t._buffD08Active=0;},
      description:function(s,v){return'每 '+Math.max(6,30-v)+'s 隐身 2s（敌人忽略目标）（'+s+'层）';}},
    D09:{id:'D09',name:'不屈意志',icon:'💪',rarity:'epic',cat:'defense',stackable:'unique',valuePerStack:0,duration:1,
      apply:function(t){t._buffD09Armed=true;t._buffD09Lock=0;},unapply:function(t){t._buffD09Armed=false;t._buffD09Lock=0;},
      description:function(){return'致命伤锁血 1s，移速+80%（不可叠加，冷却15s）';}},
    D10:{id:'D10',name:'🌟量子不朽',icon:'🌟',rarity:'legendary',cat:'defense',stackable:'unique',valuePerStack:0,uses:3,
      apply:function(t){t._buffD10Revives=3;},unapply:function(t){t._buffD10Revives=0;},
      description:function(){return'死亡时自动复活（每局 3 次，不可叠加）';}},

    // ====== 机动 8 M01~M08 ======
    M01:{id:'M01',name:'涡轮引擎',icon:'🛞',rarity:'common',cat:'mobility',valuePerStack:0.15,stackType:'multiply',maxStacks:0.80,
      apply:function(t,v){t.muls.speed*=(1+v);},unapply:function(t,v){t.muls.speed/=(1+v);},
      description:function(s,v){return'移速 +'+Math.round(v*100)+'%（'+s+'层，上限+80%）';}},
    M02:{id:'M02',name:'液压传动',icon:'⚙️',rarity:'common',cat:'mobility',valuePerStack:0.20,stackType:'multiply',maxStacks:1.2,
      apply:function(t,v){t.muls.turn=(t.muls.turn||1)*(1+v);},unapply:function(t,v){t.muls.turn=(t.muls.turn||1)/(1+v);},
      description:function(s,v){return'转向 +'+Math.round(v*100)+'%（'+s+'层）';}},
    M03:{id:'M03',name:'履带防滑',icon:'🦶',rarity:'rare',cat:'mobility',stackable:'unique',valuePerStack:0,
      apply:function(t){t.muls.terrainTraction=1;},unapply:function(t){t.muls.terrainTraction=0;},
      description:function(){return'泥地/冰面不减速（不可叠加）';}},
    M04:{id:'M04',name:'冲刺模块',icon:'💨',rarity:'rare',cat:'mobility',valuePerStack:0.8,stackType:'linear',maxStacks:4.8,baseCd:6,
      apply:function(t,v){t.muls.dashCdOffset=(t.muls.dashCdOffset||0)-v;},unapply:function(t,v){t.muls.dashCdOffset+=v;},
      description:function(s,v){return'Shift 冲刺 CD -'+v.toFixed(1)+'s（'+s+'层）';}},
    M05:{id:'M05',name:'瞬时刹车',icon:'🛑',rarity:'common',cat:'mobility',valuePerStack:0.6,stackType:'multiply',maxStacks:2.5,
      apply:function(t,v){t.muls.friction*=(1+v);},unapply:function(t,v){t.muls.friction/=(1+v);},
      description:function(s,v){return'摩擦系数 ×'+(1+v).toFixed(2)+'（惯性降低，'+s+'层）';}},
    M06:{id:'M06',name:'短距跃迁',icon:'✨',rarity:'epic',cat:'mobility',valuePerStack:1,stackType:'linear',maxStacks:7,baseCd:10,
      apply:function(t,v){t.muls.blinkCdOffset=(t.muls.blinkCdOffset||0)-v;},unapply:function(t,v){t.muls.blinkCdOffset+=v;},
      description:function(s,v){return'E 键瞬移至鼠标位置（CD '+Math.max(3,10-v)+'s，'+s+'层）';}},
    M07:{id:'M07',name:'时间扭曲',icon:'⏳',rarity:'epic',cat:'mobility',valuePerStack:0.25,stackType:'multiply',maxStacks:0.7,
      apply:function(t,v){t.muls.enemyBulletSlow*=(1-v);},unapply:function(t,v){t.muls.enemyBulletSlow/=(1-v);},
      description:function(s,v){return'光环：敌弹速度 ×'+(1-v).toFixed(2)+'（'+s+'层）';}},
    M08:{id:'M08',name:'💫空间折叠',icon:'💫',rarity:'legendary',cat:'mobility',stackable:'unique',valuePerStack:0,
      apply:function(t){t.muls.speed*=1.6;t.muls.enemyAISlow=0.7;},unapply:function(t){t.muls.speed/=1.6;t.muls.enemyAISlow=1;},
      description:function(){return'自身移速×1.6 + 敌人AI速度×0.7（不可叠加）';}},

    // ====== 技能 7 S01~S07 ======
    S01:{id:'S01',name:'超频核心',icon:'⏱️',rarity:'common',cat:'skill',valuePerStack:0.15,stackType:'multiply',maxStacks:0.60,
      apply:function(t,v){t.muls.skillCd*=(1-v);},unapply:function(t,v){t.muls.skillCd/=(1-v);},
      description:function(s,v){return'技能 CD ×'+(1-v).toFixed(2)+'（'+s+'层，最多-60%）';}},
    S02:{id:'S02',name:'能量灌输',icon:'🔋',rarity:'rare',cat:'skill',valuePerStack:0.25,stackType:'multiply',maxStacks:1.5,
      apply:function(t,v){t.muls.skillDuration*=(1+v);},unapply:function(t,v){t.muls.skillDuration/=(1+v);},
      description:function(s,v){return'技能持续 +'+Math.round(v*100)+'%（'+s+'层）';}},
    S03:{id:'S03',name:'强化冲刺',icon:'💨',rarity:'rare',cat:'skill',compatibleTanks:['assault'],stackable:'unique',valuePerStack:0,
      apply:function(t){t.muls.dashDistMul=1.4;t.muls.dashDamage=1;},unapply:function(t){t.muls.dashDistMul=1;t.muls.dashDamage=0;},
      description:function(){return'突击限定：冲刺距离+40%，路径敌人造成伤害（不可叠加）';}},
    S04:{id:'S04',name:'过载护盾',icon:'🔷',rarity:'rare',cat:'skill',compatibleTanks:['heavy'],stackable:'unique',valuePerStack:0,
      apply:function(t){t.muls.shieldAbsorbMul=2;t.muls.shieldBreakExplode=1;},unapply:function(t){t.muls.shieldAbsorbMul=1;t.muls.shieldBreakExplode=0;},
      description:function(){return'重装限定：护盾×2吸收，破碎爆炸伤害=5 半径=120（不可叠加）';}},
    S05:{id:'S05',name:'蓄能巨炮',icon:'🎯',rarity:'epic',cat:'skill',compatibleTanks:['sniper'],stackable:'unique',valuePerStack:0,
      apply:function(t){t.muls.chargeShotMax=3;},unapply:function(t){t.muls.chargeShotMax=0;},
      description:function(){return'狙击限定：长按蓄能最多伤害×3（不可叠加）';}},
    S06:{id:'S06',name:'智能地雷',icon:'💣',rarity:'epic',cat:'skill',compatibleTanks:['engineer'],stackable:'unique',valuePerStack:0,
      apply:function(t){t.muls.mineHoming=1;t.muls.mineSplashMul=1.8;},unapply:function(t){t.muls.mineHoming=0;t.muls.mineSplashMul=1;},
      description:function(){return'技师限定：地雷自动追踪，爆炸范围+80%（不可叠加）';}},
    S07:{id:'S07',name:'🔮觉醒形态',icon:'🔮',rarity:'legendary',cat:'skill',stackable:'unique',valuePerStack:0,duration:20,hpThres:0.5,
      apply:function(t){t._buffS07Armed=true;t._buffS07Used=false;},unapply:function(t){t._buffS07Armed=t._buffS07Used=false;},
      description:function(){return'HP<50% 自动触发技能无冷却 20s（每局1次，不可叠加）';}},

    // ====== 经济 7 E01~E07 ======
    E01:{id:'E01',name:'磁力吸附',icon:'🧲',rarity:'common',cat:'economy',valuePerStack:0.60,stackType:'multiply',maxStacks:3.0,
      apply:function(t,v){t.muls.pickupRange*=(1+v);},unapply:function(t,v){t.muls.pickupRange/=(1+v);},
      description:function(s,v){return'拾取范围 ×'+(1+v).toFixed(2)+'（'+s+'层）';}},
    E02:{id:'E02',name:'贪婪算法',icon:'📈',rarity:'common',cat:'economy',valuePerStack:0.20,stackType:'multiply',maxStacks:2.0,
      apply:function(t,v){t.muls.scoreGain*=(1+v);},unapply:function(t,v){t.muls.scoreGain/=(1+v);},
      description:function(s,v){return'分数获取 ×'+(1+v).toFixed(2)+'（'+s+'层）';}},
    E03:{id:'E03',name:'道具幸运',icon:'🍀',rarity:'rare',cat:'economy',valuePerStack:0.30,stackType:'multiply',maxStacks:2.0,
      apply:function(t,v){t.muls.dropRate*=(1+v);},unapply:function(t,v){t.muls.dropRate/=(1+v);},
      description:function(s,v){return'掉落率 ×'+(1+v).toFixed(2)+'（'+s+'层，上限×3）';}},
    E04:{id:'E04',name:'双倍金币',icon:'💰',rarity:'rare',cat:'economy',valuePerStack:0.50,stackType:'multiply',maxStacks:4.0,
      apply:function(t,v){t.muls.coinGain*=(1+v);},unapply:function(t,v){t.muls.coinGain/=(1+v);},
      description:function(s,v){return'金币获取 ×'+(1+v).toFixed(2)+'（'+s+'层）';}},
    E05:{id:'E05',name:'即时补给',icon:'📦',rarity:'rare',cat:'economy',valuePerStack:0.10,stackType:'linear',maxStacks:0.6,baseChance:0.3,
      apply:function(t,v){t._buffE05Chance=0.3+v;},unapply:function(t){t._buffE05Chance=0;},
      description:function(s,v){return'每波结束 '+(Math.round((0.3+v)*100))+'% 概率额外随机道具（'+s+'层）';}},
    E06:{id:'E06',name:'宝箱生成器',icon:'🎁',rarity:'epic',cat:'economy',stackable:'unique',valuePerStack:0,waves:2,
      apply:function(t){t._buffE06Wave=2;},unapply:function(t){t._buffE06Wave=0;},
      description:function(){return'每 2 波地图随机生成宝箱（不可叠加）';}},
    E07:{id:'E07',name:'🏆传奇荣耀',icon:'🏆',rarity:'legendary',cat:'economy',stackable:'unique',valuePerStack:0,
      apply:function(t){t.muls.scoreGain*=3;t.muls.coinGain*=2;},unapply:function(t){t.muls.scoreGain/=3;t.muls.coinGain/=2;},
      description:function(){return'分数×3，金币×2（不可叠加）';}},

    // ====== 特殊 7 X01~X07 ======
    X01:{id:'X01',name:'子弹反弹',icon:'🔄',rarity:'common',cat:'special',valuePerStack:1,stackType:'linear',maxStacks:4,
      apply:function(t,v){t.muls.bounceOffset=(t.muls.bounceOffset||0)+v;},unapply:function(t,v){t.muls.bounceOffset-=v;},
      description:function(s,v){return'子弹可反弹 +'+v+'次（'+s+'层，最多+4）';}},
    X02:{id:'X02',name:'吸血弹丸',icon:'🩸',rarity:'rare',cat:'special',valuePerStack:0.2,stackType:'linear',maxStacks:1.2,baseHeal:0.3,
      apply:function(t,v){t._buffX02Heal=0.3+v;},unapply:function(t){t._buffX02Heal=0;},
      description:function(s,v){return'击杀回血 '+(0.3+v).toFixed(1)+' HP（'+s+'层）';}},
    X03:{id:'X03',name:'分裂弹头',icon:'✳️',rarity:'rare',cat:'special',stackable:'unique',valuePerStack:0,
      apply:function(t){t.muls.splitBullet=3;},unapply:function(t){t.muls.splitBullet=0;},
      description:function(){return'命中后分裂 3 枚小弹（不可叠加）';}},
    X04:{id:'X04',name:'重力场',icon:'🌀',rarity:'epic',cat:'special',valuePerStack:0.40,stackType:'multiply',maxStacks:0.9,
      apply:function(t,v){t.muls.enemyMoveSlow*=(1-v);},unapply:function(t,v){t.muls.enemyMoveSlow/=(1-v);},
      description:function(s,v){return'光环：敌人移速 ×'+(1-v).toFixed(2)+'（'+s+'层）';}},
    X05:{id:'X05',name:'诱饵无人机',icon:'🛩️',rarity:'epic',cat:'special',valuePerStack:1,stackType:'linear',maxStacks:4,baseCount:2,
      apply:function(t,v){t._buffX05Count=1+v;},unapply:function(t){t._buffX05Count=0;},
      description:function(s,v){return'跟随无人机 '+(1+v)+' 架，自动射击伤害0.25（'+s+'层）';}},
    X06:{id:'X06',name:'💣自爆核心',icon:'💣',rarity:'epic',cat:'special',stackable:'unique',valuePerStack:0,dmg:0.8,
      apply:function(t){t._buffX06Armed=true;},unapply:function(t){t._buffX06Armed=false;},
      description:function(){return'死亡时全屏爆炸 0.8 倍率伤害（不可叠加）';}},
    X07:{id:'X07',name:'🌈赛博彩虹',icon:'🌈',rarity:'legendary',cat:'special',stackable:'unique',valuePerStack:0,
      apply:function(t){t.muls.damage*=1.2;t.muls.fireRate*=1.2;t.muls.speed*=1.2;t.muls.dr=1-(1-(t.muls.dr||0))*0.8;t._rainbowHue=0;},
      unapply:function(t){t.muls.damage/=1.2;t.muls.fireRate/=1.2;t.muls.speed/=1.2;t.muls.dr=1-(1-(t.muls.dr||0))/0.8;t._rainbowHue=0;},
      description:function(){return'全属性×1.2（伤害/射速/移速/减伤），坦克颜色流动动画（不可叠加）';}}
  };

  var RARITY_WEIGHTS={common:55,rare:28,epic:13,legendary:4};
  var RARITY_UPGRADE={common:'rare',rare:'epic',epic:'legendary',legendary:'legendary'};
  var IS_HIGH={epic:true,legendary:true};
  var RARITY_COLORS={common:'#9aa0a6',rare:'#4fc3f7',epic:'#ba68c8',legendary:'#ffd54f'};

  var state={activeBuffs:{},noHighRarityStreak:0};

  // ====== 叠加计算（递减公式）======
  // 断言注释（单元测试式）：F01 valuePerStack=0.18 maxStacks=0.63
  // 1 - (1-0.18)^5 ≈ 0.6293 → maxStacks 封顶 0.63 → fireRate mul = 1.63（+63%，非 90% 线性）✓
  function computeCurrentValue(def,stacks){
    if(def.stackable==='unique')return NaN;
    var v=def.stackType==='multiply'?1-Math.pow(1-def.valuePerStack,stacks):def.valuePerStack*stacks;
    if(typeof def.maxStacks==='number')v=clamp(v,-1e9,def.maxStacks);
    return v;
  }

  function rollRarity(forceHigh){
    if(forceHigh)return weightedPick({epic:RARITY_WEIGHTS.epic,legendary:RARITY_WEIGHTS.legendary});
    return weightedPick(RARITY_WEIGHTS);
  }
  function isCompatible(def,tank){
    if(!def.compatibleTanks)return true;
    var tc=(tank&&(tank.tankClass||tank.classId))||'';
    return def.compatibleTanks.indexOf(tc)>=0;
  }
  function rollDefId(rarity,tank,exclude,max){
    max=max||80;var pool=[],k,d;
    for(k in DEFS){d=DEFS[k];if(d.rarity===rarity&&isCompatible(d,tank)&&!exclude[k])pool.push(k);}
    if(!pool.length)return null;
    for(var i=0;i<max;i++){
      var p=pool[Math.floor(rand()*pool.length)];
      if(DEFS[p].stackable==='unique'){
        var tb=state.activeBuffs[tank&&tank.id]||[],has=false;
        for(var j=0;j<tb.length;j++)if(tb[j].defId===p){has=true;break;}
        if(has)continue;
      }
      return p;
    }
    return pool[0];
  }

  /** 生成 3 张增益卡：rarityUp=true 升一阶；保底：streak>=4 时第3张必 epic+ */
  // 保底统计脚本注释（mock 验证，不强制运行）：
  // var hi=0;for(var i=0;i<1000;i++){CT_BUFF._setStreak(4);var c=CT_BUFF.generateThreeCards(mTank);if(c.some(x=>IS_HIGH[x.rarity]))hi++;}hi===1000 ✓
  function generateThreeCards(tank,modifiers){
    modifiers=modifiers||{};var rarityUp=!!modifiers.rarityUp,exclude={},cards=[];
    var forceHigh=(state.noHighRarityStreak>=4);
    for(var i=0;i<3;i++){
      var r=rollRarity(i===2&&forceHigh);
      if(rarityUp)r=RARITY_UPGRADE[r]||r;
      var id=rollDefId(r,tank,exclude);
      if(!id){var order=r==='common'?['common','rare','epic','legendary']:['legendary','epic','rare','common'];
        for(var o=0;o<order.length&&!id;o++)id=rollDefId(order[o],tank,exclude);}
      if(!id)break;exclude[id]=true;var c=clone(DEFS[id]);c.color=RARITY_COLORS[c.rarity];cards.push(c);
    }
    return cards;
  }

  /** 应用选择的增益到 tank（按递减叠加），派发 buff:changed */
  function applySelection(tank,defId){
    var def=DEFS[defId];if(!def)return{ok:false,error:'unknown '+defId};
    if(!isCompatible(def,tank))return{ok:false,error:'incompatible'};
    if(!tank.muls)tank.muls={};
    IS_HIGH[def.rarity]?state.noHighRarityStreak=0:state.noHighRarityStreak+=1;
    var tid=tank.id;if(!state.activeBuffs[tid])state.activeBuffs[tid]=[];
    var list=state.activeBuffs[tid],buff=null,i;
    for(i=0;i<list.length;i++)if(list[i].defId===defId){buff=list[i];break;}
    var unique=def.stackable==='unique';
    if(unique&&buff)return{ok:true,buff:buff};
    if(!buff){buff={defId:defId,stacks:0,currentValue:null,appliedValue:null};list.push(buff);}
    if(buff.stacks>0){unique?def.unapply(tank):def.unapply(tank,buff.appliedValue);}
    buff.stacks+=1;var nv=computeCurrentValue(def,buff.stacks);
    buff.currentValue=nv;unique?def.apply(tank):def.apply(tank,nv);buff.appliedValue=nv;
    /* payload 带上完整增益列表（renderBar 直接可用的格式：{def, stacks, rarity}）。
     * 此前只有 {tank, buff, def} —— buff-ui 拿不到数组，增益栏永远渲染空。 */
    getEB().emit('buff:changed',{tank:tank,buff:buff,def:def,buffs:_formatBuffs(tid)});
    return{ok:true,buff:buff};
  }

  /** 把 activeBuffs[tid] 整形为 buff-ui renderBar 可直接消费的列表 */
  function _formatBuffs(tid){
    var list=state.activeBuffs[tid];if(!list)return[];
    var out=[],i,b,d;
    for(i=0;i<list.length;i++){b=list[i];d=DEFS[b.defId];if(!d)continue;
      out.push({def:d,defId:b.defId,stacks:b.stacks,rarity:d.rarity,name:d.name});}
    return out;
  }

  // ====== 计时 tick（自愈/D08 相位/F10 狂热/F11 轨道炮/X05 无人机/X07 彩虹色相）======
  function tickTimers(tank,dt){
    var list=state.activeBuffs[tank&&tank.id];if(!list)return;
    for(var i=0,b;i<list.length;i++){b=list[i];
      switch(b.defId){
        case'D03':if(tank._buffD03Interval>0){tank._buffD03Timer=(tank._buffD03Timer||0)+dt;
          if(tank._buffD03Timer>=tank._buffD03Interval){tank._buffD03Timer=0;if(tank.heal)tank.heal(1);getEB().emit('buff:tick',{tank:tank,defId:'D03',type:'heal'});}}break;
        case'D08':if(tank._buffD08Cd>0){tank._buffD08Timer=(tank._buffD08Timer||0)+dt;
          if(!tank._buffD08Active&&tank._buffD08Timer>=tank._buffD08Cd){tank._buffD08Timer=0;tank._buffD08Active=true;if(tank.setInvisible)tank.setInvisible(true);getEB().emit('buff:tick',{tank:tank,defId:'D08',type:'on'});}
          else if(tank._buffD08Active&&tank._buffD08Timer>=2){tank._buffD08Timer=0;tank._buffD08Active=false;if(tank.setInvisible)tank.setInvisible(false);getEB().emit('buff:tick',{tank:tank,defId:'D08',type:'off'});}}break;
        case'F10':if(tank._buffF10Timer>0){tank._buffF10Timer-=dt;if(tank._buffF10Timer<=0){tank._buffF10Timer=0;tank.muls.fireRate/=1.5;getEB().emit('buff:tick',{tank:tank,defId:'F10',type:'off'});}}break;
        case'F11':if(tank._buffF11Cd>0){tank._buffF11Timer=(tank._buffF11Timer||0)+dt;if(tank._buffF11Timer>=tank._buffF11Cd){tank._buffF11Timer=0;getEB().emit('buff:tick',{tank:tank,defId:'F11',type:'orbital'});}}break;
        case'X05':tank._buffX05ShootTimer=(tank._buffX05ShootTimer||0)+dt;if(tank._buffX05ShootTimer>=0.8&&tank._buffX05Count>0){tank._buffX05ShootTimer=0;getEB().emit('buff:tick',{tank:tank,defId:'X05',type:'drone'});}break;
        case'X07':tank._rainbowHue=((tank._rainbowHue||0)+dt*60)%360;break;
      }
    }
  }

  // ====== 事件钩子：event ∈ {kill, takeDamage, dead, fire, hpChange} ======
  function onEvent(event,tank,ctx){ctx=ctx||{};
    var list=state.activeBuffs[tank&&tank.id];if(!list)return;
    for(var i=0,b,def;i<list.length;i++){b=list[i];def=DEFS[b.defId];if(!def)continue;
      if(event==='kill'){
        if(b.defId==='F08'&&(tank._buffF08Chance||0)>0&&rand()<tank._buffF08Chance)getEB().emit('buff:event',{tank:tank,defId:'F08',type:'chain',ctx:ctx});
        if(b.defId==='X02'&&(tank._buffX02Heal||0)>0&&tank.heal)tank.heal(tank._buffX02Heal);
        if(b.defId==='F10'){(!tank._buffF10Timer||tank._buffF10Timer<=0)&&(tank.muls.fireRate*=1.5);tank._buffF10Timer=3;getEB().emit('buff:event',{tank:tank,defId:'F10',type:'refresh'});}
      }
      if(event==='takeDamage'){
        if(b.defId==='D04'&&(tank._buffD04Chance||0)>0&&rand()<tank._buffD04Chance){ctx.miss=true;ctx.damage=0;getEB().emit('buff:event',{tank:tank,defId:'D04',type:'miss',ctx:ctx});}
        if(b.defId==='D07'&&!ctx.miss&&(tank._buffD07Chance||0)>0&&rand()<tank._buffD07Chance){ctx.reflect=true;getEB().emit('buff:event',{tank:tank,defId:'D07',type:'reflect',ctx:ctx});}
        if(b.defId==='D06'){var hr=tank.hp/(tank.maxHp||1);if(hr<0.3&&(tank._buffD06Max||0)>0&&!tank._buffD06Used){tank._buffD06Used=true;tank._buffD06Max-=1;if(tank.heal)tank.heal(9999);getEB().emit('buff:event',{tank:tank,defId:'D06',type:'repair'});}}
        if(b.defId==='D09'){if(tank._buffD09Armed&&!tank._buffD09Lock&&(tank.hp-(ctx.damage||0))<=0){ctx.fatalBlocked=true;ctx.damage=Math.max(0,tank.hp-1);tank._buffD09Lock=15;tank.muls.speed*=1.8;getEB().emit('buff:event',{tank:tank,defId:'D09',type:'unbreak'});setTimeout(function(){tank.muls&&(tank.muls.speed/=1.8);},1000);}}
        if(b.defId==='S07'){if(tank._buffS07Armed&&!tank._buffS07Used&&(tank.hp/(tank.maxHp||1))<0.5){tank._buffS07Used=true;tank._buffS07Timer=20;tank.muls.skillCd=0.0001;getEB().emit('buff:event',{tank:tank,defId:'S07',type:'awaken'});}}
      }
      if(event==='dead'){
        if(b.defId==='D10'&&(tank._buffD10Revives||0)>0){tank._buffD10Revives-=1;ctx.revive=true;if(tank.heal)tank.heal(9999);if(tank.setInvincible)tank.setInvincible(3);getEB().emit('buff:event',{tank:tank,defId:'D10',type:'revive',remains:tank._buffD10Revives});}
        if(b.defId==='X06'&&tank._buffX06Armed)getEB().emit('buff:event',{tank:tank,defId:'X06',type:'boom'});
      }
      if(event==='fire'){
        if(b.defId==='F09'&&(tank._buffF09Interval||0)>0){tank._buffF09Count=((tank._buffF09Count||0)+1)%tank._buffF09Interval;if(tank._buffF09Count===0){ctx.superBullet=true;ctx.superDamage=4;ctx.superPierce=3;getEB().emit('buff:event',{tank:tank,defId:'F09',type:'rail'});}}
      }
    }
  }

  // ====== 对外暴露 ======
  var API={DEFS:DEFS,RARITY_WEIGHTS:RARITY_WEIGHTS,RARITY_COLORS:RARITY_COLORS,
    activeBuffs:state.activeBuffs,
    _setStreak:function(n){state.noHighRarityStreak=n;},
    computeCurrentValue:computeCurrentValue,generateThreeCards:generateThreeCards,
    applySelection:applySelection,tickTimers:tickTimers,onEvent:onEvent,isCompatible:isCompatible,_state:state};
  Object.defineProperty(API,'noHighRarityStreak',{get:function(){return state.noHighRarityStreak;},set:function(v){state.noHighRarityStreak=v;},configurable:true,enumerable:true});
  window.CT_BUFF=API;
})();

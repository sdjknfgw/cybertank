/* 服务端内部 tick 率探针：直接计数 setInterval 真实触发频率，排除网络/传输抖动。 */
'use strict';
// 复刻 server.js 的定时器配置并独立测量
const TICK_HZ = 30;
let ticks = 0;
const t0 = Date.now();
setInterval(() => { ticks++; }, 1000 / TICK_HZ);
setTimeout(() => {
  const elapsed = (Date.now() - t0) / 1000;
  const hz = ticks / elapsed;
  console.log(`内部 setInterval(33.3ms) 实测: ${hz.toFixed(1)} Hz (期望≈30), 样本=${ticks}, 用时=${elapsed.toFixed(2)}s`);
  // 同时观察系统时钟是否会漂移
  process.exit(0);
}, 8000);

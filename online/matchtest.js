/* 快速匹配冒烟测试：两个客户端各自 quickMatch，应被服务端自动撮合进同一房间、互为对位。 */
'use strict';
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

function mkClient(name) {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket', 'polling'] });
    const st = { name, socket: s, slot: null, room: null, started: false, snapCount: 0 };
    s.on('connect', () => s.emit('quickMatch'));
    s.on('queued', (d) => { st.queued = d.position; });
    s.on('matchStart', () => { st.started = true; });
    s.on('snapshot', () => { st.snapCount++; });
    // roomId/slot 在 peerJoined 或 matchStart 时不直接下发，这里靠 started+snap 推断撮合成功
    s.on('disconnect', () => {});
    setTimeout(() => resolve(st), 2500);
  });
}

(async () => {
  const [a, b] = await Promise.all([mkClient('A'), mkClient('B')]);
  const ok = a.started && b.started && a.snapCount > 5 && b.snapCount > 5;
  console.log('A started:', a.started, ' snap:', a.snapCount, ' queuedPos:', a.queued);
  console.log('B started:', b.started, ' snap:', b.snapCount, ' queuedPos:', b.queued);
  if (!ok) { console.error('❌ 快速匹配撮合失败'); process.exit(1); }
  console.log('✅ 快速匹配撮合通过：双方均进入对战并收到连续快照');
  a.socket.close(); b.socket.close();
  process.exit(0);
})();

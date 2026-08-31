// 冒烟测试：验证 创建房间 -> 加入 -> 开局 -> 输入同步 -> 双方收到一致快照
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

function once(sock, ev) { return new Promise(r => sock.once(ev, r)); }
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const A = io(URL), B = io(URL);
  let roomId = null, slotA = null, slotB = null;
  let snapA = null, snapB = null, countA = 0, countB = 0;
  let phaseSeen = new Set();

  A.on('snapshot', s => { snapA = s; countA++; phaseSeen.add(s.phase); });
  B.on('snapshot', s => { snapB = s; countB++; });

  A.on('roomCreated', d => { roomId = d.roomId; slotA = d.slot; });
  B.on('roomJoined', d => { slotB = d.slot; });

  A.emit('createRoom');
  await once(A, 'roomCreated');
  console.log('A 建房:', roomId, 'slot', slotA);
  if (!/^[A-Z0-9]{6}$/.test(roomId)) throw new Error('房间号格式异常');

  B.emit('joinRoom', { roomId });
  await once(B, 'roomJoined');
  console.log('B 加入完成, slot', slotB);

  // 等到进入 playing（跳过 3s 倒计时）
  let playing = false;
  for (let i = 0; i < 60; i++) {
    if (snapA && snapA.phase === 'playing') { playing = true; break; }
    await wait(100);
  }
  if (!playing) throw new Error('未在预期时间内进入 playing, 当前=' + (snapA && snapA.phase));

  // 记录起始位置，然后发输入：A 向上（世界方向），B 向右（世界方向）
  const startAy = snapA.tanks[0].y, startBx = snapA.tanks[1].x;
  const ivA = setInterval(() => A.emit('input', { up: true, aim: -Math.PI / 2 }), 33);
  const ivB = setInterval(() => B.emit('input', { right: true, aim: 0 }), 33);

  await wait(1200);
  clearInterval(ivA); clearInterval(ivB);

  // 断言（directMove 语义：up=世界向上→y 减小；right=世界向右→x 增大）
  const movedA = (startAy - snapA.tanks[0].y) > 5;
  const movedB = (snapA.tanks[1].x - startBx) > 5;
  const synced = Math.abs(snapA.tanks[0].x - snapB.tanks[0].x) < 0.001 &&
                 Math.abs(snapA.tanks[1].y - snapB.tanks[1].y) < 0.001;
  const bothFlow = countA > 30 && countB > 30;

  console.log('A 上移:', movedA, ' B 右移:', movedB, ' 双方快照一致:', synced, ' 快照流正常:', bothFlow);
  console.log('A 收到快照数:', countA, ' B 收到快照数:', countB, ' 经历阶段:', [...phaseSeen].join(','));

  if (!movedA) throw new Error('A 的输入未被服务端模拟（未向上移动）');
  if (!movedB) throw new Error('B 的输入未被服务端模拟（未向右移动）');
  if (!synced) throw new Error('两端快照不一致（同步失败）');
  if (!bothFlow) throw new Error('快照流异常');

  console.log('\n✅ 冒烟测试全部通过：房间/加入/开局/输入模拟/双端同步 均正常');
  A.close(); B.close();
  process.exit(0);
})().catch(e => { console.error('❌ 测试失败:', e.message); process.exit(1); });

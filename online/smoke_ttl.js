/* 专项：验证「随机掉落的道具若 X 秒内未拾取则自动消失」（需求4）
 * 用单颗道具场景：PUP_FIRST=1s 掉落，PUP_TTL=3s 过期，PUP_INTERVAL=100 不再掉落第二颗。
 * 预期：快照中 powerups 从 [有] → [无]，即明确消失。
 * 结果同步写入 ttl_result.txt，避免 process.exit 截断 stdout。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3998;
const URL = 'http://localhost:' + PORT;
const ENV = {
  PORT: String(PORT),
  ROUNDS_TO_WIN: '2',
  ROUND_TIME: '30',
  COUNTDOWN: '1',
  ROUND_GAP: '1',
  PUP_FIRST: '1',
  PUP_TTL: '3',
  PUP_INTERVAL: '100',
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const rec = (s) => { results.push(s); console.log(s); fs.writeFileSync(path.join(__dirname, 'ttl_result.txt'), results.join('\n') + '\n'); };
fs.writeFileSync(path.join(__dirname, 'ttl_result.txt'), 'start\n');
process.on('uncaughtException', e => { fs.writeFileSync(path.join(__dirname, 'ttl_err.txt'), 'uncaught: ' + (e && e.stack || e) + '\n'); });
process.on('unhandledRejection', e => { fs.writeFileSync(path.join(__dirname, 'ttl_err.txt'), 'unhandledRejection: ' + (e && e.stack || e) + '\n'); });

(async () => {
  rec('step: before spawn');
  const srv = spawn('node', ['server.js'], { cwd: path.join(__dirname), env: Object.assign({}, process.env, ENV), stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => { try { fs.appendFileSync(path.join(__dirname, 'ttl_srv.txt'), '[srv-err] ' + d); } catch (e) {} });
  srv.stdout.on('data', d => { try { fs.appendFileSync(path.join(__dirname, 'ttl_srv.txt'), '[srv-out] ' + d); } catch (e) {} });
  srv.on('exit', (code, sig) => { try { fs.appendFileSync(path.join(__dirname, 'ttl_srv.txt'), '[srv-exit] code=' + code + ' sig=' + sig + '\n'); } catch (e) {} });
  rec('step: spawned, waiting ready');
  let ready = false;
  await new Promise(r => { const t = setTimeout(() => { rec('timeout: not ready'); r(); }, 8000); srv.stdout.on('data', d => { if (String(d).includes('listening')) { ready = true; clearTimeout(t); r(); } }); });
  rec('step: after ready wait, ready=' + ready);
  if (!ready) { rec('[FAIL] server 未就绪'); srv.kill('SIGKILL'); await wait(200); return; }

  process.on('exit', (c) => { try { fs.appendFileSync(path.join(__dirname, 'ttl_result.txt'), '\n[process exit] code=' + c + '\n'); } catch (e) {} });

  const A = io(URL, { transports: ['websocket'], forceNew: true });
  A.on('connect_error', e => rec('A connect_error: ' + (e && e.message)));
  await new Promise((res) => { A.on('connect', res); setTimeout(() => res('timeoutA'), 5000); });
  rec('step: A connected');
  A.emit('createRoom');
  const { roomId } = await new Promise(r => A.once('roomCreated', r));
  rec('step: roomCreated ' + roomId);
  const B = io(URL, { transports: ['websocket'], forceNew: true });
  B.on('connect_error', e => rec('B connect_error: ' + (e && e.message)));
  await new Promise((res) => { B.on('connect', res); setTimeout(() => res('timeoutB'), 5000); });
  rec('step: B connected');
  await new Promise(r => { B.emit('joinRoom', { roomId }); B.once('roomJoined', r); });
  rec('step: B joined');

  await wait(1500); // 进入 playing
  rec('step: in playing');

  let sawOne = false, goneConfirmed = false;
  const seenPositions = new Set();
  const track = (s) => {
    const ps = (s.powerups || []).map(p => `${p.x},${p.y}`);
    if (ps.length > 0) { sawOne = true; ps.forEach(p => seenPositions.add(p)); }
    if (sawOne) {
      const stillThere = ps.some(p => seenPositions.has(p));
      if (!stillThere) goneConfirmed = true;
    }
  };
  A.on('snapshot', track);

  await wait(2500); // 道具应在 1s 出现
  const appeared = sawOne;
  await wait(4000); // 再等 4s 让 3s 的 TTL 过期
  A.off('snapshot', track);

  if (appeared) rec('[PASS] 需求4: 随机道具已掉落出现');
  else rec('[FAIL] 需求4: 未观察到道具掉落');

  if (appeared && goneConfirmed) rec('[PASS] 需求4: 道具在 TTL(3s) 后自动从场景消失（全局 ttl 生效）');
  else if (appeared) rec('[FAIL] 需求4: 道具未观察到消失（可能仍在场景/被重新生成）');

  A.close(); B.close();
  srv.kill('SIGKILL');
  await wait(300);
})().catch(e => { rec('[FAIL] 异常: ' + (e && e.stack || e)); });

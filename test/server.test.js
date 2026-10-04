const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const vm = require('node:vm');
const { WebSocket } = require('ws');

const root = path.join(__dirname, '..');
let serverProcess;
let port;

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 3000);
    socket.once('message', (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

async function connect() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/signal`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

test('client inline JavaScript parses', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'index.html contains the client script');
  assert.doesNotThrow(() => new vm.Script(script));
});

test('server provides health and the room signaling features', async (t) => {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', WS_HEARTBEAT: '0' },
    stdio: 'ignore'
  });
  t.after(async () => {
    serverProcess.kill('SIGTERM');
    await new Promise((resolve) => serverProcess.once('exit', resolve));
  });

  let healthy = false;
  for (let attempt = 0; attempt < 40 && !healthy; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      healthy = response.ok && await response.text() === 'ok';
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(healthy, true, 'health endpoint responds');
  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /MinhaTela/);

  let host;
  let firstViewer;
  let secondViewer;
  try {
    host = await connect();
    host.send(JSON.stringify({ type: 'join', room: 'test-room-42', role: 'host', name: 'Host' }));
    const hostJoin = await nextMessage(host);
    assert.equal(hostJoin.type, 'joined');
    assert.equal(hostJoin.temporary, true);

    firstViewer = await connect();
    firstViewer.send(JSON.stringify({ type: 'join', room: 'test-room-42', role: 'viewer', name: '<b>First</b>' }));
    const firstJoin = await nextMessage(firstViewer);
    assert.equal(firstJoin.peers[0].peerId, hostJoin.peerId);
    assert.equal((await nextMessage(host)).type, 'peer-joined');

    secondViewer = await connect();
    secondViewer.send(JSON.stringify({ type: 'join', room: 'test-room-42', role: 'viewer', name: 'Second' }));
    const secondJoin = await nextMessage(secondViewer);
    assert.equal(secondJoin.peers.length, 2);
    assert.equal((await nextMessage(host)).type, 'peer-joined');
    assert.equal((await nextMessage(firstViewer)).type, 'peer-joined');

    firstViewer.send(JSON.stringify({
      type: 'offer',
      target: secondJoin.peerId,
      sdp: { type: 'offer', sdp: 'offer-test' }
    }));
    assert.equal((await nextMessage(secondViewer)).type, 'offer');
    secondViewer.send(JSON.stringify({
      type: 'answer',
      target: firstJoin.peerId,
      sdp: { type: 'answer', sdp: 'answer-test' }
    }));
    assert.equal((await nextMessage(firstViewer)).type, 'answer');

    firstViewer.send(JSON.stringify({ type: 'chat', text: '<script>plain text</script> 😀' }));
    assert.equal((await nextMessage(host)).text, '<script>plain text</script> 😀');
    assert.equal((await nextMessage(firstViewer)).name, 'First');
    assert.equal((await nextMessage(secondViewer)).from, firstJoin.peerId);

    firstViewer.send(JSON.stringify({ type: 'state', muted: false }));
    assert.equal((await nextMessage(host)).muted, false);
    secondViewer.send(JSON.stringify({
      type: 'draw', color: '#a7e3b4', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }]
    }));
    assert.equal((await nextMessage(host)).type, 'draw');
    assert.equal((await nextMessage(firstViewer)).type, 'draw');
    secondViewer.send(JSON.stringify({ type: 'clear-draw' }));
    assert.equal((await nextMessage(host)).type, 'clear-draw');
    assert.equal((await nextMessage(firstViewer)).type, 'clear-draw');

    firstViewer.send(JSON.stringify({ type: 'pointer', point: { x: 1.2, y: 0 } }));
    assert.equal((await nextMessage(firstViewer)).type, 'error');
    firstViewer.send(JSON.stringify({ type: 'chat', text: 'x'.repeat(1001) }));
    assert.equal((await nextMessage(firstViewer)).type, 'error');
  } finally {
    host?.close();
    firstViewer?.close();
    secondViewer?.close();
  }
});
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const port = Number.parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';
const clientPath = path.join(__dirname, 'index.html');
const rooms = new Map();
const heartbeatEnabled = process.env.WS_HEARTBEAT === '1';
let heartbeatInterval;

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    fs.readFile(clientPath, (error, content) => {
      if (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Não foi possível carregar index.html.');
        return;
      }

      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(content);
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Não encontrado.');
});

const webSocketServer = new WebSocketServer({
  server,
  path: '/signal',
  maxPayload: 64 * 1024,
  verifyClient: ({ origin, req }) => {
    if (!origin) return true;

    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
});

if (heartbeatEnabled) {
  heartbeatInterval = setInterval(() => {
    for (const socket of webSocketServer.clients) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }

      socket.isAlive = false;
      socket.ping();
    }
  }, 25000);
  heartbeatInterval.unref();
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function roomMembers(room) {
  return rooms.get(room) || new Map();
}

function publicPeer(socket) {
  return { peerId: socket.clientId, role: socket.role, name: socket.displayName, muted: socket.muted };
}

function broadcast(room, message, excludedId) {
  for (const member of roomMembers(room).values()) {
    if (member.clientId !== excludedId) send(member, message);
  }
}

function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function leaveRoom(socket) {
  if (!socket.room || !socket.clientId) return;

  const members = rooms.get(socket.room);
  if (!members) return;

  members.delete(socket.clientId);
  broadcast(socket.room, { type: 'peer-left', peerId: socket.clientId }, socket.clientId);

  if (members.size === 0) rooms.delete(socket.room);
  socket.room = undefined;
  socket.clientId = undefined;
  socket.role = undefined;
}

webSocketServer.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });

  socket.on('message', (rawMessage) => {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      send(socket, { type: 'error', message: 'Mensagem inválida.' });
      return;
    }

    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      send(socket, { type: 'error', message: 'Formato de mensagem inválido.' });
      return;
    }

    if (message.type === 'join') {
      if (socket.room) {
        send(socket, { type: 'error', message: 'Esta conexão já entrou em uma sala.' });
        return;
      }

      const room = typeof message.room === 'string' ? message.room.trim() : '';
      const role = message.role;
      if (!/^[a-zA-Z0-9_-]{4,40}$/.test(room) || !['host', 'viewer'].includes(role)) {
        send(socket, { type: 'error', message: 'Sala ou função inválida.' });
        return;
      }

      let members = rooms.get(room);
      if (!members) {
        members = new Map();
        rooms.set(room, members);
      }

      const currentHost = [...members.values()].find((member) => member.role === 'host');
      if (role === 'host' && currentHost) {
        send(socket, { type: 'error', message: 'Esta sala já tem um transmissor.' });
        socket.close(1008, 'Sala ocupada');
        return;
      }

      const viewerCount = [...members.values()].filter((member) => member.role === 'viewer').length;
      if (role === 'viewer' && viewerCount >= 8) {
        send(socket, { type: 'error', message: 'A sala atingiu o limite de espectadores.' });
        socket.close(1008, 'Sala cheia');
        return;
      }

      socket.room = room;
      socket.role = role;
      socket.clientId = randomUUID();
      socket.displayName = typeof message.name === 'string'
        ? message.name.replace(/<[^>]*>|[\u0000-\u001f]/g, '').trim().slice(0, 32) || `Pessoa ${socket.clientId.slice(0, 4)}`
        : `Pessoa ${socket.clientId.slice(0, 4)}`;
      socket.muted = message.muted !== false;
      const existingPeers = [...members.values()].map(publicPeer);
      members.set(socket.clientId, socket);
      send(socket, { type: 'joined', peerId: socket.clientId, role, name: socket.displayName, peers: existingPeers, temporary: true });
      broadcast(room, { type: 'peer-joined', peer: publicPeer(socket) }, socket.clientId);
      return;
    }

    if (!socket.room || !socket.clientId) {
      send(socket, { type: 'error', message: 'Entre em uma sala antes de enviar sinalização.' });
      return;
    }

    const room = socket.room;

    if (message.type === 'chat') {
      if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 1000) {
        send(socket, { type: 'error', message: 'A mensagem deve ter entre 1 e 1000 caracteres.' });
        return;
      }
      broadcast(room, {
        type: 'chat',
        from: socket.clientId,
        name: socket.displayName,
        text: message.text.trim(),
        timestamp: Date.now()
      });
      return;
    }

    if (message.type === 'state') {
      if (typeof message.muted !== 'boolean') {
        send(socket, { type: 'error', message: 'Estado de microfone inválido.' });
        return;
      }
      socket.muted = message.muted;
      broadcast(room, { type: 'peer-state', peerId: socket.clientId, muted: socket.muted }, socket.clientId);
      return;
    }

    if (message.type === 'pointer') {
      if (!validPoint(message.point)) {
        send(socket, { type: 'error', message: 'Coordenada do ponteiro inválida.' });
        return;
      }
      broadcast(room, { type: 'pointer', from: socket.clientId, point: message.point, active: message.active === true }, socket.clientId);
      return;
    }

    if (message.type === 'draw') {
      if (!Array.isArray(message.points) || message.points.length < 2 || message.points.length > 80 ||
          !message.points.every(validPoint) || !/^#[0-9a-fA-F]{6}$/.test(message.color)) {
        send(socket, { type: 'error', message: 'Marcação inválida.' });
        return;
      }
      broadcast(room, { type: 'draw', from: socket.clientId, points: message.points, color: message.color }, socket.clientId);
      return;
    }

    if (message.type === 'clear-draw') {
      broadcast(room, { type: 'clear-draw', from: socket.clientId }, socket.clientId);
      return;
    }

    if (!['offer', 'answer', 'candidate'].includes(message.type)) {
      send(socket, { type: 'error', message: 'Tipo de sinalização não permitido.' });
      return;
    }

    const targetId = typeof message.target === 'string' ? message.target : '';
    const target = rooms.get(socket.room)?.get(targetId);
    const viewerMesh = socket.role === 'viewer' && target?.role === 'viewer';
    const validDirection = target && (
      message.type === 'candidate'
        ? socket.role !== target.role || viewerMesh
        : message.type === 'offer'
          ? (socket.role === 'host' && target.role === 'viewer') || viewerMesh
          : (socket.role === 'viewer' && target.role === 'host') || viewerMesh
    );

    if (!validDirection) {
      send(socket, { type: 'error', message: 'Destino ou direção de sinalização inválidos.' });
      return;
    }

    const payload = { type: message.type, from: socket.clientId };
    if (message.type === 'offer' || message.type === 'answer') {
      if (!message.sdp || typeof message.sdp !== 'object' ||
          message.sdp.type !== message.type || typeof message.sdp.sdp !== 'string' || message.sdp.sdp.length > 48 * 1024) {
        send(socket, { type: 'error', message: 'Descrição WebRTC inválida.' });
        return;
      }
      payload.sdp = message.sdp;
    } else {
      if (message.candidate !== null && (!message.candidate || typeof message.candidate !== 'object' ||
          typeof message.candidate.candidate !== 'string' || message.candidate.candidate.length > 4096)) {
        send(socket, { type: 'error', message: 'Candidato ICE inválido.' });
        return;
      }
      payload.candidate = message.candidate;
    }

    send(target, payload);
  });

  socket.on('close', () => leaveRoom(socket));
  socket.on('error', () => leaveRoom(socket));
});

server.listen(port, host, () => {
  console.log(`MinhaTela disponível em http://localhost:${port}`);
  console.log(`Sinalização WebSocket em ws://localhost:${port}/signal`);
});

function shutdown() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  for (const socket of webSocketServer.clients) socket.close(1001, 'Servidor encerrando');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
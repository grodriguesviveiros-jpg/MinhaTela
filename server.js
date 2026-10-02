const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const port = Number.parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';
const clientPath = path.join(__dirname, 'index.html');
const rooms = new Map();

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

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function leaveRoom(socket) {
  if (!socket.room || !socket.clientId) return;

  const members = rooms.get(socket.room);
  if (!members) return;

  members.delete(socket.clientId);
  for (const member of members.values()) {
    send(member, { type: 'peer-left', peerId: socket.clientId });
  }

  if (members.size === 0) rooms.delete(socket.room);
  socket.room = undefined;
  socket.clientId = undefined;
  socket.role = undefined;
}

webSocketServer.on('connection', (socket) => {
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
      members.set(socket.clientId, socket);
      send(socket, { type: 'joined', peerId: socket.clientId, role });

      if (role === 'viewer') {
        if (currentHost) send(currentHost, { type: 'viewer-joined', peerId: socket.clientId });
      } else {
        for (const member of members.values()) {
          if (member.role === 'viewer') {
            send(socket, { type: 'viewer-joined', peerId: member.clientId });
          }
        }
      }
      return;
    }

    if (!socket.room || !socket.clientId) {
      send(socket, { type: 'error', message: 'Entre em uma sala antes de enviar sinalização.' });
      return;
    }

    if (!['offer', 'answer', 'candidate'].includes(message.type)) {
      send(socket, { type: 'error', message: 'Tipo de sinalização não permitido.' });
      return;
    }

    const targetId = typeof message.target === 'string' ? message.target : '';
    const target = rooms.get(socket.room)?.get(targetId);
    const validDirection = target && socket.role !== target.role &&
      (message.type !== 'offer' || socket.role === 'host') &&
      (message.type !== 'answer' || socket.role === 'viewer');

    if (!validDirection) {
      send(socket, { type: 'error', message: 'Destino ou direção de sinalização inválidos.' });
      return;
    }

    const payload = { type: message.type, from: socket.clientId };
    if (message.type === 'offer' || message.type === 'answer') {
      if (!message.sdp || typeof message.sdp !== 'object') {
        send(socket, { type: 'error', message: 'Descrição WebRTC inválida.' });
        return;
      }
      payload.sdp = message.sdp;
    } else {
      if (message.candidate !== null && typeof message.candidate !== 'object') {
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
  for (const socket of webSocketServer.clients) socket.close(1001, 'Servidor encerrando');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
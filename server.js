/**
 * オセロ リアルタイム対戦サーバー (npm不要・ゼロ依存 Pure Node.js 実装)
 * 外部パッケージ (ws等) のインストール不要で、Node.js さえあれば動作します。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// MIMEタイプマッピング
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// 静的ファイル配信 HTTPサーバー
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  let filePath = req.url === '/' ? '/practice1.html' : req.url;
  filePath = filePath.split('?')[0];

  const absolutePath = path.join(__dirname, filePath);

  fs.stat(absolutePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + filePath);
      return;
    }

    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(absolutePath).pipe(res);
  });
});

// ============================================================
// ゼロ依存 軽量 WebSocket プロトコル実装 (RFC 6455)
// ============================================================
class ClientConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.onMessageCallback = null;
    this.onCloseCallback = null;

    socket.on('data', (chunk) => this.handleData(chunk));
    socket.on('close', () => {
      if (this.onCloseCallback) this.onCloseCallback();
    });
    socket.on('error', () => {
      if (this.onCloseCallback) this.onCloseCallback();
    });
  }

  sendJson(obj) {
    this.sendText(JSON.stringify(obj));
  }

  sendText(text) {
    if (this.socket.destroyed) return;
    const payload = Buffer.from(text, 'utf8');
    const length = payload.length;
    let header;

    if (length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81; // FIN + Text frame
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    this.socket.write(Buffer.concat([header, payload]));
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];

      const opcode = b0 & 0x0f;
      const isMasked = (b1 & 0x80) !== 0;
      let payloadLength = b1 & 0x7f;
      let offset = 2;

      // Close frame (opcode 8)
      if (opcode === 8) {
        this.socket.end();
        return;
      }
      // Ping frame (opcode 9)
      if (opcode === 9) {
        // Pong
        const pong = Buffer.from([0x8a, 0x00]);
        this.socket.write(pong);
        this.buffer = this.buffer.slice(2);
        continue;
      }

      if (payloadLength === 126) {
        if (this.buffer.length < 4) return;
        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) return;
        payloadLength = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      let maskKey = null;
      if (isMasked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLength) return;

      const payload = this.buffer.slice(offset, offset + payloadLength);
      this.buffer = this.buffer.slice(offset + payloadLength);

      if (isMasked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      if (opcode === 1 && this.onMessageCallback) { // Text frame
        this.onMessageCallback(payload.toString('utf8'));
      }
    }
  }
}

// WebSocket ハンドシェイク処理
server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ];

  socket.write(headers.join('\r\n'));

  const client = new ClientConnection(socket);
  handleClientConnection(client);
});

// ============================================================
// オセロ ルーム管理ロジック
// ============================================================
const rooms = new Map();

function generateRoomId() {
  let roomId;
  do {
    roomId = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(roomId));
  return roomId;
}

function handleClientConnection(client) {
  let currentRoomId = null;
  let userRole = null;

  client.onMessageCallback = (messageRaw) => {
    let msg;
    try {
      msg = JSON.parse(messageRaw);
    } catch (e) {
      return;
    }

    switch (msg.type) {
      case 'CREATE_ROOM': {
        currentRoomId = generateRoomId();
        userRole = 'black';

        rooms.set(currentRoomId, {
          id: currentRoomId,
          host: client,
          guest: null
        });

        console.log(`[Room ${currentRoomId}] 部屋が作成されました (ホスト待機中)`);
        client.sendJson({
          type: 'ROOM_CREATED',
          roomId: currentRoomId,
          role: 'black',
          message: '部屋を作成しました。相手の参加を待っています...'
        });
        break;
      }

      case 'JOIN_ROOM': {
        const targetRoomId = (msg.roomId || '').trim();
        const room = rooms.get(targetRoomId);

        if (!room) {
          client.sendJson({
            type: 'ERROR',
            message: `部屋番号 ${targetRoomId} が見つかりません。`
          });
          return;
        }

        if (room.guest) {
          client.sendJson({
            type: 'ERROR',
            message: `部屋番号 ${targetRoomId} は既に満員です。`
          });
          return;
        }

        currentRoomId = targetRoomId;
        userRole = 'white';
        room.guest = client;

        console.log(`[Room ${currentRoomId}] ゲストが参加しました！対戦を開始します。`);

        client.sendJson({
          type: 'GAME_START',
          roomId: currentRoomId,
          role: 'white',
          message: '部屋に参加しました！対局を開始します。'
        });

        room.host.sendJson({
          type: 'GAME_START',
          roomId: currentRoomId,
          role: 'black',
          message: '対戦相手が参加しました！対局を開始します。'
        });
        break;
      }

      case 'MOVE': {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        const opponent = client === room.host ? room.guest : room.host;
        if (opponent) {
          opponent.sendJson({
            type: 'OPPONENT_MOVE',
            move: msg.move
          });
        }
        break;
      }

      case 'PASS': {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        const opponent = client === room.host ? room.guest : room.host;
        if (opponent) {
          opponent.sendJson({
            type: 'OPPONENT_PASS',
            player: msg.player
          });
        }
        break;
      }

      case 'RESTART_REQUEST': {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        const opponent = client === room.host ? room.guest : room.host;
        if (opponent) {
          opponent.sendJson({ type: 'RESTART_REQUEST' });
        }
        break;
      }

      case 'RESTART_AGREE': {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        room.host.sendJson({ type: 'RESTART_START' });
        if (room.guest) {
          room.guest.sendJson({ type: 'RESTART_START' });
        }
        break;
      }

      case 'CHAT': {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        const opponent = client === room.host ? room.guest : room.host;
        if (opponent) {
          opponent.sendJson({
            type: 'CHAT_MESSAGE',
            sender: userRole,
            text: msg.text
          });
        }
        break;
      }
    }
  };

  client.onCloseCallback = () => {
    if (currentRoomId && rooms.has(currentRoomId)) {
      const room = rooms.get(currentRoomId);
      const isHost = client === room.host;
      const opponent = isHost ? room.guest : room.host;

      console.log(`[Room ${currentRoomId}] プレイヤーが切断しました`);

      if (opponent) {
        opponent.sendJson({
          type: 'OPPONENT_LEFT',
          message: '対戦相手との通信が切断されました。'
        });
      }

      rooms.delete(currentRoomId);
    }
  };
}

server.listen(PORT, () => {
  console.log('====================================================');
  console.log(` 🟢 オセロ リアルタイム対戦サーバー起動完了！ (npm不要)`);
  console.log(` 🌐 ブラウザで以下のURLを開いてください:`);
  console.log(`    http://localhost:${PORT}`);
  console.log('====================================================');
});

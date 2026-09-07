const http = require('http');
const fs = require('fs');
const path = require('path');

let WebSocket;
let WebSocketServer;
try {
  const wsPkg = require('ws');
  WebSocket = wsPkg.WebSocket || wsPkg;
  WebSocketServer = wsPkg.WebSocketServer || wsPkg.Server;
} catch (e) {
  console.error('\n【エラー】ws パッケージが見つかりません。');
  console.error('以下のコマンドを実行してインストールしてください:');
  console.error('  npm install\n');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

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

// 静的HTTPサーバー
const server = http.createServer((req, res) => {
  // CORSヘッダー付与
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  let filePath = req.url === '/' ? '/practice1.html' : req.url;
  // クエリパラメータを除去
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

// WebSocketサーバー
const wss = new WebSocketServer({ server });

// ルーム管理マップ: roomId => { host: ws, guest: ws, board: [...], turn: 1 }
const rooms = new Map();

function generateRoomId() {
  let roomId;
  do {
    roomId = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(roomId));
  return roomId;
}

function sendJson(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  let currentRoomId = null;
  let userRole = null; // 'black' (host) or 'white' (guest)

  ws.on('message', (messageRaw) => {
    let msg;
    try {
      msg = JSON.parse(messageRaw);
    } catch (e) {
      console.error('Invalid JSON received:', messageRaw);
      return;
    }

    switch (msg.type) {
      case 'CREATE_ROOM': {
        currentRoomId = generateRoomId();
        userRole = 'black'; // ホストは黒（先手）

        rooms.set(currentRoomId, {
          id: currentRoomId,
          host: ws,
          guest: null
        });

        console.log(`[Room ${currentRoomId}] 作成されました（ホスト接続）`);
        sendJson(ws, {
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
          sendJson(ws, {
            type: 'ERROR',
            message: `部屋番号 ${targetRoomId} が見つかりません。`
          });
          return;
        }

        if (room.guest) {
          sendJson(ws, {
            type: 'ERROR',
            message: `部屋番号 ${targetRoomId} は既に満員です。`
          });
          return;
        }

        // 参加成功
        currentRoomId = targetRoomId;
        userRole = 'white'; // ゲストは白（後手）
        room.guest = ws;

        console.log(`[Room ${currentRoomId}] ゲストが参加しました。対戦を開始します。`);

        // ゲストへ通知
        sendJson(ws, {
          type: 'GAME_START',
          roomId: currentRoomId,
          role: 'white',
          message: '部屋に参加しました！対局を開始します。'
        });

        // ホストへ通知
        sendJson(room.host, {
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

        const opponent = ws === room.host ? room.guest : room.host;
        if (opponent) {
          sendJson(opponent, {
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

        const opponent = ws === room.host ? room.guest : room.host;
        if (opponent) {
          sendJson(opponent, {
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

        const opponent = ws === room.host ? room.guest : room.host;
        if (opponent) {
          sendJson(opponent, {
            type: 'RESTART_REQUEST'
          });
        }
        break;
      }

      case 'RESTART_AGREE': {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        // 両者に再戦スタートを通知
        sendJson(room.host, { type: 'RESTART_START' });
        if (room.guest) {
          sendJson(room.guest, { type: 'RESTART_START' });
        }
        break;
      }

      case 'CHAT': {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        const opponent = ws === room.host ? room.guest : room.host;
        if (opponent) {
          sendJson(opponent, {
            type: 'CHAT_MESSAGE',
            sender: userRole,
            text: msg.text
          });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoomId && rooms.has(currentRoomId)) {
      const room = rooms.get(currentRoomId);
      const isHost = ws === room.host;
      const opponent = isHost ? room.guest : room.host;

      console.log(`[Room ${currentRoomId}] プレイヤーが退出しました (${isHost ? 'ホスト' : 'ゲスト'})`);

      if (opponent) {
        sendJson(opponent, {
          type: 'OPPONENT_LEFT',
          message: '対戦相手との通信が切断されました。'
        });
      }

      rooms.delete(currentRoomId);
    }
  });
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log(` 🟢 オセロ リアルタイム対戦サーバーが起動しました！`);
  console.log(` 🌐 ブラウザで以下のURLを開いてください:`);
  console.log(`    http://localhost:${PORT}`);
  console.log('====================================================');
});

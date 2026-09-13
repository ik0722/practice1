/**
 * オセロ (Reversi) - リアルタイム対戦＆スタンドアロン対応スクリプト
 */

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

// 8方向の探索ベクトル
const DIRECTIONS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1]
];

// マスの位置による重要度テーブル（AI用）
const WEIGHT_TABLE = [
  [ 100, -25,  10,   5,   5,  10, -25,  100],
  [ -25, -45,   1,   1,   1,   1, -45,  -25],
  [  10,   1,   3,   2,   2,   3,   1,   10],
  [   5,   1,   2,   1,   1,   2,   1,    5],
  [   5,   1,   2,   1,   1,   2,   1,    5],
  [  10,   1,   3,   2,   2,   3,   1,   10],
  [ -25, -45,   1,   1,   1,   1, -45,  -25],
  [ 100, -25,  10,   5,   5,  10, -25,  100]
];

class OthelloGame {
  constructor() {
    this.board = Array(8).fill(null).map(() => Array(8).fill(EMPTY));
    this.currentTurn = BLACK;
    this.history = [];
    this.lastMove = null;
    this.isGameOver = false;
    this.isProcessing = false;

    // ゲームモード: 'cpu-easy', 'cpu-normal', 'cpu-hard', 'pvp', 'online'
    this.mode = 'cpu-easy';
    this.humanColor = BLACK;
    this.showGuide = true;

    // オンライン対戦用プロパティ
    this.ws = null;
    this.onlineRoomId = null;
    this.onlineRole = null; // BLACK or WHITE
    this.isOnlineReady = false;

    this.initElements();
    this.bindEvents();
    this.startNewGame();
  }

  initElements() {
    this.boardEl = document.getElementById('board');
    this.scoreBlackEl = document.getElementById('score-black');
    this.scoreWhiteEl = document.getElementById('score-white');
    this.nameBlackEl = document.getElementById('name-black');
    this.nameWhiteEl = document.getElementById('name-white');
    this.cardBlackEl = document.getElementById('player-black-card');
    this.cardWhiteEl = document.getElementById('player-white-card');
    this.turnTextEl = document.getElementById('turn-text');
    this.messageBannerEl = document.getElementById('message-banner');
    this.btnUndoEl = document.getElementById('btn-undo');
    this.btnRestartEl = document.getElementById('btn-restart');
    this.modeSelectEl = document.getElementById('mode-select');
    this.cpuColorGroupEl = document.getElementById('cpu-color-group');
    this.cpuColorSelectEl = document.getElementById('cpu-color-select');
    this.guideToggleEl = document.getElementById('guide-toggle');

    // オンラインUI
    this.connectionBadgeEl = document.getElementById('connection-badge');
    this.connectionTextEl = document.getElementById('connection-text');
    this.onlineBarEl = document.getElementById('online-bar');
    this.displayRoomIdEl = document.getElementById('display-room-id');
    this.displayRoleInfoEl = document.getElementById('display-role-info');
    this.btnCopyRoomEl = document.getElementById('btn-copy-room');
    this.chatBarEl = document.getElementById('chat-bar');

    // モーダル
    this.onlineModalEl = document.getElementById('online-modal');
    this.hostColorChoiceEl = document.getElementById('host-color-choice');
    this.btnCreateRoomEl = document.getElementById('btn-create-room');
    this.btnJoinRoomEl = document.getElementById('btn-join-room');
    this.inputRoomIdEl = document.getElementById('input-room-id');
    this.btnCancelOnlineEl = document.getElementById('btn-cancel-online');

    this.waitingModalEl = document.getElementById('waiting-modal');
    this.waitingRoomIdEl = document.getElementById('waiting-room-id');
    this.btnCancelWaitingEl = document.getElementById('btn-cancel-waiting');

    this.resultModalEl = document.getElementById('result-modal');
    this.modalWinnerEl = document.getElementById('modal-winner');
    this.modalScoreEl = document.getElementById('modal-score');
    this.modalBtnRestartEl = document.getElementById('modal-btn-restart');
    this.modalBtnCloseEl = document.getElementById('modal-btn-close');

    // 相手退出モーダル
    this.opponentLeftModalEl = document.getElementById('opponent-left-modal');
    this.btnResumeCpuEl = document.getElementById('btn-resume-cpu');
    this.btnNewCpuEl = document.getElementById('btn-new-cpu');

    // 盤面グリッド生成 (8x8)
    this.boardEl.innerHTML = '';
    this.cellElements = [];
    for (let r = 0; r < 8; r++) {
      this.cellElements[r] = [];
      for (let c = 0; c < 8; c++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.dataset.row = r;
        cell.dataset.col = c;

        cell.addEventListener('click', () => this.handleCellClick(r, c));
        this.boardEl.appendChild(cell);
        this.cellElements[r][c] = cell;
      }
    }
  }

  bindEvents() {
    this.btnRestartEl.addEventListener('click', () => this.requestRestart());
    this.modalBtnRestartEl.addEventListener('click', () => {
      this.closeModal(this.resultModalEl);
      this.requestRestart();
    });
    this.modalBtnCloseEl.addEventListener('click', () => this.closeModal(this.resultModalEl));
    this.btnUndoEl.addEventListener('click', () => this.undo());

    this.modeSelectEl.addEventListener('change', (e) => {
      const prevMode = this.mode;
      this.mode = e.target.value;

      if (this.mode === 'online') {
        this.openModal(this.onlineModalEl);
      } else {
        if (prevMode === 'online') {
          this.disconnectOnline();
        }
        this.updateModeUI();
        this.startNewGame();
      }
    });

    this.cpuColorSelectEl.addEventListener('change', (e) => {
      this.humanColor = parseInt(e.target.value, 10);
      this.updateModeUI();
      this.startNewGame();
    });

    this.guideToggleEl.addEventListener('change', (e) => {
      this.showGuide = e.target.checked;
      this.renderBoard();
    });

    // オンラインモーダルイベント
    this.btnCreateRoomEl.addEventListener('click', () => this.initiateOnline('create'));
    this.btnJoinRoomEl.addEventListener('click', () => {
      const roomId = this.inputRoomIdEl.value.trim();
      if (!roomId) {
        alert('部屋番号を入力してください');
        return;
      }
      this.initiateOnline('join', roomId);
    });

    // 部屋番号入力欄でEnterキーを押した時に「参加」ボタンを実行
    this.inputRoomIdEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.btnJoinRoomEl.click();
      }
    });

    this.btnCancelOnlineEl.addEventListener('click', () => {
      this.closeModal(this.onlineModalEl);
      this.mode = 'cpu-easy';
      this.modeSelectEl.value = 'cpu-easy';
      this.updateModeUI();
    });

    this.btnCancelWaitingEl.addEventListener('click', () => {
      this.disconnectOnline();
      this.closeModal(this.waitingModalEl);
      this.mode = 'cpu-easy';
      this.modeSelectEl.value = 'cpu-easy';
      this.updateModeUI();
      this.startNewGame();
    });

    // 相手退出モーダルのボタンイベント
    this.btnResumeCpuEl.addEventListener('click', () => this.resumeWithCpu());
    this.btnNewCpuEl.addEventListener('click', () => this.switchToCpu(true));

    this.btnCopyRoomEl.addEventListener('click', () => {
      if (this.onlineRoomId) {
        navigator.clipboard.writeText(this.onlineRoomId).then(() => {
          this.btnCopyRoomEl.textContent = '済！';
          setTimeout(() => { this.btnCopyRoomEl.textContent = 'コピー'; }, 1500);
        });
      }
    });

    // クイックチャットボタン
    document.querySelectorAll('.btn-chat').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.dataset.chat;
        this.sendChatMessage(text);
      });
    });
  }

  updateModeUI() {
    if (this.mode === 'online') {
      this.cpuColorGroupEl.style.display = 'none';
      this.btnUndoEl.style.display = 'none'; // オンライン時は待った禁止
      this.onlineBarEl.classList.remove('hidden');
      this.chatBarEl.classList.remove('hidden');
    } else {
      this.onlineBarEl.classList.add('hidden');
      this.chatBarEl.classList.add('hidden');
      this.btnUndoEl.style.display = 'inline-flex';

      if (this.mode === 'pvp') {
        this.cpuColorGroupEl.style.display = 'none';
        this.nameBlackEl.textContent = '黒 (プレイヤー1)';
        this.nameWhiteEl.textContent = '白 (プレイヤー2)';
      } else {
        this.cpuColorGroupEl.style.display = 'block';
        const diffText = this.mode === 'cpu-easy' ? '初級' : (this.mode === 'cpu-normal' ? '中級' : '上級');
        if (this.humanColor === BLACK) {
          this.nameBlackEl.textContent = '黒 (あなた)';
          this.nameWhiteEl.textContent = `白 (CPU ${diffText})`;
        } else {
          this.nameBlackEl.textContent = `黒 (CPU ${diffText})`;
          this.nameWhiteEl.textContent = '白 (あなた)';
        }
      }
      this.setConnectionStatus('offline', 'ローカルモード');
    }
  }

  setConnectionStatus(status, text) {
    const dot = this.connectionBadgeEl.querySelector('.status-dot');
    dot.className = `status-dot ${status}`;
    this.connectionTextEl.textContent = text;
  }

  startNewGame() {
    this.board = Array(8).fill(null).map(() => Array(8).fill(EMPTY));
    // 初期4マス配置
    this.board[3][3] = WHITE;
    this.board[3][4] = BLACK;
    this.board[4][3] = BLACK;
    this.board[4][4] = WHITE;

    this.currentTurn = BLACK;
    this.history = [];
    this.lastMove = null;
    this.isGameOver = false;
    this.isProcessing = false;
    this.setMessage('');
    this.closeModal(this.resultModalEl);

    this.updateModeUI();
    this.renderBoard();

    if (this.mode !== 'online') {
      this.checkCpuTurn();
    }
  }

  saveHistory() {
    const boardCopy = this.board.map(row => [...row]);
    this.history.push({
      board: boardCopy,
      currentTurn: this.currentTurn,
      lastMove: this.lastMove ? { ...this.lastMove } : null
    });
  }

  undo() {
    if (this.mode === 'online') return;
    if (this.isProcessing || this.history.length === 0 || this.isGameOver) return;

    let stepsToUndo = (this.mode !== 'pvp' && this.history.length >= 2) ? 2 : 1;

    for (let i = 0; i < stepsToUndo; i++) {
      if (this.history.length > 0) {
        const prevState = this.history.pop();
        this.board = prevState.board;
        this.currentTurn = prevState.currentTurn;
        this.lastMove = prevState.lastMove;
      }
    }

    this.setMessage('1手戻しました');
    this.renderBoard();
    this.checkCpuTurn();
  }

  requestRestart() {
    if (this.mode === 'online') {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (confirm('相手に再戦（最初からやり直す）をリクエストしますか？')) {
          this.ws.send(JSON.stringify({ type: 'RESTART_REQUEST' }));
          this.setMessage('相手に再戦リクエストを送信しました...');
        }
      }
    } else {
      this.startNewGame();
    }
  }

  setMessage(msg) {
    this.messageBannerEl.textContent = msg;
  }

  renderBoard() {
    const counts = this.countPieces();
    this.scoreBlackEl.textContent = counts.black;
    this.scoreWhiteEl.textContent = counts.white;

    // 手番表示
    if (this.currentTurn === BLACK) {
      this.cardBlackEl.classList.add('active');
      this.cardWhiteEl.classList.remove('active');
      this.turnTextEl.textContent = '黒の手番';
    } else {
      this.cardWhiteEl.classList.add('active');
      this.cardBlackEl.classList.remove('active');
      this.turnTextEl.textContent = '白の手番';
    }

    // オンライン対戦時のメッセージ補足
    if (this.mode === 'online' && this.isOnlineReady) {
      const isMyTurn = this.currentTurn === this.onlineRole;
      if (isMyTurn) {
        this.turnTextEl.textContent += ' (あなたの番！)';
      } else {
        this.turnTextEl.textContent += ' (相手の番...)';
      }
    }

    this.btnUndoEl.disabled = this.history.length === 0 || this.isProcessing || this.isGameOver || this.mode === 'online';

    // 合法手の取得
    const validMoves = this.getValidMoves(this.board, this.currentTurn);

    const canCurrentPlayerMove = () => {
      if (this.mode === 'online') {
        return this.isOnlineReady && this.currentTurn === this.onlineRole;
      }
      return !this.isCpuTurn();
    };

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = this.cellElements[r][c];
        cell.classList.remove('valid-move');

        const piece = this.board[r][c];
        let discContainer = cell.querySelector('.disc-container');

        if (piece === EMPTY) {
          if (discContainer) {
            cell.removeChild(discContainer);
          }
          const isValid = validMoves.some(m => m.row === r && m.col === c);
          if (isValid && this.showGuide && canCurrentPlayerMove()) {
            cell.classList.add('valid-move');
          }
        } else {
          if (!discContainer) {
            discContainer = document.createElement('div');
            discContainer.classList.add('disc-container');
            const disc = document.createElement('div');
            disc.classList.add('disc');
            disc.innerHTML = `
              <div class="disc-front"></div>
              <div class="disc-back"></div>
            `;
            discContainer.appendChild(disc);
            cell.appendChild(discContainer);
          }

          const disc = discContainer.querySelector('.disc');
          if (piece === BLACK) {
            disc.classList.add('black');
            disc.classList.remove('white');
          } else {
            disc.classList.add('white');
            disc.classList.remove('black');
          }

          if (this.lastMove && this.lastMove.row === r && this.lastMove.col === c) {
            disc.classList.add('last-move');
          } else {
            disc.classList.remove('last-move');
          }
        }
      }
    }
  }

  isCpuTurn() {
    if (this.mode === 'pvp' || this.mode === 'online') return false;
    return this.currentTurn !== this.humanColor;
  }

  async handleCellClick(r, c) {
    if (this.isGameOver || this.isProcessing) return;

    if (this.mode === 'online') {
      if (!this.isOnlineReady) return;
      if (this.currentTurn !== this.onlineRole) {
        this.setMessage('相手の手番です。少しお待ちください。');
        return;
      }
    } else if (this.isCpuTurn()) {
      return;
    }

    const validMoves = this.getValidMoves(this.board, this.currentTurn);
    const targetMove = validMoves.find(m => m.row === r && m.col === c);

    if (!targetMove) return;

    // オンライン対戦時は相手に手を送信
    if (this.mode === 'online') {
      this.sendMove(targetMove);
    }

    await this.executeMove(targetMove);
  }

  async executeMove(move) {
    this.isProcessing = true;
    this.saveHistory();

    const { row, col, flipped } = move;
    this.board[row][col] = this.currentTurn;
    this.lastMove = { row, col };

    this.renderBoard();
    await new Promise(res => setTimeout(res, 120));

    for (const [fr, fc] of flipped) {
      this.board[fr][fc] = this.currentTurn;
    }
    this.renderBoard();
    await new Promise(res => setTimeout(res, 350));

    this.switchTurn();
  }

  switchTurn() {
    const opponent = this.currentTurn === BLACK ? WHITE : BLACK;
    const opponentMoves = this.getValidMoves(this.board, opponent);
    const currentMoves = this.getValidMoves(this.board, this.currentTurn);

    if (opponentMoves.length > 0) {
      this.currentTurn = opponent;
      this.setMessage('');
    } else if (currentMoves.length > 0) {
      const passPlayer = opponent === BLACK ? '黒' : '白';
      this.setMessage(`${passPlayer}は置ける場所がないためパスしました。`);
      if (this.mode === 'online' && this.onlineRole === opponent) {
        this.sendPass(opponent);
      }
    } else {
      this.endGame();
      this.isProcessing = false;
      return;
    }

    this.renderBoard();
    this.isProcessing = false;

    if (this.mode !== 'online') {
      this.checkCpuTurn();
    }
  }

  checkCpuTurn() {
    if (this.isGameOver || !this.isCpuTurn()) return;

    this.isProcessing = true;
    const delay = 600 + Math.random() * 400;
    setTimeout(() => {
      if (this.isGameOver) return;
      const moves = this.getValidMoves(this.board, this.currentTurn);
      if (moves.length === 0) {
        this.switchTurn();
        return;
      }
      const chosenMove = this.selectCpuMove(moves);
      this.executeMove(chosenMove);
    }, delay);
  }

  selectCpuMove(moves) {
    if (this.mode === 'cpu-easy') {
      if (Math.random() < 0.4) {
        return moves[Math.floor(Math.random() * moves.length)];
      }
      moves.sort((a, b) => b.flipped.length - a.flipped.length);
      return moves[0];
    } else if (this.mode === 'cpu-normal') {
      moves.sort((a, b) => {
        const scoreA = WEIGHT_TABLE[a.row][a.col] + a.flipped.length * 2;
        const scoreB = WEIGHT_TABLE[b.row][b.col] + b.flipped.length * 2;
        return scoreB - scoreA;
      });
      return moves[0];
    } else {
      let bestScore = -Infinity;
      let bestMove = moves[0];

      for (const move of moves) {
        const simulatedBoard = this.board.map(r => [...r]);
        simulatedBoard[move.row][move.col] = this.currentTurn;
        for (const [fr, fc] of move.flipped) {
          simulatedBoard[fr][fc] = this.currentTurn;
        }

        let score = WEIGHT_TABLE[move.row][move.col] * 3;
        const opp = this.currentTurn === BLACK ? WHITE : BLACK;
        const oppMoves = this.getValidMoves(simulatedBoard, opp);
        score -= oppMoves.length * 5;
        score += move.flipped.length * 2;

        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
      }
      return bestMove;
    }
  }

  getValidMoves(board, player) {
    const opponent = player === BLACK ? WHITE : BLACK;
    const validMoves = [];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] !== EMPTY) continue;

        const flippedStones = [];

        for (const [dr, dc] of DIRECTIONS) {
          let nr = r + dr;
          let nc = c + dc;
          const stonesInLine = [];

          while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === opponent) {
            stonesInLine.push([nr, nc]);
            nr += dr;
            nc += dc;
          }

          if (stonesInLine.length > 0 && nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === player) {
            flippedStones.push(...stonesInLine);
          }
        }

        if (flippedStones.length > 0) {
          validMoves.push({
            row: r,
            col: c,
            flipped: flippedStones
          });
        }
      }
    }
    return validMoves;
  }

  countPieces() {
    let black = 0;
    let white = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.board[r][c] === BLACK) black++;
        else if (this.board[r][c] === WHITE) white++;
      }
    }
    return { black, white };
  }

  endGame() {
    this.isGameOver = true;
    const counts = this.countPieces();

    let winnerText = '';
    if (counts.black > counts.white) {
      winnerText = '黒 (Black) の勝利！';
    } else if (counts.white > counts.black) {
      winnerText = '白 (White) の勝利！';
    } else {
      winnerText = '引き分け (Draw)';
    }

    if (this.mode === 'online') {
      if (counts.black === counts.white) {
        winnerText = '引き分け！';
      } else {
        const isWinner = (counts.black > counts.white && this.onlineRole === BLACK) ||
                         (counts.white > counts.black && this.onlineRole === WHITE);
        winnerText = isWinner ? '🎉 あなたの勝利！' : '敗北... 次は勝ちましょう！';
      }
    }

    this.modalWinnerEl.textContent = winnerText;
    this.modalScoreEl.innerHTML = `
      <div>黒: <strong>${counts.black}</strong> 枚</div>
      <div>白: <strong>${counts.white}</strong> 枚</div>
    `;
    this.openModal(this.resultModalEl);
    this.setMessage('対局が終了しました');
  }

  openModal(modal) {
    modal.classList.add('show');
  }

  closeModal(modal) {
    modal.classList.remove('show');
  }

  /* ============================================================
     オンライン (WebSocket) 対戦実装
  ============================================================ */
  initiateOnline(action, roomId = null) {
    this.closeModal(this.onlineModalEl);

    // WebSocket URLの解決
    let wsUrl;
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}`;
    } else {
      // file:/// で開いた場合のフォールバック
      wsUrl = 'ws://localhost:3000';
    }

    this.setConnectionStatus('waiting', 'サーバー接続中...');
    this.setMessage('サーバーに接続しています...');

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (e) {
      alert('WebSocketサーバーに接続できませんでした。\n`node server.js` が起動しているか確認してください。');
      this.mode = 'cpu-easy';
      this.modeSelectEl.value = 'cpu-easy';
      this.updateModeUI();
      return;
    }

    this.ws.onopen = () => {
      if (action === 'create') {
        const hostChoice = this.hostColorChoiceEl ? this.hostColorChoiceEl.value : 'black';
        this.ws.send(JSON.stringify({ type: 'CREATE_ROOM', hostChoice }));
      } else {
        this.ws.send(JSON.stringify({ type: 'JOIN_ROOM', roomId }));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleServerMessage(data);
      } catch (e) {
        console.error('Error handling WebSocket message:', e);
      }
    };

    this.ws.onerror = () => {
      alert('サーバーとの通信エラーが発生しました。\nターミナルで `node server.js` を実行してサーバーを起動してください。');
      this.disconnectOnline();
    };

    this.ws.onclose = () => {
      if (this.mode === 'online') {
        this.setConnectionStatus('offline', '切断されました');
        if (this.isOnlineReady && !this.isGameOver) {
          this.isOnlineReady = false;
          this.openModal(this.opponentLeftModalEl);
        }
        this.isOnlineReady = false;
      }
    };
  }

  handleServerMessage(data) {
    switch (data.type) {
      case 'ROOM_CREATED': {
        this.onlineRoomId = data.roomId;
        this.waitingRoomIdEl.textContent = data.roomId;
        this.displayRoomIdEl.textContent = data.roomId;
        let choiceText = '黒 (先手)';
        if (data.hostChoice === 'white') choiceText = '白 (後手)';
        if (data.hostChoice === 'random') choiceText = '🎲 ランダム (開始時に決定)';
        this.displayRoleInfoEl.textContent = `あなたの希望: ${choiceText}`;
        this.setConnectionStatus('waiting', `部屋番号: ${data.roomId} (待機中)`);
        this.openModal(this.waitingModalEl);
        break;
      }

      case 'GAME_START': {
        this.closeModal(this.waitingModalEl);
        this.onlineRoomId = data.roomId;
        this.isOnlineReady = true;

        if (data.role === 'white') {
          this.onlineRole = WHITE;
          this.displayRoleInfoEl.textContent = 'あなたの色: 白 (後手)';
          this.nameBlackEl.textContent = '黒 (対戦相手)';
          this.nameWhiteEl.textContent = '白 (あなた)';
        } else {
          this.onlineRole = BLACK;
          this.displayRoleInfoEl.textContent = 'あなたの色: 黒 (先手)';
          this.nameBlackEl.textContent = '黒 (あなた)';
          this.nameWhiteEl.textContent = '白 (対戦相手)';
        }

        this.displayRoomIdEl.textContent = data.roomId;
        this.setConnectionStatus('online', `対戦中 (部屋: ${data.roomId})`);
        this.setMessage(data.message || '対局を開始しました！');

        this.startNewGame();
        break;
      }

      case 'OPPONENT_MOVE': {
        // 相手の着手を受信
        if (data.move) {
          this.executeMove(data.move);
        }
        break;
      }

      case 'OPPONENT_PASS': {
        this.setMessage('相手は置ける場所がないためパスしました。あなたの手番です！');
        this.renderBoard();
        break;
      }

      case 'RESTART_REQUEST': {
        if (confirm('相手から再戦（リスタート）の申し込みがありました。受けますか？')) {
          this.ws.send(JSON.stringify({ type: 'RESTART_AGREE' }));
          this.startNewGame();
        }
        break;
      }

      case 'RESTART_START': {
        if (data.role) {
          if (data.role === 'white') {
            this.onlineRole = WHITE;
            this.displayRoleInfoEl.textContent = 'あなたの色: 白 (後手)';
            this.nameBlackEl.textContent = '黒 (対戦相手)';
            this.nameWhiteEl.textContent = '白 (あなた)';
          } else {
            this.onlineRole = BLACK;
            this.displayRoleInfoEl.textContent = 'あなたの色: 黒 (先手)';
            this.nameBlackEl.textContent = '黒 (あなた)';
            this.nameWhiteEl.textContent = '白 (対戦相手)';
          }
        }
        this.setMessage(data.message || '再戦が開始されました！');
        this.startNewGame();
        break;
      }

      case 'CHAT_MESSAGE': {
        this.setMessage(`相手💬「${data.text}」`);
        break;
      }

      case 'OPPONENT_LEFT': {
        this.isOnlineReady = false;
        this.setConnectionStatus('offline', '相手が退出しました');
        this.setMessage('対戦相手が退出しました。');
        // alertの代わりに専用モーダルを表示
        this.openModal(this.opponentLeftModalEl);
        break;
      }

      case 'ERROR': {
        alert(`【エラー】${data.message}`);
        this.disconnectOnline();
        this.mode = 'cpu-easy';
        this.modeSelectEl.value = 'cpu-easy';
        this.updateModeUI();
        break;
      }
    }
  }

  resumeWithCpu() {
    this.closeModal(this.opponentLeftModalEl);
    const myRole = this.onlineRole || BLACK;
    this.disconnectOnline();

    // CPUモードに切り替え（自分の手番・色を維持）
    this.mode = 'cpu-easy';
    this.modeSelectEl.value = 'cpu-easy';
    this.humanColor = myRole;
    this.cpuColorSelectEl.value = myRole.toString();
    this.updateModeUI();

    this.setMessage('🤖 CPU対戦に切り替えました！ゲームを続行します。');
    this.renderBoard();

    // もし相手（CPU側）の手番なら、即座にCPUに思考・着手させる
    if (this.currentTurn !== this.humanColor && !this.isGameOver) {
      this.checkCpuTurn();
    }
  }

  switchToCpu(startNew = false) {
    this.closeModal(this.opponentLeftModalEl);
    this.disconnectOnline();
    this.mode = 'cpu-easy';
    this.modeSelectEl.value = 'cpu-easy';
    this.updateModeUI();

    if (startNew) {
      this.startNewGame();
      this.setMessage('CPU対戦（初級）を開始しました。');
    }
  }

  sendMove(move) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'MOVE',
        move: {
          row: move.row,
          col: move.col,
          flipped: move.flipped
        }
      }));
    }
  }

  sendPass(player) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'PASS',
        player
      }));
    }
  }

  sendChatMessage(text) {
    if (this.mode !== 'online' || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'CHAT',
      text
    }));
    this.setMessage(`あなた💬「${text}」`);
  }

  disconnectOnline() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.onlineRoomId = null;
    this.isOnlineReady = false;
    this.setConnectionStatus('offline', 'ローカルモード');
  }
}

// ゲーム起動
document.addEventListener('DOMContentLoaded', () => {
  new OthelloGame();
});

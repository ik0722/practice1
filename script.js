/**
 * オセロゲーム (Reversi) コアスクリプト
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

// マスの位置による重要度テーブル（AI用重み付け）
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

    // 設定
    this.mode = 'cpu-easy'; // 'pvp', 'cpu-easy', 'cpu-normal', 'cpu-hard'
    this.humanColor = BLACK;
    this.showGuide = true;

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
    this.cpuColorSelectEl = document.getElementById('cpu-color-select');
    this.guideToggleEl = document.getElementById('guide-toggle');

    this.modalOverlayEl = document.getElementById('result-modal');
    this.modalWinnerEl = document.getElementById('modal-winner');
    this.modalScoreEl = document.getElementById('modal-score');
    this.modalBtnRestartEl = document.getElementById('modal-btn-restart');
    this.modalBtnCloseEl = document.getElementById('modal-btn-close');

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

        // 星（星印ドット：(2,2), (2,6), (6,2), (6,6) の角）
        if ((r === 2 || r === 6) && (c === 2 || c === 6)) {
          const dot = document.createElement('div');
          dot.classList.add('star-dot');
          cell.appendChild(dot);
        }

        cell.addEventListener('click', () => this.handleCellClick(r, c));
        this.boardEl.appendChild(cell);
        this.cellElements[r][c] = cell;
      }
    }
  }

  bindEvents() {
    this.btnRestartEl.addEventListener('click', () => this.startNewGame());
    this.modalBtnRestartEl.addEventListener('click', () => {
      this.closeModal();
      this.startNewGame();
    });
    this.modalBtnCloseEl.addEventListener('click', () => this.closeModal());
    this.btnUndoEl.addEventListener('click', () => this.undo());

    this.modeSelectEl.addEventListener('change', (e) => {
      this.mode = e.target.value;
      this.updatePlayerLabels();
      this.startNewGame();
    });

    this.cpuColorSelectEl.addEventListener('change', (e) => {
      this.humanColor = parseInt(e.target.value, 10);
      this.updatePlayerLabels();
      this.startNewGame();
    });

    this.guideToggleEl.addEventListener('change', (e) => {
      this.showGuide = e.target.checked;
      this.renderBoard();
    });
  }

  updatePlayerLabels() {
    if (this.mode === 'pvp') {
      this.nameBlackEl.textContent = '黒 (プレイヤー1)';
      this.nameWhiteEl.textContent = '白 (プレイヤー2)';
      this.cpuColorSelectEl.disabled = true;
    } else {
      this.cpuColorSelectEl.disabled = false;
      const diffText = this.mode === 'cpu-easy' ? '初級' : (this.mode === 'cpu-normal' ? '中級' : '上級');
      if (this.humanColor === BLACK) {
        this.nameBlackEl.textContent = '黒 (あなた)';
        this.nameWhiteEl.textContent = `白 (CPU ${diffText})`;
      } else {
        this.nameBlackEl.textContent = `黒 (CPU ${diffText})`;
        this.nameWhiteEl.textContent = '白 (あなた)';
      }
    }
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
    this.closeModal();

    this.updatePlayerLabels();
    this.renderBoard();
    this.checkCpuTurn();
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
    if (this.isProcessing || this.history.length === 0 || this.isGameOver) return;

    // CPU対戦時は自分の手番まで2手戻す、または1手
    let stepsToUndo = 1;
    if (this.mode !== 'pvp') {
      if (this.history.length >= 2) {
        stepsToUndo = 2;
      } else {
        stepsToUndo = 1;
      }
    }

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

    // 待ったボタンの活性非活性
    this.btnUndoEl.disabled = this.history.length === 0 || this.isProcessing || this.isGameOver;

    // 合法手の取得
    const validMoves = this.getValidMoves(this.board, this.currentTurn);

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
          // ガイド表示（人間の手番かつ表示ONのとき）
          const isValid = validMoves.some(m => m.row === r && m.col === c);
          if (isValid && this.showGuide && !this.isCpuTurn()) {
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

          // 着手位置マーカー
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
    if (this.mode === 'pvp') return false;
    return this.currentTurn !== this.humanColor;
  }

  async handleCellClick(r, c) {
    if (this.isGameOver || this.isProcessing) return;
    if (this.isCpuTurn()) return;

    const validMoves = this.getValidMoves(this.board, this.currentTurn);
    const targetMove = validMoves.find(m => m.row === r && m.col === c);

    if (!targetMove) return;

    await this.executeMove(targetMove);
  }

  async executeMove(move) {
    this.isProcessing = true;
    this.saveHistory();

    const { row, col, flipped } = move;
    this.board[row][col] = this.currentTurn;
    this.lastMove = { row, col };

    // 盤面更新（置いた石の表示）
    this.renderBoard();

    // 反転アニメーションを少し待って実行
    await new Promise(res => setTimeout(res, 120));

    // 挟んだ石を反転
    for (const [fr, fc] of flipped) {
      this.board[fr][fc] = this.currentTurn;
    }
    this.renderBoard();

    // アニメーション完了待ち
    await new Promise(res => setTimeout(res, 350));

    // 手番交代
    this.switchTurn();
  }

  switchTurn() {
    const opponent = this.currentTurn === BLACK ? WHITE : BLACK;
    const opponentMoves = this.getValidMoves(this.board, opponent);
    const currentMoves = this.getValidMoves(this.board, this.currentTurn);

    if (opponentMoves.length > 0) {
      // 相手に合法手がある場合、通常通り手番交代
      this.currentTurn = opponent;
      this.setMessage('');
    } else if (currentMoves.length > 0) {
      // 相手に合法手がないが、自分にはまだある場合 -> パス
      const passPlayer = opponent === BLACK ? '黒' : '白';
      this.setMessage(`${passPlayer}は置ける場所がないためパスしました。`);
      // 手番はそのまま維持
    } else {
      // 両者ともに置く場所がない -> 終局
      this.endGame();
      this.isProcessing = false;
      return;
    }

    this.renderBoard();
    this.isProcessing = false;

    // CPU手番チェック
    this.checkCpuTurn();
  }

  checkCpuTurn() {
    if (this.isGameOver || !this.isCpuTurn()) return;

    this.isProcessing = true;
    const delay = 600 + Math.random() * 400; // 思考時間演出
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
      // 初級: ランダムまたは取れる枚数多め
      if (Math.random() < 0.4) {
        return moves[Math.floor(Math.random() * moves.length)];
      }
      moves.sort((a, b) => b.flipped.length - a.flipped.length);
      return moves[0];
    } else if (this.mode === 'cpu-normal') {
      // 中級: 重み付けテーブル重視
      moves.sort((a, b) => {
        const scoreA = WEIGHT_TABLE[a.row][a.col] + a.flipped.length * 2;
        const scoreB = WEIGHT_TABLE[b.row][b.col] + b.flipped.length * 2;
        return scoreB - scoreA;
      });
      return moves[0];
    } else {
      // 上級: 角確保・危険マスの回避・開放度最小化（相手の次手数を減らす）
      let bestScore = -Infinity;
      let bestMove = moves[0];

      for (const move of moves) {
        // 仮配置
        const simulatedBoard = this.board.map(r => [...r]);
        simulatedBoard[move.row][move.col] = this.currentTurn;
        for (const [fr, fc] of move.flipped) {
          simulatedBoard[fr][fc] = this.currentTurn;
        }

        // 評価値計算
        let score = WEIGHT_TABLE[move.row][move.col] * 3;
        // 相手の着手可能数（モビリティ）が少ないほど自陣有利
        const opp = this.currentTurn === BLACK ? WHITE : BLACK;
        const oppMoves = this.getValidMoves(simulatedBoard, opp);
        score -= oppMoves.length * 5;

        // 獲得枚数
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

    this.modalWinnerEl.textContent = winnerText;
    this.modalScoreEl.innerHTML = `
      <div>黒: <strong>${counts.black}</strong> 枚</div>
      <div>白: <strong>${counts.white}</strong> 枚</div>
    `;
    this.showModal();
    this.setMessage('対局が終了しました');
  }

  showModal() {
    this.modalOverlayEl.classList.add('show');
  }

  closeModal() {
    this.modalOverlayEl.classList.remove('show');
  }
}

// ゲーム起動
document.addEventListener('DOMContentLoaded', () => {
  new OthelloGame();
});

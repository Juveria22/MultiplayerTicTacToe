const ws = new WebSocket(
  window.location.hostname === 'localhost'
    ? 'ws://localhost:8080'
    : 'wss://multiplayertictactoe-xwzj.onrender.com'
);

ws.onopen = () => console.log("WebSocket connected!");
ws.onerror = (err) => console.error("WebSocket error:", err);
ws.onclose = () => console.log("WebSocket closed");

let symbol = '';
const gameDiv = document.getElementById('game');
const status = document.getElementById('status');
const messagesDiv = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const winnerLineDiv = document.getElementById('winner-line');
const cellSize = 100;
const gap = 10;

// --- Create 3x3 board ---
for (let r = 0; r < 3; r++) {
  for (let c = 0; c < 3; c++) {
    const cell = document.createElement('div');
    cell.classList.add('cell');
    cell.dataset.row = r;
    cell.dataset.col = c;
    gameDiv.appendChild(cell);

    cell.addEventListener('click', () => {
      ws.send(JSON.stringify({ type: 'move', row: r, col: c }));
    });
  }
}

// --- Send chat ---
function sendChat() {
  const msg = input.value.trim();
  if (!msg) return;
  ws.send(JSON.stringify({ type: 'chat', message: msg }));
  input.value = '';
}
sendBtn.addEventListener('click', sendChat);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

// --- Winning line helper ---
function drawWinningLine(winningLine) {
  winnerLineDiv.style.width = '0';
  if (!winningLine || winningLine.length === 0) return;

  const grid = document.getElementById('game');
  const padding = parseInt(window.getComputedStyle(grid).padding);

  const rows = winningLine.map(([r, c]) => r);
  const cols = winningLine.map(([r, c]) => c);

  let startX, startY, endX, endY;

  if (rows.every(r => r === rows[0])) {
    // Horizontal
    const r = rows[0];
    startX = padding;
    endX = padding + 3 * (cellSize + gap) - gap;
    startY = endY = padding + r * (cellSize + gap) + cellSize / 2;
  } else if (cols.every(c => c === cols[0])) {
    // Vertical
    const c = cols[0];
    startY = padding;
    endY = padding + 3 * (cellSize + gap) - gap;
    startX = endX = padding + c * (cellSize + gap) + cellSize / 2;
  } else {
    // Diagonal
    if (rows[0] === cols[0]) {
      startX = padding + cellSize / 2;
      startY = padding + cellSize / 2;
      endX = padding + 2 * (cellSize + gap) + cellSize / 2;
      endY = padding + 2 * (cellSize + gap) + cellSize / 2;
    } else {
      startX = padding + 2 * (cellSize + gap) + cellSize / 2;
      startY = padding + cellSize / 2;
      endX = padding + cellSize / 2;
      endY = padding + 2 * (cellSize + gap) + cellSize / 2;
    }
  }

  const length = Math.hypot(endX - startX, endY - startY);
  const angle = Math.atan2(endY - startY, endX - startX) * (180 / Math.PI);

  winnerLineDiv.style.width = `${length}px`;
  winnerLineDiv.style.top = `${startY}px`;
  winnerLineDiv.style.left = `${startX}px`;
  winnerLineDiv.style.transform = `rotate(${angle}deg)`;
}

// --- WebSocket message handler ---
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'init') {
    symbol = data.symbol;
    status.innerHTML = `You are Player <strong>${symbol}</strong><br>Current turn: ${data.currentTurn || 'X'}`;
  }

  if (data.type === 'update') {
    // Update board
    data.board.forEach((row, r) => {
      row.forEach((val, c) => {
        const cell = document.querySelector(`.cell[data-row='${r}'][data-col='${c}']`);
        cell.textContent = val ? val.toUpperCase() : '';
        cell.classList.remove('X', 'O');
        if (val) cell.classList.add(val.toUpperCase());
      });
    });

    drawWinningLine(data.winningLine);

    // Update status text
    if (data.winner) {
      status.innerHTML = data.winner === 'Draw'
        ? "It's a Draw!"
        : `Player ${data.winner} Wins!`;
    } else {
      status.innerHTML = `You are Player <strong>${symbol}</strong><br>Current turn: ${data.currentTurn}`;
    }
  }

  // --- Chat messages ---
  if (data.type === 'chat') {
    const div = document.createElement('div');
    div.classList.add(data.player || 'system');
    div.textContent = `${data.player}: ${data.message}`;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  if (data.type === 'message') {
    const div = document.createElement('div');
    div.classList.add('system');
    div.textContent = data.message;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  if (data.type === 'error') {
    alert(data.message);
  }
};

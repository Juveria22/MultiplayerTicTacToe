const ws = new WebSocket(
    window.location.hostname === 'localhost'
        ? 'ws://localhost:8080'
        : 'wss://multiplayertictactoe-xwzj.onrender.com'
);

// Debugging
ws.onopen = () => console.log("WebSocket connected!");
ws.onerror = (err) => console.error("WebSocket error:", err);
ws.onclose = () => console.log("WebSocket closed");

let symbol = '';
let matched = false; // Track if player has been matched
const gameDiv = document.getElementById('game');
const status = document.getElementById('status');
const messagesDiv = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const winnerLineDiv = document.getElementById('winner-line');
const cellSize = 100;
const gap = 10;

// Hide the board initially
gameDiv.style.display = 'none';
winnerLineDiv.style.display = 'none';

// Create 3x3 board
for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.dataset.row = r;
        cell.dataset.col = c;
        gameDiv.appendChild(cell);

        cell.addEventListener('click', () => {
            if (!matched) return; // prevent moves before match
            ws.send(JSON.stringify({ type: 'move', row: r, col: c }));
        });
    }
}

// Send chat on button click or Enter key
function sendChat() {
    const msg = input.value.trim();
    if (!msg || !matched) return;
    ws.send(JSON.stringify({ type: 'chat', message: msg }));
    input.value = '';
}

sendBtn.addEventListener('click', sendChat);
input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
});

// ---------- Winning Line Function ----------
function drawWinningLine(winningLine) {
    winnerLineDiv.style.width = '0'; // clear old line
    if (!winningLine || winningLine.length === 0) return;

    winnerLineDiv.style.display = 'block';

    const grid = document.getElementById('game');
    const padding = parseInt(window.getComputedStyle(grid).padding);

    const rows = winningLine.map(([r, c]) => r);
    const cols = winningLine.map(([r, c]) => c);

    let startX, startY, endX, endY;

    if (rows.every(r => r === rows[0])) {
        // Horizontal win
        const r = rows[0];
        startX = padding;
        endX = padding + 3 * (cellSize + gap) - gap;
        startY = endY = padding + r * (cellSize + gap) + cellSize / 2;
    } else if (cols.every(c => c === cols[0])) {
        // Vertical win
        const c = cols[0];
        startY = padding;
        endY = padding + 3 * (cellSize + gap) - gap;
        startX = endX = padding + c * (cellSize + gap) + cellSize / 2;
    } else {
        // Diagonal win
        if (rows[0] === cols[0]) {
            // Top-left to bottom-right
            startX = padding + cellSize / 2;
            startY = padding + cellSize / 2;
            endX = padding + 2 * (cellSize + gap) + cellSize / 2;
            endY = padding + 2 * (cellSize + gap) + cellSize / 2;
        } else {
            // Top-right to bottom-left
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

// ---------- WebSocket Message Handler ----------
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'init') {
        symbol = data.symbol;
        matched = true;

        // Show board now that player is matched
        gameDiv.style.display = 'grid';
        winnerLineDiv.style.display = 'block';

        status.innerHTML = `You are Player <strong>${symbol}</strong><br>Current turn: ${data.currentTurn || 'X'}`;
    }

    if (data.type === 'update') {
        data.board.forEach((row, r) => {
            row.forEach((val, c) => {
                const cell = document.querySelector(`.cell[data-row='${r}'][data-col='${c}']`);
                cell.textContent = val ? val.toUpperCase() : '';
                cell.classList.remove('X', 'O');
                if (val) cell.classList.add(val.toUpperCase());
            });
        });

        drawWinningLine(data.winningLine);

        status.innerHTML = `You are Player <strong>${symbol}</strong><br>Current turn: ${data.currentTurn}`;
    }

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
        div.innerHTML = data.message;
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    if (data.type === 'countdown') {
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
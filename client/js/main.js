const ws = new WebSocket(
    window.location.hostname === 'localhost'
        ? 'ws://localhost:8080'
        : 'wss://multiplayertictactoe-xwzj.onrender.com'
);

//debugging
ws.onopen = () => console.log("WebSocket connected!");
ws.onerror = (err) => console.error("WebSocket error:", err);
ws.onclose = () => console.log("WebSocket closed");

let symbol = '';
const gameDiv = document.getElementById('game');
const status = document.getElementById('status');
const messagesDiv = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');

// Create 3x3 board
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

sendBtn.addEventListener('click', () => {
    const msg = input.value;
    if (!msg) return;
    ws.send(JSON.stringify({ type: 'chat', message: msg }));
    input.value = '';
});

input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const msg = input.value;
        if (!msg) return;
        ws.send(JSON.stringify({ type: 'chat', message: msg }));
        input.value = '';
    }
});


ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'init') {
        symbol = data.symbol;
        status.textContent = `You are Player ${symbol}`;
    }

    if (data.type === 'update') {
        data.board.forEach((row, r) => {
            row.forEach((val, c) => {
                const cell = document.querySelector(`.cell[data-row='${r}'][data-col='${c}']`);
                cell.textContent = val ? val.toUpperCase() : '';
                cell.classList.remove('X', 'O'); // Remove old classes
                if (val && (val.toUpperCase() === 'X' || val.toUpperCase() === 'O')) {
                    cell.classList.add(val.toUpperCase());
                }
            });
        });

        // ---------- WINNING LINE ----------
        const winnerLineDiv = document.getElementById('winner-line');

        // Clear old line
        winnerLineDiv.style.width = '0';

        if (data.winningLine && data.winner && data.winner !== 'Draw') {
            const [[r1, c1], [r2, c2]] = data.winningLine;

            const cellSize = 100; // same as in CSS
            const gap = 10;       // same as grid-gap in CSS

            // Calculate position
            const startX = c1 * (cellSize + gap) + cellSize / 2;
            const startY = r1 * (cellSize + gap) + cellSize / 2;
            const endX = c2 * (cellSize + gap) + cellSize / 2;
            const endY = r2 * (cellSize + gap) + cellSize / 2;

            const length = Math.hypot(endX - startX, endY - startY);
            const angle = Math.atan2(endY - startY, endX - startX) * (180 / Math.PI);

            winnerLineDiv.style.width = length + 'px';
            winnerLineDiv.style.top = startY + 'px';
            winnerLineDiv.style.left = startX + 'px';
            winnerLineDiv.style.transform = `rotate(${angle}deg)`;
        }

        if (data.winner) {
            status.textContent = data.winner === 'Draw' ? "It's a Draw!" : `Player ${data.winner} Wins!`;
        } else {
            status.textContent = `Current turn: ${data.currentTurn}`;
        }
    }


    if (data.type === 'chat') {
        const div = document.createElement('div');
        const playerClass = data.player || 'system';
        div.classList.add(playerClass);
        div.textContent = `${data.player}: ${data.message}`;
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        console.log("Chat received:", data.player, data.message);
    }


    if (data.type === 'message') {
        const div = document.createElement('div');
        div.textContent = data.message; // system message
        div.classList.add('system');
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        console.log("System message:", data.message);
    }

    if (data.type === 'error') {
        alert(data.message);
    }
};
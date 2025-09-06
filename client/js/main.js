const ws = new WebSocket(
    window.location.hostname === 'localhost'
        ? 'ws://localhost:8080'
        : 'wss://multiplayertictactoe-xwzj.onrender.com'
);
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

        document.querySelectorAll('.cell').forEach(cell => cell.classList.remove('winning'));

        // Add winning class if there’s a winner
        if (data.winningLine && data.winner && data.winner !== 'Draw') {
            data.winningLine.forEach(([r, c]) => {
                const cell = document.querySelector(`.cell[data-row='${r}'][data-col='${c}']`);
                if (cell) cell.classList.add('winning');
            });
        }
        
        if (data.winner) {
            status.textContent = data.winner === 'Draw' ? "It's a Draw!" : `Player ${data.winner} Wins!`;
        } else {
            status.textContent = `Current turn: ${data.currentTurn}`;
        }
    }


    if (data.type === 'chat' || data.type === 'message') {
        const div = document.createElement('div');
        div.textContent = data.message;
        if (data.player === 'X' || data.player === 'O') {
            div.classList.add(data.player); // Add X or O class for color
        }
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }


    if (data.type === 'error') {
        alert(data.message);
    }
};

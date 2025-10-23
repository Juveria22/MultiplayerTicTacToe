//tictactoe.js
// tic tac toe elements
const gameDiv = document.getElementById('game');
const statuss = document.getElementById('status');
const winnerLineDiv = document.getElementById('winner-line');

let symbol = '';
let gameStarted = false;
let currentTurn = null;

const cellSize = 100;
const gap = 10;

// Build 3x3 board
for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.dataset.row = r;
        cell.dataset.col = c;
        gameDiv.appendChild(cell);

        //logging errors if user is unable to interact with grid
        cell.addEventListener('click', () => {
            if (!gameStarted) {
                console.log("Move blocked: game not started yet");
                return;
            }
            if (currentTurn !== symbol) {
                console.log("Move blocked: not your turn");
                return;
            }
            console.log("Sending move:", { row: r, col: c });
            ws.send(JSON.stringify({ game: 'tic-tac-toe', type: 'move', row: r, col: c }));
        });

    }
}

//draw winning line
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

// Handle messages from server
function handleTicTacToeMessage(data) {
    if (data.type === 'init') {
        symbol = data.symbol;
        gameStarted = true;
        gameDiv.style.display = 'grid'
        winnerLineDiv.style.display = 'block'
        currentTurn = data.currentTurn

        statuss.innerHTML = `You are Player <strong>${symbol}</strong><br>Current turn: ${data.currentTurn || 'X'}`;
    }


    if (data.type === 'update') {
        gameStarted = data.gameStarted;
        currentTurn = data.currentTurn; // ← this is key

        data.board.forEach((row, r) => {
            row.forEach((val, c) => {
                const cell = document.querySelector(`.cell[data-row='${r}'][data-col='${c}']`);
                cell.textContent = val || '';
                cell.classList.remove('X', 'O');
                if (val) cell.classList.add(val);
            });
        });

        // Draw winning line if present
        if (data.winner && data.winningLine && data.winningLine.length > 0) {
            drawWinningLine(data.winningLine);
        } else {
            winnerLineDiv.style.display = 'none'; // hide line if reset
        }


        // Update status
        if (data.winner) {
            statuss.innerHTML = data.winner === 'Draw'
                ? 'Draw!'
                : `Player ${data.winner} wins!`;
            gameStarted = false; // stop clicks after game ends
        } else {
            statuss.innerHTML = `You are Player <strong>${symbol}</strong><br>Current turn: ${currentTurn}`;
        }
    }


}

window.handleTicTacToeMessage = handleTicTacToeMessage;
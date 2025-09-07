const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
console.log(`Server running on ws://localhost:${PORT}`);

let xWins = 0;
let oWins = 0;

let players = [];
let board = [
  ['', '', ''],
  ['', '', ''],
  ['', '', '']
];
let currentTurn = 'X';
let nextSymbol = 'X'; // For assigning new connections

function checkWin() {
  const lines = [
    [[0,0],[0,1],[0,2]], [[1,0],[1,1],[1,2]], [[2,0],[2,1],[2,2]],
    [[0,0],[1,0],[2,0]], [[0,1],[1,1],[2,1]], [[0,2],[1,2],[2,2]],
    [[0,0],[1,1],[2,2]], [[0,2],[1,1],[2,0]]
  ];

  for (const line of lines) {
    const [a,b,c] = line;
    if (board[a[0]][a[1]] !== '' &&
        board[a[0]][a[1]] === board[b[0]][b[1]] &&
        board[a[0]][a[1]] === board[c[0]][c[1]]) {
      return { winner: board[a[0]][a[1]], line };
    }
  }

  return board.flat().includes('') ? null : { winner: 'Draw', line: [] };
}

function broadcast(data) {
  players.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify(data));
    }
  });
}

function resetGame() {
  board = [
    ['', '', ''],
    ['', '', ''],
    ['', '', '']
  ];
  currentTurn = 'X';
  broadcast({ type: 'update', board, currentTurn, winner: null, winningLine: [] });
  broadcast({ type: 'message', message: 'Game reset!' });
}

wss.on('connection', (ws) => {
  if (players.length >= 2) {
    ws.send(JSON.stringify({ type: 'error', message: 'Game full' }));
    ws.close();
    return;
  }

  // Assign player symbol
  const playerSymbol = nextSymbol;
  nextSymbol = nextSymbol === 'X' ? 'O' : 'X';
  const player = { ws, symbol: playerSymbol };
  players.push(player);

  ws.send(JSON.stringify({ type: 'init', symbol: playerSymbol }));
  broadcast({ type: 'message', message: `Player ${playerSymbol} joined!` });

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch (e) {
      console.error("Invalid JSON:", msg);
      return;
    }

    // Handle move
    if (data.type === 'move') {
      const { row, col } = data;
      if (player.symbol !== currentTurn || board[row][col] !== '') return;

      board[row][col] = currentTurn;

      const result = checkWin();
      const winner = result ? result.winner : null;
      const winningLine = result ? result.line : [];

      // Switch turn if game not finished
      if (!winner) {
        currentTurn = currentTurn === 'X' ? 'O' : 'X';
      }

      broadcast({ type: 'update', board, currentTurn, winner, winningLine });

      if (winner) {
        if (winner === 'X') xWins++;
        else if (winner === 'O') oWins++;
        broadcast({ type: 'message', message: `Score: X ${xWins} - O ${oWins}` });
        setTimeout(resetGame, 5000);
      }
    }

    // Handle chat
    if (data.type === 'chat') {
      broadcast({
        type: 'chat',
        player: player.symbol,
        message: data.message
      });
    }
  });

  ws.on('close', () => {
    console.log(`${player.symbol} disconnected`);
    players = players.filter(p => p.ws !== ws);

    // Reset game if a player leaves
    resetGame();
    broadcast({ type: 'message', message: `Player ${player.symbol} left. Game reset.` });
  });
});

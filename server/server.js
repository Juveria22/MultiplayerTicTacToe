const WebSocket = require('ws');

const PORT = process.env.PORT || 8080; // fallback for local dev
const wss = new WebSocket.Server({ port: PORT });
console.log(`Server running on ws://localhost:${PORT}`);

let players = [];
let board = [
  ['', '', ''],
  ['', '', ''],
  ['', '', '']
];
let currentTurn = 'X';

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
      return board[a[0]][a[1]];
    }
  }
  return board.flat().includes('') ? null : 'Draw';
}

function broadcast(data) {
  players.forEach(p => p.ws.send(JSON.stringify(data)));
}

wss.on('connection', (ws) => {
  if (players.length >= 2) {
    ws.send(JSON.stringify({ type: 'error', message: 'Game full' }));
    ws.close();
    return;
  }

  const playerSymbol = players.length === 0 ? 'X' : 'O';
  const player = { ws, symbol: playerSymbol };
  players.push(player);

  ws.send(JSON.stringify({ type: 'init', symbol: playerSymbol }));
  broadcast({ type: 'message', message: `Player ${playerSymbol} joined!` });

  ws.on('message', (msg) => {
    const data = JSON.parse(msg);

    if (data.type === 'move') {
      const { row, col } = data;
      if (player.symbol !== currentTurn || board[row][col] !== '') return;

      board[row][col] = currentTurn;
      const winner = checkWin();
      currentTurn = currentTurn === 'X' ? 'O' : 'X';

      broadcast({
        type: 'update',
        board,
        currentTurn,
        winner: winner ? winner : null
      });
    }

    if (data.type === 'chat') {
      broadcast({
          type: 'chat',
          player: player.symbol,   // <-- Add this
          message: data.message
      });
    }
  });

  ws.on('close', () => {
    players = players.filter(p => p.ws !== ws);
    board = [
      ['', '', ''],
      ['', '', ''],
      ['', '', '']
    ];
    currentTurn = 'X';
    broadcast({ type: 'message', message: `Player ${player.symbol} left. Game reset.` });
  });
});
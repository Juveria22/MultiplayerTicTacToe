const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
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

let nextSymbol = 'X';

wss.on('connection', (ws) => {
  if (players.length >= 2) {
    ws.send(JSON.stringify({ type: 'error', message: 'Game full' }));
    ws.close();
    return;
  }

  const playerSymbol = nextSymbol;
  nextSymbol = nextSymbol === 'X' ? 'O' : 'X';
  const player = { ws, symbol: playerSymbol };
  players.push(player);

  ws.send(JSON.stringify({ type: 'init', symbol: playerSymbol }));
  broadcast({ type: 'message', message: `Player ${playerSymbol} joined!` });

  ws.on('message', (msg) => {
    const data = JSON.parse(msg);

    // --- Handle move ---
    if (data.type === 'move') {
      const { row, col } = data;
      if (player.symbol !== currentTurn || board[row][col] !== '') return;

      board[row][col] = currentTurn;

      const result = checkWin();
      const winner = result ? result.winner : null;
      const winningLine = result ? result.line : [];

      // Broadcast update **before switching turn** so clients see correct currentTurn
      broadcast({ type: 'update', board, currentTurn, winner, winningLine });

      if (!winner) {
        currentTurn = currentTurn === 'X' ? 'O' : 'X';
      } else {
        setTimeout(() => {
          board = [
            ['', '', ''],
            ['', '', ''],
            ['', '', '']
          ];
          currentTurn = 'X';
          broadcast({ type: 'update', board, currentTurn, winner: null, winningLine: [] });
          broadcast({ type: 'message', message: 'Game reset!' });
        }, 5000);
      }
    }

    // --- Handle chat ---
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
    board = [
      ['', '', ''],
      ['', '', ''],
      ['', '', '']
    ];
    currentTurn = 'X';
    broadcast({ type: 'message', message: `Player ${player.symbol} left. Game reset.` });
    broadcast({ type: 'update', board, currentTurn, winner: null, winningLine: [] });
  });
});

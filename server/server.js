const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
console.log(`Server running on ws://localhost:${PORT}`);

// ----- Game Data -----
let waitingPlayer = null; // for matchmaking
let sessions = []; // list of active games

function createSession(player1, player2) {
    const session = {
        players: [player1, player2],
        board: [
            ['', '', ''],
            ['', '', ''],
            ['', '', '']
        ],
        currentTurn: 'X',
        xWins: 0,
        oWins: 0,
        gameStarted: false
    };

    // Assign symbols
    player1.symbol = 'X';
    player2.symbol = 'O';
    player1.session = session;
    player2.session = session;

    sessions.push(session);

    // Init messages
    player1.ws.send(JSON.stringify({ type: 'init', symbol: 'X' }));
    player2.ws.send(JSON.stringify({ type: 'init', symbol: 'O' }));

    broadcast(session, { type: 'message', message: 'Game found! Starting soon...' });

    startCountdown(session);

    return session;
}

function broadcast(session, data) {

  if (session && session.players){
    session.players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(data));
    });
  }
}

function checkWin(board) {
    const lines = [
        [[0,0],[0,1],[0,2]], [[1,0],[1,1],[1,2]], [[2,0],[2,1],[2,2]],
        [[0,0],[1,0],[2,0]], [[0,1],[1,1],[2,1]], [[0,2],[1,2],[2,2]],
        [[0,0],[1,1],[2,2]], [[0,2],[1,1],[2,0]]
    ];
    for (const line of lines) {
        const [a,b,c] = line;
        if (board[a[0]][a[1]] && board[a[0]][a[1]] === board[b[0]][b[1]] && board[a[0]][a[1]] === board[c[0]][c[1]]) {
            return { winner: board[a[0]][a[1]], line };
        }
    }
    return board.flat().includes('') ? null : { winner: 'Draw', line: [] };
}

// countdown after connecting with a player

function startCountdown(session) {
    let count = 3;
    const interval = setInterval(() => {
        session.players.forEach(p => {
            if (p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(JSON.stringify({ type: 'countdown', message: `Game starting in ${count}...` }));
            } else {
                p.ws.send(JSON.stringify({ type: 'countdown', message: 'Game start!' }));
            }
        });
        count--;
        if (count < 0) {
            clearInterval(interval);
            session.gameStarted = true;
            // Send initial board state to start game
            broadcast(session, {
                type: 'update',
                board: session.board,
                currentTurn: session.currentTurn,
                winner: null,
                winningLine: []
            });

        }
    }, 1000);
}


// ----- WebSocket connection -----
wss.on('connection', (ws) => {
    const player = { ws };

    // Matchmaking
    if (waitingPlayer === null) {
        waitingPlayer = player;
        ws.send(JSON.stringify({ type: 'message', message: 'Finding player...' }));
    } else {
        // Create new session
        const session = createSession(waitingPlayer, player);
        waitingPlayer = null;
    }

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);

        const session = player.session;
        if (!session) return; // not matched yet

        // Handle moves
        if (data.type === 'move') {
            const { row, col } = data;
            if (!session.gameStarted) return; // ignore moves until countdown finishes
            if (player.symbol !== session.currentTurn || session.board[row][col] !== '') return;


            session.board[row][col] = session.currentTurn;

            const result = checkWin(session.board);
            const winner = result ? result.winner : null;
            const winningLine = result ? result.line : [];

            if (!winner) {
                session.currentTurn = session.currentTurn === 'X' ? 'O' : 'X';
            }

            broadcast(session, { type: 'update', board: session.board, currentTurn: session.currentTurn, winner, winningLine });

            if (winner) {
                // update scores
                if (winner === 'X') session.xWins++;
                else if (winner === 'O') session.oWins++;

                const scoreMessage = winner === 'Draw'
                  ? "It's a Draw! Game resetting..."
                  : `Score: <strong>X</strong>: ${session.xWins} - <strong>O</strong>: ${session.oWins} Game resetting...`;

                broadcast(session, {
                  type: 'message',
                  message: scoreMessage
                });

                // Reset board after delay
                setTimeout(() => {
                    session.board = [
                        ['', '', ''],
                        ['', '', ''],
                        ['', '', '']
                    ];
                    session.currentTurn = 'X';
                    broadcast(session, { type: 'update', board: session.board, currentTurn: session.currentTurn, winner: null, winningLine: [] });
                }, 5000);
            }
        }

        // Handle chat
        if (data.type === 'chat') {
            broadcast(session, { type: 'chat', player: player.symbol, message: data.message });
        }
    });

    ws.on('close', () => {
        console.log('Player disconnected');
        if (player.session) {
            const session = player.session;
            
            // Remove the leaving player
            session.players = session.players.filter(p => p !== player);

            if (session.players.length === 1) {
                // Pause the game
                session.gameStarted = false;

                // Notify remaining player
                broadcast(session, { type: 'message', message: 'Opponent left. Waiting for a new player...' });

                // Put remaining player back into waiting queue
                waitingPlayer = session.players[0];
                waitingPlayer.session = null; // clear their old session so new session can be created
            }

            // Remove old session from active sessions list
            sessions = sessions.filter(s => s !== session);
        }

        // If waiting player disconnects
        if (waitingPlayer === player) waitingPlayer = null;
    });

});
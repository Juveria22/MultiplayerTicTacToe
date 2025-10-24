//cd Server
//npm install
//node server/server.js
const express = require('express');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 8080;

// Serve client files
app.use(express.static(path.join(__dirname, '../client')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Start HTTP server
const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Attach WebSocket server to the same HTTP server
const wss = new WebSocket.Server({ server });
console.log(`WebSocket server running on ws://localhost:${PORT}`);

// Queues for each game
const waitingPlayers = {
    'tic-tac-toe': [],
    'drawing': []
};

// Active sessions per game
const sessions = {
    'tic-tac-toe': [],
    'drawing': []
};

// Send data to all players in a session
function broadcast(session, data) {
    session.players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify(data));
        }
    });
}

// Tic Tac Toe win checking
function checkWin(board) {
    const lines = [
        [[0,0],[0,1],[0,2]], [[1,0],[1,1],[1,2]], [[2,0],[2,1],[2,2]],
        [[0,0],[1,0],[2,0]], [[0,1],[1,1],[2,1]], [[0,2],[1,2],[2,2]],
        [[0,0],[1,1],[2,2]], [[0,2],[1,1],[2,0]]
    ];
    for (const line of lines) {
        const [a,b,c] = line;
        if (board[a[0]][a[1]] &&
            board[a[0]][a[1]] === board[b[0]][b[1]] &&
            board[a[0]][a[1]] === board[c[0]][c[1]]) {
            return { winner: board[a[0]][a[1]], line };
        }
    }
    return board.flat().includes('') ? null : { winner: 'Draw', line: [] };
}

// Create a session for two players
function createSession(player1, player2, game) {
    const session = { players: [player1, player2], gameStarted: false, game };

    if (game === 'tic-tac-toe') {
        session.board = [['','',''],['','',''],['','','']];
        session.currentTurn = 'X';
        player1.symbol = 'X';
        player2.symbol = 'O';
        session.xWins = 0;
        session.oWins = 0;
    }

    player1.session = session;
    player2.session = session;
    sessions[game].push(session);

    broadcast(session, { game, type: 'message', message: 'Game found! Starting soon...' });
    startCountdown(session);
}

// Countdown before game starts
function startCountdown(session) {
    let count = 3;
    const interval = setInterval(() => {
        broadcast(session, { 
            game: session.game, 
            type: 'countdown', 
            message: `Game starting in ${count}...` 
        });
        count--;
        if (count < 0) {
            clearInterval(interval);
            session.gameStarted = true;

            broadcast(session, { 
                game: session.game, 
                type: 'message', 
                message: 'Game started!' 
            });

            if (session.game === 'tic-tac-toe') {
                // Assign symbols and send init to each player
                session.players.forEach((p, i) => {
                    const symbol = i === 0 ? 'X' : 'O';
                    p.symbol = symbol; // save on server for move validation
                    p.ws.send(JSON.stringify({
                        game: 'tic-tac-toe',
                        type: 'init',
                        symbol,
                        currentTurn: session.currentTurn,
                        board: session.board,
                        gameStarted: true
                    }));
                });

                // Send initial board state to both players
                broadcast(session, {
                    game: 'tic-tac-toe',
                    type: 'update',
                    board: session.board,
                    currentTurn: session.currentTurn,
                    winner: null,
                    winningLine: [],
                    gameStarted: true
                });
            } else if (session.game === 'drawing') {
                // start drawing message
                broadcast(session, {
                    game: 'drawing',
                    type: 'init',
                    message: 'Start drawing!',
                    gameStarted: true
                });
            }
        }
    }, 1000);
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
    const player = { ws, session: null, symbol: null, selectedGame: null };

    ws.on('message', (msg) => {
        let data;
        try { data = JSON.parse(msg); } 
        catch (err) { console.error('Invalid JSON:', msg); return; }

        // 1. Player selects a game
        if (data.type === 'selectGame' && data.game) {
            player.selectedGame = data.game;
            ws.send(JSON.stringify({ type: 'message', message: `You selected ${data.game}.` }));
            return;
        }

        // 2. Player clicks Join
        if (data.type === 'join') {
            if (!player.selectedGame) {
                ws.send(JSON.stringify({ type: 'error', message: 'Please select a game before joining.' }));
                return;
            }

            const game = player.selectedGame;
            waitingPlayers[game].push(player);
            ws.send(JSON.stringify({ game, type: 'message', message: 'Waiting for another player...' }));

            if (waitingPlayers[game].length >= 2) {
                const p1 = waitingPlayers[game].shift();
                const p2 = waitingPlayers[game].shift();
                createSession(p1, p2, game);
            }
            return;
        }

        // 3. Game moves / drawing
        if (player.session) {
            const session = player.session;

            // Tic Tac Toe moves
            if (session.game === 'tic-tac-toe' && data.type === 'move' && session.gameStarted) {
                const { row, col } = data;
                if (session.board[row][col] !== '' || player.symbol !== session.currentTurn) return;

                session.board[row][col] = session.currentTurn;
                const result = checkWin(session.board);
                const winner = result ? result.winner : null;
                const winningLine = result ? result.line : [];

                if (!winner) session.currentTurn = session.currentTurn === 'X' ? 'O' : 'X';

                broadcast(session, { game: 'tic-tac-toe', type: 'update', board: session.board, currentTurn: session.currentTurn, winner, winningLine, gameStarted: true});

                if (winner) {
                    if (winner === 'X') session.xWins++;
                    else if (winner === 'O') session.oWins++;

                    const scoreMessage = winner === 'Draw'
                        ? "It's a Draw! Game resetting..."
                        : `<strong>${winner}</strong> wins!<br>Score - X: ${session.xWins} | O: ${session.oWins}<br>Next round starting...`;

                    broadcast(session, {
                        type: 'message',
                        message: scoreMessage
                    });
                    setTimeout(() => {
                        session.board = [['','',''],['','',''],['','','']];
                        session.currentTurn = 'X';
                        broadcast(session, { game: 'tic-tac-toe', type: 'update', board: session.board, currentTurn: session.currentTurn, winner: null, winningLine: [], gameStarted: true });
                    }, 5000);
                }
            }
            if (data.type === 'chat') {
                broadcast(session, { type: 'chat', player: player.symbol, message: data.message });
            }

            // 2️⃣ Handle 'clearOwn' first
            if (data.type === 'clearOwn' && session.game === 'drawing') {
                // Broadcast clearOwn to all other players except the sender
                session.players.forEach(p => {
                    if (p !== player && p.ws.readyState === WebSocket.OPEN) {
                        p.ws.send(JSON.stringify({
                            game: 'drawing',
                            type: 'clearOwn',
                            playerId: data.playerId
                        }));
                    }
                });
                return; // done handling
            }



            // Drawing events
            if (session.game === 'drawing' && (data.type === 'drawing' || data.type === 'clear') && session.gameStarted) {
                broadcast(session, data);
            }
        }
    });

    ws.on('close', () => {
        // Remove from waiting queue
        Object.keys(waitingPlayers).forEach(game => {
            waitingPlayers[game] = waitingPlayers[game].filter(p => p !== player);
        });

        // Remove from sessions
        Object.keys(sessions).forEach(game => {
            sessions[game] = sessions[game].filter(sess => {
                if (sess.players.includes(player)) {
                    sess.players.forEach(p => {
                        if (p !== player && p.ws.readyState === WebSocket.OPEN) {
                            p.ws.send(JSON.stringify({ game, type: 'message', message: 'Opponent left. Waiting for a new player...' }));
                            p.session = null;
                            if (game === 'drawing') {
                                p.ws.send(JSON.stringify({ game, type: 'clear' }));
                            }
                            waitingPlayers[game].push(p);
                        }
                    });
                    return false;
                }
                return true;
            });
        });
    });
});

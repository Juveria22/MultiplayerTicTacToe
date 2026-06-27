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

// ------------------------------------------------------------------
// Every online game has a queue + an active-session list. To add a new
// online game, add its id here and a block in createSession() + a move
// handler in the message switch below.
// ------------------------------------------------------------------
const GAME_IDS = ['tic-tac-toe', 'drawing', 'connect-four', 'rps', 'memory', 'sugar'];

const waitingPlayers = {};
const sessions = {};
GAME_IDS.forEach(g => { waitingPlayers[g] = []; sessions[g] = []; });

// Send data to all players in a session
function broadcast(session, data) {
    session.players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify(data));
        }
    });
}
function sendTo(player, data) {
    if (player.ws.readyState === WebSocket.OPEN) player.ws.send(JSON.stringify(data));
}
function opponentOf(session, player) {
    return session.players.find(p => p !== player);
}

// ==================================================================
//  WIN CHECKERS
// ==================================================================

// Tic Tac Toe
function checkWinTTT(board) {
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

// Connect Four — grid is 6 rows x 7 cols of '' | 'X' | 'O'
function checkWinC4(grid, r, c, sym) {
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (const [dr, dc] of dirs) {
        const cells = [[r, c]];
        for (let s = 1; s < 4; s++) { const nr = r + dr*s, nc = c + dc*s; if (grid[nr] && grid[nr][nc] === sym) cells.push([nr, nc]); else break; }
        for (let s = 1; s < 4; s++) { const nr = r - dr*s, nc = c - dc*s; if (grid[nr] && grid[nr][nc] === sym) cells.push([nr, nc]); else break; }
        if (cells.length >= 4) return cells;
    }
    return null;
}

// ==================================================================
//  SESSION CREATION
// ==================================================================
function createSession(player1, player2, game) {
    const session = { players: [player1, player2], gameStarted: false, game };
    player1.symbol = 'X'; // player slot 1  (pink / player 1)
    player2.symbol = 'O'; // player slot 2  (amber / player 2)

    if (game === 'tic-tac-toe') {
        session.board = [['','',''],['','',''],['','','']];
        session.currentTurn = 'X';
        session.xWins = 0; session.oWins = 0;
    } else if (game === 'connect-four') {
        session.grid = Array.from({ length: 6 }, () => Array(7).fill(''));
        session.currentTurn = 'X';
    } else if (game === 'rps') {
        session.picks = { X: null, O: null };
        session.scores = { X: 0, O: 0 };
    } else if (game === 'memory') {
        // 8 pairs (0-7) shuffled into 16 positions — authoritative layout
        const deck = [];
        for (let i = 0; i < 8; i++) deck.push(i, i);
        for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
        session.deck = deck;                 // pair id at each index
        session.matched = Array(16).fill(false);
        session.flipped = [];                // currently face-up (max 2)
        session.scores = { X: 0, O: 0 };
        session.currentTurn = 'X';
        session.lock = false;
    } else if (game === 'sugar') {
        session.active = 'X';                // whose turn to play their round
        session.fills = { X: null, O: null };
        session.target = 38;
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
        broadcast(session, { game: session.game, type: 'countdown', message: `Game starting in ${count}...` });
        count--;
        if (count < 0) {
            clearInterval(interval);
            session.gameStarted = true;
            broadcast(session, { game: session.game, type: 'message', message: 'Game started!' });
            initGame(session);
        }
    }, 1000);
}

function initGame(session) {
    const g = session.game;
    session.players.forEach((p, i) => {
        const symbol = i === 0 ? 'X' : 'O';
        p.symbol = symbol;
        const base = { game: g, type: 'init', symbol, gameStarted: true };
        if (g === 'tic-tac-toe')      sendTo(p, { ...base, currentTurn: session.currentTurn, board: session.board });
        else if (g === 'connect-four') sendTo(p, { ...base, currentTurn: session.currentTurn, grid: session.grid });
        else if (g === 'rps')          sendTo(p, { ...base, scores: session.scores });
        else if (g === 'memory')       sendTo(p, { ...base, currentTurn: session.currentTurn, scores: session.scores });
        else if (g === 'sugar')        sendTo(p, { ...base, active: session.active, target: session.target });
        else if (g === 'drawing')      sendTo(p, { ...base, message: 'Start drawing!' });
    });
    if (g === 'tic-tac-toe') {
        broadcast(session, { game: g, type: 'update', board: session.board, currentTurn: session.currentTurn, winner: null, winningLine: [], gameStarted: true });
    }
}

// ==================================================================
//  PER-GAME MOVE HANDLERS
// ==================================================================
function handleTTT(session, player, data) {
    if (data.type !== 'move' || !session.gameStarted) return;
    const { row, col } = data;
    if (session.board[row][col] !== '' || player.symbol !== session.currentTurn) return;
    session.board[row][col] = session.currentTurn;
    const result = checkWinTTT(session.board);
    const winner = result ? result.winner : null;
    const winningLine = result ? result.line : [];
    if (!winner) session.currentTurn = session.currentTurn === 'X' ? 'O' : 'X';
    broadcast(session, { game: 'tic-tac-toe', type: 'update', board: session.board, currentTurn: session.currentTurn, winner, winningLine, gameStarted: true });
    if (winner) {
        if (winner === 'X') session.xWins++; else if (winner === 'O') session.oWins++;
        setTimeout(() => {
            session.board = [['','',''],['','',''],['','','']];
            session.currentTurn = 'X';
            broadcast(session, { game: 'tic-tac-toe', type: 'update', board: session.board, currentTurn: session.currentTurn, winner: null, winningLine: [], gameStarted: true });
        }, 5000);
    }
}

function handleC4(session, player, data) {
    if (data.type !== 'move' || !session.gameStarted) return;
    if (player.symbol !== session.currentTurn) return;
    const col = data.col, grid = session.grid;
    let row = -1;
    for (let r = 5; r >= 0; r--) { if (!grid[r][col]) { row = r; break; } }
    if (row < 0) return; // column full
    grid[row][col] = session.currentTurn;
    const winCells = checkWinC4(grid, row, col, session.currentTurn);
    const full = grid.every(rr => rr.every(c => c));
    let winner = null;
    if (winCells) winner = session.currentTurn;
    else if (full) winner = 'Draw';
    if (!winner) session.currentTurn = session.currentTurn === 'X' ? 'O' : 'X';
    broadcast(session, { game: 'connect-four', type: 'update', grid, currentTurn: session.currentTurn, winner, winCells: winCells || [] });
    if (winner) {
        setTimeout(() => {
            session.grid = Array.from({ length: 6 }, () => Array(7).fill(''));
            session.currentTurn = 'X';
            broadcast(session, { game: 'connect-four', type: 'update', grid: session.grid, currentTurn: 'X', winner: null, winCells: [] });
        }, 5000);
    }
}

function handleRPS(session, player, data) {
    if (data.type !== 'pick' || !session.gameStarted) return;
    if (session.picks[player.symbol]) return; // already picked this round
    if (!['rock', 'paper', 'scissors'].includes(data.choice)) return;
    session.picks[player.symbol] = data.choice;
    // let the opponent know a choice was locked (without revealing it)
    const opp = opponentOf(session, player);
    if (opp) sendTo(opp, { game: 'rps', type: 'opponentReady' });

    if (session.picks.X && session.picks.O) {
        const beat = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
        let result; // 'X' | 'O' | 'tie'
        if (session.picks.X === session.picks.O) result = 'tie';
        else result = beat[session.picks.X] === session.picks.O ? 'X' : 'O';
        if (result !== 'tie') session.scores[result]++;
        const matchWinner = session.scores.X >= 3 ? 'X' : (session.scores.O >= 3 ? 'O' : null);
        broadcast(session, { game: 'rps', type: 'reveal', picks: { X: session.picks.X, O: session.picks.O }, result, scores: { X: session.scores.X, O: session.scores.O }, matchWinner });
        session.picks = { X: null, O: null };
        if (matchWinner) { session.scores = { X: 0, O: 0 }; }
    }
}

function handleMemory(session, player, data) {
    if (data.type !== 'flip' || !session.gameStarted || session.lock) return;
    if (player.symbol !== session.currentTurn) return;
    const idx = data.idx;
    if (idx < 0 || idx > 15 || session.matched[idx] || session.flipped.includes(idx)) return;
    session.flipped.push(idx);
    // reveal this card to both players
    broadcast(session, { game: 'memory', type: 'reveal', idx, pair: session.deck[idx] });

    if (session.flipped.length === 2) {
        const [a, b] = session.flipped;
        if (session.deck[a] === session.deck[b]) {
            session.matched[a] = session.matched[b] = true;
            session.scores[session.currentTurn]++;
            session.flipped = [];
            const done = session.matched.every(Boolean);
            broadcast(session, { game: 'memory', type: 'matched', idxs: [a, b], scores: { X: session.scores.X, O: session.scores.O }, currentTurn: session.currentTurn, done });
            if (done) {
                const w = session.scores.X === session.scores.O ? 'Draw' : (session.scores.X > session.scores.O ? 'X' : 'O');
                broadcast(session, { game: 'memory', type: 'over', winner: w });
                setTimeout(() => resetMemory(session), 6000);
            }
        } else {
            session.lock = true;
            session.currentTurn = session.currentTurn === 'X' ? 'O' : 'X';
            setTimeout(() => {
                const [x, y] = session.flipped;
                session.flipped = [];
                session.lock = false;
                broadcast(session, { game: 'memory', type: 'hide', idxs: [x, y], currentTurn: session.currentTurn });
            }, 1000);
        }
    }
}
function resetMemory(session) {
    const deck = [];
    for (let i = 0; i < 8; i++) deck.push(i, i);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    session.deck = deck; session.matched = Array(16).fill(false); session.flipped = [];
    session.scores = { X: 0, O: 0 }; session.currentTurn = 'X'; session.lock = false;
    broadcast(session, { game: 'memory', type: 'restart', currentTurn: 'X', scores: { X: 0, O: 0 } });
}

function handleSugar(session, player, data) {
    if (data.type !== 'result' || !session.gameStarted) return;
    if (player.symbol !== session.active) return;          // only the active player reports
    if (session.fills[player.symbol] != null) return;      // already reported
    session.fills[player.symbol] = data.count | 0;

    if (session.active === 'X') {
        // hand the turn to player O
        session.active = 'O';
        broadcast(session, { game: 'sugar', type: 'turn', active: 'O', fills: { X: session.fills.X, O: null } });
    } else {
        const w = session.fills.X === session.fills.O ? 'Draw' : (session.fills.X > session.fills.O ? 'X' : 'O');
        broadcast(session, { game: 'sugar', type: 'over', fills: { X: session.fills.X, O: session.fills.O }, winner: w });
        setTimeout(() => {
            session.active = 'X'; session.fills = { X: null, O: null };
            broadcast(session, { game: 'sugar', type: 'restart', active: 'X' });
        }, 6000);
    }
}

const MOVE_HANDLERS = {
    'tic-tac-toe': handleTTT,
    'connect-four': handleC4,
    'rps': handleRPS,
    'memory': handleMemory,
    'sugar': handleSugar
};

// ==================================================================
//  CONNECTION
// ==================================================================
wss.on('connection', (ws) => {
    const player = { ws, session: null, symbol: null, selectedGame: null };

    ws.on('message', (msg) => {
        let data;
        try { data = JSON.parse(msg); } catch (err) { console.error('Invalid JSON:', msg); return; }

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
            if (!waitingPlayers[game]) {
                ws.send(JSON.stringify({ type: 'error', message: 'That game is not available online.' }));
                return;
            }
            waitingPlayers[game].push(player);
            ws.send(JSON.stringify({ game, type: 'message', message: 'Waiting for another player...' }));
            if (waitingPlayers[game].length >= 2) {
                const p1 = waitingPlayers[game].shift();
                const p2 = waitingPlayers[game].shift();
                createSession(p1, p2, game);
            }
            return;
        }

        // 3. In-session traffic
        if (player.session) {
            const session = player.session;

            // chat is shared by every game
            if (data.type === 'chat') {
                broadcast(session, { type: 'chat', player: player.symbol, message: data.message });
                return;
            }

            // drawing relay (unchanged)
            if (session.game === 'drawing') {
                if (data.type === 'clearOwn') {
                    session.players.forEach(p => {
                        if (p !== player && p.ws.readyState === WebSocket.OPEN) {
                            p.ws.send(JSON.stringify({ game: 'drawing', type: 'clearOwn', playerId: data.playerId }));
                        }
                    });
                    return;
                }
                if ((data.type === 'drawing' || data.type === 'clear') && session.gameStarted) {
                    broadcast(session, data);
                }
                return;
            }

            // every other game routes to its move handler
            const handler = MOVE_HANDLERS[session.game];
            if (handler) handler(session, player, data);
        }
    });

    ws.on('close', () => {
        // Remove from waiting queue
        Object.keys(waitingPlayers).forEach(game => {
            waitingPlayers[game] = waitingPlayers[game].filter(p => p !== player);
        });
        // Remove from sessions; notify + re-queue the opponent
        Object.keys(sessions).forEach(game => {
            sessions[game] = sessions[game].filter(sess => {
                if (sess.players.includes(player)) {
                    sess.players.forEach(p => {
                        if (p !== player && p.ws.readyState === WebSocket.OPEN) {
                            p.ws.send(JSON.stringify({ game, type: 'message', message: 'Opponent left. Waiting for a new player...' }));
                            p.ws.send(JSON.stringify({ game, type: 'opponentLeft' }));
                            p.session = null;
                            if (game === 'drawing') p.ws.send(JSON.stringify({ game, type: 'clear' }));
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

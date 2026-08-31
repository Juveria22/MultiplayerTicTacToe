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
const GAME_IDS = ['tic-tac-toe', 'drawing', 'connect-four', 'rps', 'memory', 'sugar', 'checkers', 'battleship', 'reversi', 'dots', 'pong', 'dressup'];

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

// ------------------------------------------------------------------
//  Checkers engine — board is 8x8 of '' | 'x'/'X' | 'o'/'O'
//  (lowercase = man, uppercase = king). X = player 1 (moves up).
// ------------------------------------------------------------------
function ck_owner(v) { return !v ? null : (v === 'x' || v === 'X') ? 'X' : 'O'; }
function ck_king(v) { return v === 'X' || v === 'O'; }
function ck_opp(s) { return s === 'X' ? 'O' : 'X'; }
function ck_inB(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function ck_dirs(v) {
    if (v === 'x') return [[-1, -1], [-1, 1]];
    if (v === 'o') return [[1, -1], [1, 1]];
    return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
}
function ck_jumps(b, r, c) {
    const v = b[r][c]; if (!v) return [];
    const me = ck_owner(v), out = [];
    for (const d of ck_dirs(v)) {
        const mr = r + d[0], mc = c + d[1], lr = r + 2*d[0], lc = c + 2*d[1];
        if (ck_inB(lr, lc) && b[lr][lc] === '' && ck_inB(mr, mc)) {
            const mid = b[mr][mc];
            if (mid && ck_owner(mid) === ck_opp(me)) out.push({ to: [lr, lc], cap: [mr, mc] });
        }
    }
    return out;
}
function ck_simple(b, r, c) {
    const v = b[r][c]; if (!v) return [];
    const out = [];
    for (const d of ck_dirs(v)) {
        const nr = r + d[0], nc = c + d[1];
        if (ck_inB(nr, nc) && b[nr][nc] === '') out.push({ to: [nr, nc] });
    }
    return out;
}
function ck_hasJump(b, sym) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
        if (ck_owner(b[r][c]) === sym && ck_jumps(b, r, c).length) return true;
    return false;
}
function ck_hasMove(b, sym) {
    if (ck_hasJump(b, sym)) return true;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
        if (ck_owner(b[r][c]) === sym && ck_simple(b, r, c).length) return true;
    return false;
}
function ck_legal(b, r, c) {
    const v = b[r][c]; if (!v) return [];
    return ck_hasJump(b, ck_owner(v)) ? ck_jumps(b, r, c) : ck_simple(b, r, c);
}
function ck_promote(b, r, c) {
    const v = b[r][c];
    if (v === 'x' && r === 0) { b[r][c] = 'X'; return true; }
    if (v === 'o' && r === 7) { b[r][c] = 'O'; return true; }
    return false;
}
function ck_step(b, fr, fc, tr, tc) {
    const v = b[fr][fc];
    b[tr][tc] = v; b[fr][fc] = '';
    const jumped = Math.abs(tr - fr) === 2;
    if (jumped) b[(fr + tr) / 2][(fc + tc) / 2] = '';
    const promoted = ck_promote(b, tr, tc);
    const again = jumped && !promoted && ck_jumps(b, tr, tc).length > 0;
    return { jumped, promoted, again };
}
function ck_fresh() {
    const b = [];
    for (let r = 0; r < 8; r++) {
        const row = [];
        for (let c = 0; c < 8; c++) {
            const play = (r + c) % 2 === 1;
            row.push(play && r < 3 ? 'o' : play && r > 4 ? 'x' : '');
        }
        b.push(row);
    }
    return b;
}

// ------------------------------------------------------------------
//  Reversi / Othello engine — 8x8 of '' | 'X' | 'O'
// ------------------------------------------------------------------
const RV_DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
function rv_opp(s) { return s === 'X' ? 'O' : 'X'; }
function rv_inB(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function rv_fresh() {
    const b = []; for (let r = 0; r < 8; r++) b.push(['','','','','','','','']);
    b[3][3] = 'O'; b[3][4] = 'X'; b[4][3] = 'X'; b[4][4] = 'O';
    return b;
}
function rv_flips(board, r, c, sym) {
    if (board[r][c] !== '') return [];
    let all = [];
    for (const d of RV_DIRS) {
        const line = []; let rr = r + d[0], cc = c + d[1];
        while (rv_inB(rr, cc) && board[rr][cc] === rv_opp(sym)) { line.push([rr, cc]); rr += d[0]; cc += d[1]; }
        if (line.length && rv_inB(rr, cc) && board[rr][cc] === sym) all = all.concat(line);
    }
    return all;
}
function rv_hasMove(board, sym) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
        if (board[r][c] === '' && rv_flips(board, r, c, sym).length) return true;
    return false;
}
function rv_counts(board) {
    let x = 0, o = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { if (board[r][c] === 'X') x++; else if (board[r][c] === 'O') o++; }
    return { X: x, O: o };
}

// ------------------------------------------------------------------
//  Dots & Boxes engine — N x N boxes = (N+1) x (N+1) dots.
//  h[r][c] horizontal (r 0..N, c 0..N-1) · v[r][c] vertical (r 0..N-1, c 0..N)
//  edge value '' undrawn | 'X' | 'O' ; boxes[r][c] owner or ''
// ------------------------------------------------------------------
const DT_NR = 7, DT_NC = 13;
function dt_grid(rows, cols) { const g = []; for (let r = 0; r < rows; r++) { const row = []; for (let c = 0; c < cols; c++) row.push(''); g.push(row); } return g; }
function dt_fresh() { return { h: dt_grid(DT_NR + 1, DT_NC), v: dt_grid(DT_NR, DT_NC + 1), boxes: dt_grid(DT_NR, DT_NC) }; }
function dt_opp(s) { return s === 'X' ? 'O' : 'X'; }
function dt_boxComplete(s, r, c) { return s.h[r][c] && s.h[r + 1][c] && s.v[r][c] && s.v[r][c + 1]; }
function dt_boxesForEdge(kind, r, c) { return kind === 'h' ? [[r - 1, c], [r, c]] : [[r, c - 1], [r, c]]; }
function dt_apply(s, kind, r, c, sym) {
    (kind === 'h' ? s.h : s.v)[r][c] = sym;
    let claimed = 0;
    for (const b of dt_boxesForEdge(kind, r, c)) {
        const br = b[0], bc = b[1];
        if (br < 0 || bc < 0 || br >= DT_NR || bc >= DT_NC) continue;
        if (!s.boxes[br][bc] && dt_boxComplete(s, br, bc)) { s.boxes[br][bc] = sym; claimed++; }
    }
    return claimed;
}
function dt_full(s) { for (let r = 0; r < DT_NR; r++) for (let c = 0; c < DT_NC; c++) if (!s.boxes[r][c]) return false; return true; }
function dt_counts(s) { let x = 0, o = 0; for (let r = 0; r < DT_NR; r++) for (let c = 0; c < DT_NC; c++) { if (s.boxes[r][c] === 'X') x++; else if (s.boxes[r][c] === 'O') o++; } return { X: x, O: o }; }

// ------------------------------------------------------------------
//  Pong engine — authoritative real-time physics on a fixed 800x500
//  logical field. Constants MUST match the client (js/games/pong.js).
// ------------------------------------------------------------------
const PG_W = 800, PG_H = 500, PG_PW = 15, PG_PH = 94, PG_BR = 9, PG_PADX = 28;
const PG_PSPEED = 560, PG_BSP0 = 380, PG_BSPMAX = 800, PG_WIN = 7, PG_DT = 0.04;
function pg_clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function pg_fresh() {
    return {
        x: PG_W / 2, y: PG_H / 2, vx: 0, vy: 0,
        p1y: (PG_H - PG_PH) / 2, p2y: (PG_H - PG_PH) / 2,
        s1: 0, s2: 0, dir1: 0, dir2: 0, winner: null,
        launchAt: Date.now() + 800, serveDir: Math.random() < 0.5 ? 1 : -1
    };
}
function pg_serve(p, dir) {
    const ang = (Math.random() * 0.5 - 0.25);
    p.vx = Math.cos(ang) * PG_BSP0 * dir;
    p.vy = Math.sin(ang) * PG_BSP0;
}
function pg_bounce(p, py) {
    const rel = pg_clamp((p.y - (py + PG_PH / 2)) / (PG_PH / 2), -1, 1);
    const speed = Math.min(Math.hypot(p.vx, p.vy) * 1.06, PG_BSPMAX);
    const ang = rel * (Math.PI * 0.40);
    const dir = p.vx < 0 ? 1 : -1;
    p.vx = dir * speed * Math.cos(ang);
    p.vy = speed * Math.sin(ang);
}
function pg_tick(session) {
    const p = session.pong; if (!p) return;
    const now = Date.now();
    if (!p.winner) {
        // paddles
        p.p1y = pg_clamp(p.p1y + p.dir1 * PG_PSPEED * PG_DT, 0, PG_H - PG_PH);
        p.p2y = pg_clamp(p.p2y + p.dir2 * PG_PSPEED * PG_DT, 0, PG_H - PG_PH);
        if (p.launchAt) {
            if (now >= p.launchAt) { pg_serve(p, p.serveDir); p.launchAt = 0; }
        } else {
            p.x += p.vx * PG_DT; p.y += p.vy * PG_DT;
            if (p.y < PG_BR) { p.y = PG_BR; p.vy = -p.vy; }
            else if (p.y > PG_H - PG_BR) { p.y = PG_H - PG_BR; p.vy = -p.vy; }
            if (p.vx < 0 && p.x - PG_BR <= PG_PADX + PG_PW && p.x - PG_BR >= PG_PADX - 6 &&
                p.y >= p.p1y - PG_BR && p.y <= p.p1y + PG_PH + PG_BR) { p.x = PG_PADX + PG_PW + PG_BR; pg_bounce(p, p.p1y); }
            if (p.vx > 0 && p.x + PG_BR >= PG_W - PG_PADX - PG_PW && p.x + PG_BR <= PG_W - PG_PADX + 6 &&
                p.y >= p.p2y - PG_BR && p.y <= p.p2y + PG_PH + PG_BR) { p.x = PG_W - PG_PADX - PG_PW - PG_BR; pg_bounce(p, p.p2y); }
            let scored = 0;
            if (p.x < -PG_BR - 6) scored = 2;
            else if (p.x > PG_W + PG_BR + 6) scored = 1;
            if (scored) {
                if (scored === 1) p.s1++; else p.s2++;
                if (p.s1 >= PG_WIN) p.winner = 'X';
                else if (p.s2 >= PG_WIN) p.winner = 'O';
                else { p.x = PG_W / 2; p.y = PG_H / 2; p.vx = 0; p.vy = 0; p.serveDir = -p.serveDir; p.launchAt = now + 650; }
            }
        }
    }
    broadcast(session, {
        game: 'pong', type: 'state',
        x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy),
        p1y: Math.round(p.p1y), p2y: Math.round(p.p2y), s1: p.s1, s2: p.s2, winner: p.winner
    });
    if (p.winner && !p.resetTimer) {
        p.resetTimer = setTimeout(() => {
            const f = pg_fresh();
            session.pong = f;                       // keep the same loop running
        }, 6000);
    }
}
function pg_startLoop(session) {
    if (session.pongLoop) clearInterval(session.pongLoop);
    session.pongLoop = setInterval(() => pg_tick(session), PG_DT * 1000);
}
function pg_stopLoop(session) {
    if (session.pongLoop) { clearInterval(session.pongLoop); session.pongLoop = null; }
    if (session.pong && session.pong.resetTimer) { clearTimeout(session.pong.resetTimer); }
}

// ------------------------------------------------------------------
//  Battleship engine — 10x10 boards. Cell '' water | 1..5 ship id.
// ------------------------------------------------------------------
const BS_N = 10;
const BS_SHIPS = [
    { id: 1, size: 5, name: 'CARRIER' }, { id: 2, size: 4, name: 'BATTLESHIP' },
    { id: 3, size: 3, name: 'CRUISER' }, { id: 4, size: 3, name: 'SUB' }, { id: 5, size: 2, name: 'DESTROYER' }
];
function bs_emptyShots() { const g = []; for (let r = 0; r < BS_N; r++) g.push(Array(BS_N).fill('')); return g; }
function bs_validBoard(b) {
    if (!Array.isArray(b) || b.length !== BS_N) return false;
    const counts = {};
    for (let r = 0; r < BS_N; r++) {
        if (!Array.isArray(b[r]) || b[r].length !== BS_N) return false;
        for (let c = 0; c < BS_N; c++) { const v = b[r][c]; if (v !== '') counts[v] = (counts[v] || 0) + 1; }
    }
    for (const s of BS_SHIPS) if (counts[s.id] !== s.size) return false; // exact fleet
    return true;
}
function bs_fleet() { return BS_SHIPS.map(s => ({ id: s.id, size: s.size, name: s.name, hits: 0, sunk: false })); }
function bs_hit(fleet, board, r, c) {
    const id = board[r][c]; if (!id) return { hit: false, sunk: null };
    const ship = fleet.find(s => s.id === id);
    ship.hits++;
    return { hit: true, sunk: ship.hits >= ship.size ? ship.name : null };
}
function bs_allSunk(fleet) { return fleet.every(s => s.sunk); }

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
        // 12 pairs (0-11) shuffled into 24 positions - authoritative layout
        const deck = [];
        for (let i = 0; i < 12; i++) deck.push(i, i);
        for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
        session.deck = deck;                 // pair id at each index
        session.matched = Array(24).fill(false);
        session.flipped = [];                // currently face-up (max 2)
        session.scores = { X: 0, O: 0 };
        session.currentTurn = 'X';
        session.lock = false;
    } else if (game === 'sugar') {
        session.active = 'X';                // whose turn to play their round
        session.fills = { X: null, O: null };
        session.target = 38;
    } else if (game === 'checkers') {
        session.board = ck_fresh();
        session.currentTurn = 'X';
        session.continues = null;            // [r,c] mid multi-jump, or null
    } else if (game === 'reversi') {
        session.board = rv_fresh();
        session.currentTurn = 'X';           // X (player 1) moves first
    } else if (game === 'dots') {
        const s = dt_fresh();
        session.h = s.h; session.v = s.v; session.boxes = s.boxes;
        session.currentTurn = 'X';           // X (player 1) draws first
    } else if (game === 'pong') {
        session.pong = pg_fresh();           // authoritative physics; loop starts in initGame
    } else if (game === 'battleship') {
        session.phase = 'place';
        session.boards = { X: null, O: null };
        session.fleets = { X: null, O: null };
        session.shots = { X: bs_emptyShots(), O: bs_emptyShots() };
        session.currentTurn = null;
    } else if (game === 'dressup') {
        session.chars = du_fresh();       // [figure0, figure1] — opaque char objects
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
        else if (g === 'checkers')     sendTo(p, { ...base, currentTurn: session.currentTurn, board: session.board });
        else if (g === 'reversi')      sendTo(p, { ...base, currentTurn: session.currentTurn, board: session.board });
        else if (g === 'dots')         sendTo(p, { ...base, currentTurn: session.currentTurn, h: session.h, v: session.v, boxes: session.boxes });
        else if (g === 'pong')         sendTo(p, { ...base, W: PG_W, H: PG_H, pw: PG_PW, ph: PG_PH });
        else if (g === 'battleship')   sendTo(p, { ...base, phase: 'place' });
        else if (g === 'dressup')      sendTo(p, { ...base, chars: session.chars });
        else if (g === 'drawing')      sendTo(p, { ...base, message: 'Start drawing!' });
    });
    if (g === 'tic-tac-toe') {
        broadcast(session, { game: g, type: 'update', board: session.board, currentTurn: session.currentTurn, winner: null, winningLine: [], gameStarted: true });
    }
    if (g === 'pong') { pg_startLoop(session); }
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
    for (let i = 0; i < 12; i++) deck.push(i, i);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    session.deck = deck; session.matched = Array(24).fill(false); session.flipped = [];
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

function handleCheckers(session, player, data) {
    if (data.type !== 'move' || !session.gameStarted) return;
    if (player.symbol !== session.currentTurn) return;
    const from = data.from, to = data.to;
    if (!Array.isArray(from) || !Array.isArray(to)) return;
    if (!ck_inB(from[0], from[1]) || !ck_inB(to[0], to[1])) return;
    // mid multi-jump: must keep moving the same piece
    if (session.continues && (session.continues[0] !== from[0] || session.continues[1] !== from[1])) return;
    const board = session.board;
    if (ck_owner(board[from[0]][from[1]]) !== player.symbol) return;

    // validate the destination is legal (mandatory-capture aware)
    const dests = session.continues ? ck_jumps(board, from[0], from[1]) : ck_legal(board, from[0], from[1]);
    if (!dests.some(d => d.to[0] === to[0] && d.to[1] === to[1])) return;

    const res = ck_step(board, from[0], from[1], to[0], to[1]);

    if (res.again) {
        session.continues = [to[0], to[1]];
        broadcast(session, { game: 'checkers', type: 'update', board, currentTurn: session.currentTurn, winner: null, continues: session.continues, captured: true });
        return;
    }
    session.continues = null;
    const next = ck_opp(session.currentTurn);
    const winner = ck_hasMove(board, next) ? null : session.currentTurn;
    if (!winner) session.currentTurn = next;
    broadcast(session, { game: 'checkers', type: 'update', board, currentTurn: session.currentTurn, winner, continues: null, captured: res.jumped });
    if (winner) {
        setTimeout(() => {
            session.board = ck_fresh();
            session.currentTurn = 'X';
            session.continues = null;
            broadcast(session, { game: 'checkers', type: 'update', board: session.board, currentTurn: 'X', winner: null, continues: null });
        }, 5000);
    }
}

function handleReversi(session, player, data) {
    if (data.type !== 'move' || !session.gameStarted) return;
    if (player.symbol !== session.currentTurn) return;
    const r = data.r, c = data.c;
    if (!Number.isInteger(r) || !Number.isInteger(c) || !rv_inB(r, c)) return;
    const board = session.board, sym = session.currentTurn;
    const flips = rv_flips(board, r, c, sym);
    if (!flips.length) return;                       // illegal move
    board[r][c] = sym;
    flips.forEach(p => { board[p[0]][p[1]] = sym; });

    // next up: opponent if they can move, else mover (pass), else game over
    let next = rv_opp(sym), passed = false, winner = null;
    if (!rv_hasMove(board, next)) {
        if (rv_hasMove(board, sym)) { next = sym; passed = true; }
        else {
            const cnt = rv_counts(board);
            winner = cnt.X === cnt.O ? 'Draw' : (cnt.X > cnt.O ? 'X' : 'O');
        }
    }
    if (!winner) session.currentTurn = next;
    broadcast(session, { game: 'reversi', type: 'update', board, currentTurn: session.currentTurn, last: [r, c], flipped: flips, passed, winner });
    if (winner) {
        setTimeout(() => {
            session.board = rv_fresh();
            session.currentTurn = 'X';
            broadcast(session, { game: 'reversi', type: 'update', board: session.board, currentTurn: 'X', last: null, flipped: null, passed: false, winner: null });
        }, 6000);
    }
}

function handleBattleship(session, player, data) {
    const me = player.symbol, foe = me === 'X' ? 'O' : 'X';

    // ---- placement ----
    if (data.type === 'place' && session.phase === 'place') {
        if (session.boards[me]) return;              // already placed
        if (!bs_validBoard(data.board)) return;      // reject malformed fleets
        session.boards[me] = data.board;
        session.fleets[me] = bs_fleet();
        const opp = opponentOf(session, player);
        if (opp) sendTo(opp, { game: 'battleship', type: 'oppReady' });
        if (session.boards.X && session.boards.O) {
            session.phase = 'fire';
            session.currentTurn = 'X';
            broadcast(session, { game: 'battleship', type: 'begin', currentTurn: session.currentTurn });
        }
        return;
    }

    // ---- firing ----
    if (data.type === 'fire' && session.phase === 'fire') {
        if (me !== session.currentTurn) return;
        const r = data.r, c = data.c;
        if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= BS_N || c < 0 || c >= BS_N) return;
        if (session.shots[me][r][c] !== '') return;   // already fired here
        const board = session.boards[foe];
        const res = bs_hit(session.fleets[foe], board, r, c);
        session.shots[me][r][c] = res.hit ? 'H' : 'M';
        const win = res.hit && bs_allSunk(session.fleets[foe]);
        if (!win) session.currentTurn = foe;          // pass the turn each shot
        sendTo(player, { game: 'battleship', type: 'result', r, c, hit: res.hit, sunk: res.sunk, win, currentTurn: session.currentTurn });
        const opp = opponentOf(session, player);
        if (opp) sendTo(opp, { game: 'battleship', type: 'incoming', r, c, hit: res.hit, sunk: res.sunk, lose: win, currentTurn: session.currentTurn });
        if (win) {
            setTimeout(() => {
                session.phase = 'place';
                session.boards = { X: null, O: null };
                session.fleets = { X: null, O: null };
                session.shots = { X: bs_emptyShots(), O: bs_emptyShots() };
                session.currentTurn = null;
                broadcast(session, { game: 'battleship', type: 'reset' });
            }, 6000);
        }
    }
}

function handleDots(session, player, data) {
    if (data.type !== 'move' || !session.gameStarted) return;
    if (player.symbol !== session.currentTurn) return;
    const { kind, r, c } = data;
    if (kind !== 'h' && kind !== 'v') return;
    const grid = kind === 'h' ? session.h : session.v;
    if (!Number.isInteger(r) || !Number.isInteger(c) || !grid[r] || grid[r][c] === undefined) return;
    if (grid[r][c] !== '') return;                       // already drawn
    const sym = session.currentTurn;
    const claimed = dt_apply(session, kind, r, c, sym);
    let winner = null;
    if (dt_full(session)) {
        const cnt = dt_counts(session);
        winner = cnt.X === cnt.O ? 'Draw' : (cnt.X > cnt.O ? 'X' : 'O');
    } else if (!claimed) {
        session.currentTurn = dt_opp(sym);               // no box closed -> pass turn
    }
    broadcast(session, { game: 'dots', type: 'update', h: session.h, v: session.v, boxes: session.boxes, currentTurn: session.currentTurn, last: { kind, r, c }, claimed: claimed > 0, winner });
    if (winner) {
        setTimeout(() => {
            const s = dt_fresh();
            session.h = s.h; session.v = s.v; session.boxes = s.boxes; session.currentTurn = 'X';
            broadcast(session, { game: 'dots', type: 'update', h: session.h, v: session.v, boxes: session.boxes, currentTurn: 'X', last: null, claimed: false, winner: null });
        }, 6000);
    }
}

function handlePong(session, player, data) {
    if (data.type !== 'input' || !session.gameStarted || !session.pong) return;
    const dir = data.dir === -1 || data.dir === 1 ? data.dir : 0;
    if (player.symbol === 'X') session.pong.dir1 = dir;
    else if (player.symbol === 'O') session.pong.dir2 = dir;
}

// ==================================================================
//  DRESS UP  — co-op styling, no rules. Each player owns one figure
//  (X = figure 0, O = figure 1). The server relays the full pair on
//  every change; char objects are opaque (the client interprets them).
// ==================================================================
function du_char(body, hairCol, shirtCol, pantsCol, shoesCol, accCol) {
    return { body, hair: null, hairCol, shirt: null, shirtCol, pants: null, pantsCol, shoes: null, shoesCol, acc: null, accCol };
}
function du_fresh() {
    return [
        du_char('#39ff8b', '#ff79c6', '#ff2d9b', '#2de2ff', '#ff2d9b', '#caff00'),
        du_char('#ff79c6', '#b14bff', '#ffb000', '#2de2ff', '#caff00', '#2de2ff')
    ];
}
function handleDressup(session, player, data) {
    if (data.type !== 'dress' || !session.gameStarted) return;
    // a player may only edit their OWN figure (X = 0, O = 1)
    const mine = player.symbol === 'O' ? 1 : 0;
    if (data.char !== mine) return;
    if (!data.data || typeof data.data !== 'object') return;
    session.chars[mine] = data.data;
    broadcast(session, { game: 'dressup', type: 'update', chars: session.chars });
}

const MOVE_HANDLERS = {
    'tic-tac-toe': handleTTT,
    'dressup': handleDressup,
    'connect-four': handleC4,
    'rps': handleRPS,
    'memory': handleMemory,
    'sugar': handleSugar,
    'checkers': handleCheckers,
    'battleship': handleBattleship,
    'reversi': handleReversi,
    'dots': handleDots,
    'pong': handlePong
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
                    if (game === 'pong') pg_stopLoop(sess);
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

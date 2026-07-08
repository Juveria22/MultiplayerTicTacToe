/* ============================================================
   Reversi / Othello — local 2P + online.

   LOCAL  : rules run client-side; place a disc, flip flanked lines.
   ONLINE : the server is authoritative. We send {r,c}; it validates,
            flips, handles forced passes and end-of-game, and
            broadcasts the board + whose turn it is.

   Rules: place a disc so it flanks one or more straight lines of
   the opponent's discs bounded by your own disc; every flanked
   disc flips. You MUST play a legal move if one exists; if not,
   your turn is skipped (pass). Game ends when neither side can
   move — most discs wins (tie possible).

   Cell codes: '' empty | 'X' player-1 (pink) | 'O' player-2 (amber)
   ============================================================ */
(function () {
  var ACCENT = '#2de2ff';
  var DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

  /* ---------- rules engine (shared shape with the server) ---------- */
  function opp(s) { return s === 'X' ? 'O' : 'X'; }
  function inB(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function freshBoard() {
    var b = []; for (var r = 0; r < 8; r++) b.push(['','','','','','','','']);
    b[3][3] = 'O'; b[3][4] = 'X'; b[4][3] = 'X'; b[4][4] = 'O';
    return b;
  }
  function cloneBoard(b) { return b.map(function (r) { return r.slice(); }); }
  // discs that would flip if `sym` plays at r,c (empty list = illegal)
  function flipsFor(board, r, c, sym) {
    if (board[r][c] !== '') return [];
    var all = [];
    DIRS.forEach(function (d) {
      var line = [], rr = r + d[0], cc = c + d[1];
      while (inB(rr, cc) && board[rr][cc] === opp(sym)) { line.push([rr, cc]); rr += d[0]; cc += d[1]; }
      if (line.length && inB(rr, cc) && board[rr][cc] === sym) all = all.concat(line);
    });
    return all;
  }
  function legalMoves(board, sym) {
    var out = [];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++)
      if (board[r][c] === '' && flipsFor(board, r, c, sym).length) out.push([r, c]);
    return out;
  }
  function counts(board) {
    var x = 0, o = 0;
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) { if (board[r][c] === 'X') x++; else if (board[r][c] === 'O') o++; }
    return { X: x, O: o };
  }
  // apply a move; mutates board; returns {flipped:[...] }
  function applyMove(board, r, c, sym) {
    var flips = flipsFor(board, r, c, sym);
    board[r][c] = sym;
    flips.forEach(function (p) { board[p[0]][p[1]] = sym; });
    return flips;
  }
  function isLegal(g, r, c) { return (g.legal || []).some(function (m) { return m[0] === r && m[1] === c; }); }

  Arcade.registerGame('reversi', {
    meta: { name: 'REVERSI', accent: ACCENT },
    online: true,

    fresh: function () {
      var b = freshBoard();
      return { board: b, cur: 'X', legal: legalMoves(b, 'X'), last: null, flipping: null, winner: null, passed: false };
    },

    click: function (r, c, api) {
      var g = api.game; if (!g || g.winner) return;

      // ----- ONLINE -----
      if (api.mode === 'online') {
        if (api.matchState !== 'playing') return;
        if (g.cur !== api.mySymbol) { api.sfx('error'); return; }
        if (!isLegal(g, r, c)) { api.sfx('error'); return; }
        api.send({ game: 'reversi', type: 'move', r: r, c: c });
        return;
      }

      // ----- LOCAL -----
      if (!isLegal(g, r, c)) { api.sfx('error'); return; }
      var board = cloneBoard(g.board);
      var flipped = applyMove(board, r, c, g.cur);
      api.sfx('place');
      advanceLocal(api, board, g.cur, { at: [r, c], flipped: flipped });
    },

    onServer: function (data, api) {
      if (data.game !== 'reversi') return;
      if (data.type === 'init') {
        api.mySymbol = data.symbol; api.matchState = 'playing'; api.hideWaiting();
        api.setGame(function () {
          return { board: data.board, cur: data.currentTurn, legal: legalMoves(data.board, data.currentTurn), last: null, flipping: null, winner: null, passed: false };
        });
        api.rerender(); api.refreshStatus(); return;
      }
      if (data.type === 'update') {
        var winner = data.winner || null;
        api.matchState = 'playing';
        api.setGame(function () {
          return {
            board: data.board, cur: data.currentTurn,
            legal: winner ? [] : legalMoves(data.board, data.currentTurn),
            last: data.last || null, flipping: data.flipped || null,
            winner: winner, passed: !!data.passed
          };
        });
        api.rerender(); api.refreshStatus();
        api.sfx(data.passed ? 'beep' : 'place');
        if (data.passed && !winner) api.pushSys('No legal move \u2014 turn skipped.');
        if (winner) {
          var mine = winner === api.mySymbol;
          api.sfx(winner === 'Draw' ? 'beep' : (mine ? 'win' : 'lose'));
          api.showWin(winner === 'Draw' ? 0 : (winner === 'X' ? 1 : 2));
        }
      }
    },

    status: function (g, api) {
      var h = api.h, cnt = counts(g.board);
      var scoreboard = h('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } }, [
        scorePill(h, api.P1, cnt.X, g.cur === 'X' && !g.winner),
        h('span', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 9, color: '#5b4f70' } }, 'VS'),
        scorePill(h, api.P2, cnt.O, g.cur === 'O' && !g.winner)
      ]);
      if (g.winner) return scoreboard;
      var turnCol, turnTxt;
      if (api.mode === 'online') {
        var mine = g.cur === api.mySymbol;
        turnCol = mine ? api.P1 : '#74618f'; turnTxt = mine ? '\u25b8 YOUR MOVE' : 'OPPONENT\u2026';
        if (api.matchState !== 'playing') return scoreboard;
      } else {
        turnCol = g.cur === 'X' ? api.P1 : api.P2; turnTxt = 'PLAYER ' + (g.cur === 'X' ? 1 : 2) + ' \u2014 PLACE';
      }
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } }, [scoreboard, api.pill(turnTxt, turnCol, turnCol !== '#74618f')]);
    },

    render: function (root, api) {
      var h = api.h, g = api.game;
      var rows = [];
      for (var r = 0; r < 8; r++) {
        var cells = [];
        for (var c = 0; c < 8; c++) cells.push(square(h, api, g, r, c));
        rows.push(h('div', { style: { display: 'flex' } }, cells));
      }
      root.appendChild(h('div', {
        style: {
          display: 'inline-flex', flexDirection: 'column', padding: 8, borderRadius: 14, gap: 3,
          background: 'linear-gradient(180deg,rgba(20,14,32,.9),rgba(8,6,14,.9))',
          border: '2px solid ' + ACCENT + '55', boxShadow: '0 0 34px ' + ACCENT + '22'
        }
      }, rows));
    }
  });

  function scorePill(h, color, n, active) {
    return h('div', { style: {
      display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px 4px 5px', borderRadius: 20,
      background: active ? color + '26' : 'transparent', border: '1px solid ' + (active ? color : 'transparent')
    } }, [
      h('div', { style: { width: 18, height: 18, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%,' + color + ',rgba(0,0,0,.5))', boxShadow: '0 0 8px ' + color } }),
      h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 12, color: color, textShadow: active ? '0 0 8px ' + color : 'none' } }, String(n))
    ]);
  }

  function square(h, api, g, r, c) {
    var v = g.board[r][c];
    var showHint = !g.winner && isLegal(g, r, c) &&
      (api.mode !== 'online' || g.cur === api.mySymbol);
    var isLast = g.last && g.last[0] === r && g.last[1] === c;
    var hintCol = (api.mode === 'online') ? api.P1 : (g.cur === 'X' ? api.P1 : api.P2);
    var clickable = showHint;

    var kids = [];
    if (v) kids.push(disc(h, api, v, isLast));
    else if (showHint) kids.push(h('div', {
      style: { width: 14, height: 14, borderRadius: '50%', border: '2px solid ' + hintCol, boxShadow: '0 0 8px ' + hintCol + '88', opacity: .85 }
    }));

    return h('div', {
      onClick: clickable ? function () { Arcade.games['reversi'].click(r, c, api); } : null,
      style: {
        width: 48, height: 48, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#221532', border: '1px solid rgba(0,0,0,.45)', boxShadow: 'inset 0 0 0 1px ' + ACCENT + '12',
        cursor: clickable ? 'pointer' : 'default', transition: '.1s'
      }
    }, kids);
  }

  function disc(h, api, v, isLast) {
    var col = v === 'X' ? api.P1 : api.P2;
    var deep = v === 'X' ? '#7a0d49' : '#7a5200';
    return h('div', {
      style: {
        width: 36, height: 36, borderRadius: '50%',
        background: 'radial-gradient(circle at 34% 28%,' + col + ',' + deep + ')',
        boxShadow: '0 0 10px ' + col + '88, inset 0 -3px 6px rgba(0,0,0,.45), inset 0 2px 4px rgba(255,255,255,.25)' +
                   (isLast ? ', 0 0 0 3px rgba(255,255,255,.65)' : ''),
        animation: 'popIn .18s'
      }
    });
  }

  /* ---- local turn advance with pass / end handling ---- */
  function advanceLocal(api, board, mover, last) {
    var next = opp(mover);
    var nextLegal = legalMoves(board, next);
    var winner = null, passed = false, cur = next;
    if (!nextLegal.length) {
      // opponent must pass; does the mover still have a move?
      var moverLegal = legalMoves(board, mover);
      if (!moverLegal.length) {
        var cnt = counts(board);
        winner = cnt.X === cnt.O ? 'Draw' : (cnt.X > cnt.O ? 'X' : 'O');
      } else {
        cur = mover; nextLegal = moverLegal; passed = true;
      }
    }
    api.setGame(function () {
      return { board: board, cur: cur, legal: winner ? [] : nextLegal, last: last.at, flipping: last.flipped, winner: winner, passed: passed };
    });
    api.rerender();
    if (passed) api.pushSys('Player ' + (next === 'X' ? 1 : 2) + ' has no move \u2014 turn skipped.');
    if (winner) api.endRound(winner === 'Draw' ? 0 : winner);
  }
})();

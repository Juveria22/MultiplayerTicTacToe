/* ============================================================
   Checkers (English draughts) - local 2P + online.

   LOCAL  : rules run client-side; mutate state and rerender.
   ONLINE : the server is authoritative. We send {from,to} steps
            and apply the board it broadcasts back. Multi-jumps
            continue with the same piece (server sends `continues`).

   Rules: men move/attack diagonally forward, kings both ways.
   Captures are MANDATORY. A capture that can continue must
   continue (multi-jump). Reaching the far row crowns a king and
   ends the turn. No legal moves = you lose.

   Board cell codes: '' empty | 'x'/'X' player-1 man/king
                              | 'o'/'O' player-2 man/king
   X = Player 1 (pink, bottom, moves up)  · O = Player 2 (amber, top)
   ============================================================ */
(function () {
  var ACCENT = '#39ff8b';

  /* ---------- rules engine (shared shape with the server) ---------- */
  function ownerOf(v) { return !v ? null : (v === 'x' || v === 'X') ? 'X' : 'O'; }
  function isKing(v) { return v === 'X' || v === 'O'; }
  function opp(s) { return s === 'X' ? 'O' : 'X'; }
  function inB(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function moveDirs(v) {
    if (v === 'x') return [[-1, -1], [-1, 1]];
    if (v === 'o') return [[1, -1], [1, 1]];
    return [[-1, -1], [-1, 1], [1, -1], [1, 1]]; // kings
  }
  function pieceJumps(board, r, c) {
    var v = board[r][c]; if (!v) return [];
    var me = ownerOf(v), out = [];
    moveDirs(v).forEach(function (d) {
      var mr = r + d[0], mc = c + d[1], lr = r + 2 * d[0], lc = c + 2 * d[1];
      if (inB(lr, lc) && board[lr][lc] === '' && inB(mr, mc)) {
        var mid = board[mr][mc];
        if (mid && ownerOf(mid) === opp(me)) out.push({ to: [lr, lc], cap: [mr, mc] });
      }
    });
    return out;
  }
  function pieceSimple(board, r, c) {
    var v = board[r][c]; if (!v) return [];
    var out = [];
    moveDirs(v).forEach(function (d) {
      var nr = r + d[0], nc = c + d[1];
      if (inB(nr, nc) && board[nr][nc] === '') out.push({ to: [nr, nc] });
    });
    return out;
  }
  function playerHasJump(board, sym) {
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++)
      if (ownerOf(board[r][c]) === sym && pieceJumps(board, r, c).length) return true;
    return false;
  }
  function playerHasMove(board, sym) {
    if (playerHasJump(board, sym)) return true;
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++)
      if (ownerOf(board[r][c]) === sym && pieceSimple(board, r, c).length) return true;
    return false;
  }
  // legal destinations for one piece, honouring mandatory capture
  function legalFor(board, r, c) {
    var v = board[r][c]; if (!v) return [];
    if (playerHasJump(board, ownerOf(v))) return pieceJumps(board, r, c);
    return pieceSimple(board, r, c);
  }
  function promote(board, r, c) {
    var v = board[r][c];
    if (v === 'x' && r === 0) { board[r][c] = 'X'; return true; }
    if (v === 'o' && r === 7) { board[r][c] = 'O'; return true; }
    return false;
  }
  // move a piece one step (simple or jump); mutates board; returns info
  function applyStep(board, fr, fc, tr, tc) {
    var v = board[fr][fc];
    board[tr][tc] = v; board[fr][fc] = '';
    var jumped = Math.abs(tr - fr) === 2;
    if (jumped) board[(fr + tr) / 2][(fc + tc) / 2] = '';
    var promoted = promote(board, tr, tc);
    var again = jumped && !promoted && pieceJumps(board, tr, tc).length > 0;
    return { jumped: jumped, promoted: promoted, again: again };
  }
  function freshBoard() {
    var b = [];
    for (var r = 0; r < 8; r++) {
      var row = [];
      for (var c = 0; c < 8; c++) {
        var play = (r + c) % 2 === 1;
        row.push(play && r < 3 ? 'o' : play && r > 4 ? 'x' : '');
      }
      b.push(row);
    }
    return b;
  }
  function cloneBoard(b) { return b.map(function (row) { return row.slice(); }); }
  function isDest(g, r, c) { return (g.dests || []).some(function (d) { return d.to[0] === r && d.to[1] === c; }); }

  Arcade.registerGame('checkers', {
    meta: { name: 'CHECKERS', accent: ACCENT },
    online: true,

    fresh: function () {
      return { board: freshBoard(), cur: 'X', sel: null, dests: [], chain: false, winner: null };
    },

    click: function (r, c, api) {
      var g = api.game; if (!g || g.winner) return;

      // ----- ONLINE: server is authoritative -----
      if (api.mode === 'online') {
        if (api.matchState !== 'playing') return;
        if (g.cur !== api.mySymbol) { api.sfx('error'); return; }
        var vo = g.board[r][c];
        if (!g.chain && ownerOf(vo) === api.mySymbol) {
          var lo = legalFor(g.board, r, c);
          if (!lo.length) { api.sfx('error'); return; }
          api.sfx('hover');
          api.setGame(function (s) { return Object.assign({}, s, { sel: [r, c], dests: lo }); });
          api.rerender(); return;
        }
        if (g.sel && isDest(g, r, c)) {
          api.send({ game: 'checkers', type: 'move', from: g.sel, to: [r, c] });
          api.setGame(function (s) { return Object.assign({}, s, { sel: null, dests: [] }); });
          api.rerender(); return;
        }
        api.sfx('error'); return;
      }

      // ----- LOCAL -----
      var v = g.board[r][c];
      if (!g.chain && ownerOf(v) === g.cur) {
        var legal = legalFor(g.board, r, c);
        if (!legal.length) { api.sfx('error'); return; }
        api.sfx('hover');
        api.setGame(function (s) { return Object.assign({}, s, { sel: [r, c], dests: legal }); });
        api.rerender(); return;
      }
      if (g.sel && isDest(g, r, c)) { doLocalMove(api, g.sel, [r, c]); return; }
      api.sfx('error');
    },

    onServer: function (data, api) {
      if (data.game !== 'checkers') return;
      if (data.type === 'init') {
        api.mySymbol = data.symbol; api.matchState = 'playing'; api.hideWaiting();
        api.setGame(function () {
          return { board: data.board, cur: data.currentTurn, sel: null, dests: [], chain: false, winner: null };
        });
        api.rerender(); api.refreshStatus(); return;
      }
      if (data.type === 'update') {
        api.matchState = 'playing';
        var cont = data.continues;
        var ns = {
          board: data.board, cur: data.currentTurn,
          winner: data.winner ? (data.winner === 'Draw' ? 'Draw' : data.winner) : null,
          sel: null, dests: [], chain: false
        };
        if (cont && data.currentTurn === api.mySymbol && !ns.winner) {
          ns.sel = cont; ns.dests = pieceJumps(data.board, cont[0], cont[1]); ns.chain = true;
        }
        api.setGame(function () { return ns; });
        api.rerender(); api.refreshStatus();
        api.sfx(data.captured ? 'place' : 'drop');
        if (ns.winner) {
          if (ns.winner === 'Draw') api.sfx('beep');
          else api.sfx(ns.winner === api.mySymbol ? 'win' : 'lose');
          api.showWin(ns.winner === 'Draw' ? 0 : (ns.winner === 'X' ? 1 : 2));
        }
      }
    },

    status: function (g, api) {
      if (api.mode === 'online' && api.matchState === 'playing' && !g.winner) {
        var mine = g.cur === api.mySymbol;
        return api.pill(mine ? '\u25b8 YOUR TURN' : 'OPPONENT\u2026', mine ? api.P1 : '#74618f', mine);
      }
      return null; // local: default P1/P2 turn pill
    },

    render: function (root, api) {
      var h = api.h, g = api.game;
      var rows = [];
      for (var r = 0; r < 8; r++) {
        var squares = [];
        for (var c = 0; c < 8; c++) {
          squares.push(square(h, g, api, r, c));
        }
        rows.push(h('div', { style: { display: 'flex' } }, squares));
      }
      root.appendChild(h('div', {
        style: {
          display: 'inline-flex', flexDirection: 'column',
          padding: 10, borderRadius: 14, background: 'linear-gradient(180deg,rgba(20,14,32,.9),rgba(8,6,14,.9))',
          border: '2px solid ' + ACCENT + '55', boxShadow: '0 0 30px ' + ACCENT + '22'
        }
      }, rows));
    }
  });

  function square(h, g, api, r, c) {
    var play = (r + c) % 2 === 1;
    var v = g.board[r][c];
    var sel = g.sel && g.sel[0] === r && g.sel[1] === c;
    var dest = isDest(g, r, c);
    var destObj = dest ? g.dests.find(function (d) { return d.to[0] === r && d.to[1] === c; }) : null;
    var clickable = play && !g.winner;

    var kids = [];
    if (v) kids.push(piece(h, api, v));
    else if (dest) {
      var cap = destObj && destObj.cap;
      kids.push(h('div', {
        style: cap
          ? { width: 20, height: 20, borderRadius: '50%', border: '3px solid ' + ACCENT, boxShadow: '0 0 12px ' + ACCENT, boxSizing: 'border-box' }
          : { width: 15, height: 15, borderRadius: '50%', background: ACCENT, opacity: .8, boxShadow: '0 0 10px ' + ACCENT }
      }));
    }

    return h('div', {
      onClick: clickable ? function () { Arcade.games['checkers'].click(r, c, api); } : null,
      style: {
        width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: play ? '#0e0a1a' : '#221532',
        boxShadow: sel ? ('inset 0 0 0 3px ' + ACCENT + ', inset 0 0 14px ' + ACCENT + '66') : 'none',
        cursor: clickable ? 'pointer' : 'default', transition: '.1s'
      }
    }, kids);
  }

  function piece(h, api, v) {
    var isX = ownerOf(v) === 'X';
    var col = isX ? api.P1 : api.P2;
    var deep = isX ? '#7a0d49' : '#7a5200';
    var king = isKing(v);
    return h('div', {
      style: {
        width: 34, height: 34, borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 30%,' + col + ',' + deep + ')',
        boxShadow: '0 0 10px ' + col + ', inset 0 0 6px rgba(0,0,0,.45)',
        border: '2px solid rgba(255,255,255,' + (king ? '.6' : '.14') + ')',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: '.12s', animation: 'popIn .18s'
      }
    }, king ? h('span', { style: { fontSize: 15, lineHeight: 1, color: 'rgba(0,0,0,.55)', textShadow: '0 0 5px rgba(255,255,255,.7)' } }, '\u2605') : null);
  }

  function doLocalMove(api, from, to) {
    var g = api.game;
    var board = cloneBoard(g.board);
    var res = applyStep(board, from[0], from[1], to[0], to[1]);
    api.sfx(res.jumped ? 'place' : 'drop');
    if (res.again) {
      var nj = pieceJumps(board, to[0], to[1]);
      api.setGame(function (s) { return Object.assign({}, s, { board: board, sel: [to[0], to[1]], dests: nj, chain: true }); });
      api.rerender(); return;
    }
    var next = opp(g.cur);
    var winner = playerHasMove(board, next) ? null : g.cur;
    api.setGame(function (s) {
      return Object.assign({}, s, { board: board, cur: winner ? g.cur : next, sel: null, dests: [], chain: false, winner: winner });
    });
    api.rerender();
    if (winner) api.endRound(winner);
  }
})();

/* ============================================================
   Connect Four - local 2P.
   To take it online: set online:true, send {game:'connect-four',
   type:'move', col} when api.mode==='online', and apply the
   server's broadcast in an onServer() handler (mirror tic-tac-toe.js).
   ============================================================ */
(function () {
  function check(grid, r, c, p) {
    var dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (var i = 0; i < dirs.length; i++) {
      var dr = dirs[i][0], dc = dirs[i][1], cells = [[r, c]], s;
      for (s = 1; s < 4; s++) { var nr = r + dr * s, nc = c + dc * s; if (grid[nr] && grid[nr][nc] === p) cells.push([nr, nc]); else break; }
      for (s = 1; s < 4; s++) { var pr = r - dr * s, pc = c - dc * s; if (grid[pr] && grid[pr][pc] === p) cells.push([pr, pc]); else break; }
      if (cells.length >= 4) return cells;
    }
    return null;
  }

  // map server symbol 'X'/'O' -> player number 1/2
  function symNum(s) { return s === 'O' ? 2 : 1; }
  // map a grid cell '' | 'X' | 'O' -> 0 | 1 | 2
  function symNum0(s) { return s === 'X' ? 1 : s === 'O' ? 2 : 0; }

  Arcade.registerGame('connect-four', {
    meta: { name: 'CONNECT 4', accent: '#ffb000' },
    online: true,

    fresh: function () {
      return { grid: Array.from({ length: 6 }, function () { return Array(7).fill(0); }), cur: 1, winner: null, winCells: [] };
    },

    drop: function (col, api) {
      var g = api.game; if (!g || g.winner) return;
      if (api.matchState !== 'playing') return;

      // ----- ONLINE: server is authoritative -----
      if (api.mode === 'online') {
        if (g.cur !== symNum(api.mySymbol)) { api.sfx('error'); return; }
        if (g.grid[0][col]) { api.sfx('error'); return; } // column full
        api.send({ game: 'connect-four', type: 'move', col: col });
        return;
      }

      // ----- LOCAL -----
      var grid = g.grid.map(function (r) { return r.slice(); });
      var row = -1; for (var r = 5; r >= 0; r--) if (!grid[r][col]) { row = r; break; }
      if (row < 0) { api.sfx('error'); return; }
      grid[row][col] = g.cur; api.sfx('drop');
      var win = check(grid, row, col, g.cur);
      var ng = Object.assign({}, g, { grid: grid });
      var result = null;
      if (win) { ng.winner = g.cur; ng.winCells = win; result = g.cur; }
      else if (grid.every(function (rr) { return rr.every(function (c) { return c; }); })) { ng.winner = 'Draw'; result = 0; }
      else ng.cur = g.cur === 1 ? 2 : 1;
      api.setGame(ng); api.rerender();
      if (result !== null) api.endRound(result);
    },

    onServer: function (data, api) {
      if (data.game !== 'connect-four') return;
      if (data.type === 'init') {
        api.mySymbol = data.symbol; api.matchState = 'playing'; api.hideWaiting();
        api.setGame({ grid: data.grid.map(function (r) { return r.map(symNum0); }), cur: symNum(data.currentTurn), winner: null, winCells: [] });
        api.rerender(); api.refreshStatus();
      }
      if (data.type === 'update') {
        var grid = data.grid.map(function (r) { return r.map(symNum0); });
        var winCells = data.winCells || [];
        var winner = data.winner ? (data.winner === 'Draw' ? 'Draw' : symNum(data.winner)) : null;
        api.matchState = 'playing';
        api.setGame({ grid: grid, cur: symNum(data.currentTurn), winner: winner, winCells: winCells });
        api.rerender(); api.refreshStatus();
        if (data.winner) {
          if (data.winner === 'Draw') api.sfx('beep');
          else api.sfx(data.winner === api.mySymbol ? 'win' : 'lose');
          api.showWin(data.winner === 'Draw' ? 0 : symNum(data.winner));
        }
      }
    },

    status: function (g, api) {
      if (api.mode === 'online' && api.matchState === 'playing' && !g.winner) {
        var mine = g.cur === symNum(api.mySymbol);
        return api.pill(mine ? '\u25b8 YOUR TURN' : 'OPPONENT\u2026', mine ? api.P2 : '#74618f', mine);
      }
      return null;
    },

    render: function (root, api) {
      var h = api.h, g = api.game, cols = [];
      for (var c = 0; c < 7; c++) {
        var cells = [];
        for (var r = 0; r < 6; r++) {
          var v = g.grid[r][c];
          var isWin = g.winCells && g.winCells.some(function (w) { return w[0] === r && w[1] === c; });
          var col = v === 1 ? api.P1 : api.P2;
          cells.push(h('div', { style: {
            width: 52, height: 52, borderRadius: '50%',
            background: v ? 'radial-gradient(circle at 35% 30%, ' + col + ', ' + (v === 1 ? '#7a0d49' : '#7a5200') + ')' : 'rgba(8,6,15,.7)',
            boxShadow: v ? '0 0 ' + (isWin ? 22 : 10) + 'px ' + col + ', inset 0 0 6px rgba(0,0,0,.5)' : 'inset 0 0 8px rgba(0,0,0,.6)',
            border: isWin ? '2px solid #fff' : '2px solid rgba(45,226,255,.2)', transition: '.15s', animation: v ? 'popIn .2s' : 'none'
          } }));
        }
        (function (colIndex) {
          cols.push(h('div', {
            onClick: function () { Arcade.games['connect-four'].drop(colIndex, api); },
            onMouseEnter: function () { if (!g.winner) api.sfx('hover'); },
            onMouseOver: function (e) { e.currentTarget.style.background = 'rgba(45,226,255,.08)'; },
            onMouseOut: function (e) { e.currentTarget.style.background = 'transparent'; },
            style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 4px', borderRadius: 10, cursor: g.winner ? 'default' : 'pointer', transition: '.12s' }
          }, cells));
        })(c);
      }
      root.appendChild(h('div', { style: {
        display: 'flex', gap: 6, padding: 16, borderRadius: 16,
        background: 'linear-gradient(180deg,rgba(45,20,70,.6),rgba(20,10,35,.6))',
        border: '2px solid rgba(45,226,255,.25)', boxShadow: '0 0 30px rgba(45,226,255,.12)'
      } }, cols));
    }
  });
})();

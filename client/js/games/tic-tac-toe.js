/* ============================================================
   Tic-Tac-Toe — the reference module for ONLINE wiring.

   LOCAL play  : mutate state here and call api.rerender().
   ONLINE play : send the move to the server and let onServer()
                 apply the authoritative board it broadcasts back.
   ============================================================ */
(function () {
  var WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

  function checkWin(b) {
    for (var i = 0; i < WINS.length; i++) {
      var l = WINS[i];
      if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { w: b[l[0]], line: l };
    }
    return b.every(function (x) { return x; }) ? { w: 'Draw', line: [] } : null;
  }

  Arcade.registerGame('tic-tac-toe', {
    meta: { name: 'TIC TAC TOE', accent: '#ff2d9b' },
    online: true,

    fresh: function () { return { board: Array(9).fill(''), cur: 'X', winner: null, line: [] }; },

    click: function (i, api) {
      var g = api.game; if (!g || g.winner) return;
      if (api.matchState !== 'playing') return;

      // ----- ONLINE: server is authoritative -----
      if (api.mode === 'online') {
        if (g.cur !== api.mySymbol) { api.sfx('error'); return; }
        api.send({ game: 'tic-tac-toe', type: 'move', row: Math.floor(i / 3), col: i % 3 });
        return;
      }

      // ----- LOCAL -----
      if (g.board[i]) { api.sfx('error'); return; }
      var board = g.board.slice(); board[i] = g.cur;
      var res = checkWin(board);
      api.sfx('place');
      var ng = Object.assign({}, g, { board: board });
      if (res) { ng.winner = res.w; ng.line = res.line; }
      else ng.cur = g.cur === 'X' ? 'O' : 'X';
      api.setGame(ng); api.rerender();
      if (res) api.endRound(res.w === 'Draw' ? 0 : (res.w === 'X' ? 1 : 2));
    },

    onServer: function (data, api) {
      if (data.game !== 'tic-tac-toe') return;
      if (data.type === 'init') { api.mySymbol = data.symbol; api.matchState = 'playing'; api.hideWaiting(); api.rerender(); api.refreshStatus(); }
      if (data.type === 'update') {
        var flat = data.board.flat();
        var g = Object.assign({}, api.game || {}, {
          board: flat, cur: data.currentTurn, winner: data.winner,
          line: (data.winningLine || []).map(function (rc) { return rc[0] * 3 + rc[1]; })
        });
        api.matchState = 'playing'; api.setGame(g); api.rerender(); api.refreshStatus();
        if (data.winner) {
          if (data.winner === 'Draw') api.sfx('beep');
          else api.sfx(data.winner === api.mySymbol ? 'win' : 'lose');
          api.showWin(data.winner);
        }
      }
    },

    status: function (g, api) {
      if (api.mode === 'online' && api.matchState === 'playing' && !g.winner) {
        var mine = g.cur === api.mySymbol;
        return api.pill(mine ? '▸ YOUR TURN' : 'OPPONENT…', mine ? api.P1 : '#74618f', mine);
      }
      return null; // fall back to default turn pill
    },

    render: function (root, api) {
      var h = api.h, g = api.game;
      var cells = g.board.map(function (v, i) {
        var isWin = g.line && g.line.indexOf(i) !== -1;
        var col = v === 'X' ? api.P1 : api.P2;
        return h('div', {
          onClick: function () { Arcade.games['tic-tac-toe'].click(i, api); },
          onMouseEnter: function () { if (!v && !g.winner) api.sfx('hover'); },
          style: {
            width: 96, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Press Start 2P',monospace", fontSize: 40, cursor: v || g.winner ? 'default' : 'pointer',
            color: col, background: isWin ? 'rgba(255,255,255,.08)' : 'rgba(8,6,15,.55)',
            border: '2px solid ' + (isWin ? col : 'rgba(255,45,155,.28)'), borderRadius: 12,
            textShadow: v ? '0 0 16px ' + col : 'none', boxShadow: isWin ? '0 0 22px ' + col : 'none',
            transition: '.15s', animation: v ? 'popIn .25s' : 'none'
          }
        }, v);
      });
      root.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3,96px)', gap: 10, padding: 14, borderRadius: 18, background: 'rgba(0,0,0,.25)' } }, cells));
    }
  });
})();

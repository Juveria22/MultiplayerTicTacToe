/* ============================================================
   Dots & Boxes — local 2P + online.

   LOCAL  : rules run client-side; draw an edge, claim any box it
            closes, and if you closed one you move AGAIN.
   ONLINE : the server is authoritative. We send {kind,r,c}; it
            validates, claims boxes, keeps/passes the turn, detects
            the end, and broadcasts the full grid + whose turn it is.

   Rules: players take turns drawing one edge between two adjacent
   dots. Completing the 4th side of a 1x1 box claims it (and grants
   another move). When every box is claimed, most boxes wins (ties
   possible). Board is N x N boxes = (N+1) x (N+1) dots.

   Edge codes: h[r][c]  horizontal, r in 0..N , c in 0..N-1
               v[r][c]  vertical,   r in 0..N-1, c in 0..N
               value ''  undrawn | 'X' player-1 | 'O' player-2
   ============================================================ */
(function () {
  var ACCENT = '#39ff8b';
  var NR = 7;                      // boxes tall
  var NC = 13;                     // boxes wide (wider than tall)

  /* ---------- rules engine (shared shape with the server) ---------- */
  function opp(s) { return s === 'X' ? 'O' : 'X'; }
  function makeGrid(rows, cols) {
    var g = [];
    for (var r = 0; r < rows; r++) { var row = []; for (var c = 0; c < cols; c++) row.push(''); g.push(row); }
    return g;
  }
  function freshState() {
    return {
      h: makeGrid(NR + 1, NC), v: makeGrid(NR, NC + 1), boxes: makeGrid(NR, NC),
      cur: 'X', winner: null, last: null
    };
  }
  function cloneState(s) {
    return {
      h: s.h.map(function (r) { return r.slice(); }),
      v: s.v.map(function (r) { return r.slice(); }),
      boxes: s.boxes.map(function (r) { return r.slice(); }),
      cur: s.cur, winner: s.winner, last: s.last
    };
  }
  function edgeDrawn(s, kind, r, c) { return (kind === 'h' ? s.h : s.v)[r][c] !== ''; }
  function boxComplete(s, r, c) { return s.h[r][c] && s.h[r + 1][c] && s.v[r][c] && s.v[r][c + 1]; }
  function boxesForEdge(kind, r, c) { return kind === 'h' ? [[r - 1, c], [r, c]] : [[r, c - 1], [r, c]]; }
  // draw edge; claim any newly-completed box for sym; returns #claimed
  function applyEdge(s, kind, r, c, sym) {
    (kind === 'h' ? s.h : s.v)[r][c] = sym;
    var claimed = 0;
    boxesForEdge(kind, r, c).forEach(function (b) {
      var br = b[0], bc = b[1];
      if (br < 0 || bc < 0 || br >= NR || bc >= NC) return;
      if (!s.boxes[br][bc] && boxComplete(s, br, bc)) { s.boxes[br][bc] = sym; claimed++; }
    });
    return claimed;
  }
  function isFull(s) {
    for (var r = 0; r < NR; r++) for (var c = 0; c < NC; c++) if (!s.boxes[r][c]) return false;
    return true;
  }
  function counts(s) {
    var x = 0, o = 0;
    for (var r = 0; r < NR; r++) for (var c = 0; c < NC; c++) { if (s.boxes[r][c] === 'X') x++; else if (s.boxes[r][c] === 'O') o++; }
    return { X: x, O: o };
  }

  Arcade.registerGame('dots', {
    meta: { name: 'DOTS & BOXES', accent: ACCENT },
    online: true,

    fresh: function () { return freshState(); },

    click: function (kind, r, c, api) {
      var g = api.game; if (!g || g.winner) return;

      // ----- ONLINE -----
      if (api.mode === 'online') {
        if (api.matchState !== 'playing') return;
        if (g.cur !== api.mySymbol) { api.sfx('error'); return; }
        if (edgeDrawn(g, kind, r, c)) { api.sfx('error'); return; }
        api.send({ game: 'dots', type: 'move', kind: kind, r: r, c: c });
        return;
      }

      // ----- LOCAL -----
      if (edgeDrawn(g, kind, r, c)) { api.sfx('error'); return; }
      var s = cloneState(g);
      var claimed = applyEdge(s, kind, r, c, g.cur);
      s.last = { kind: kind, r: r, c: c };
      api.sfx(claimed ? 'place' : 'drop');
      if (isFull(s)) {
        var cnt = counts(s);
        s.winner = cnt.X === cnt.O ? 'Draw' : (cnt.X > cnt.O ? 'X' : 'O');
      } else {
        s.cur = claimed ? g.cur : opp(g.cur);
      }
      api.setGame(function () { return s; });
      api.rerender(); api.refreshStatus();
      if (s.winner) api.endRound(s.winner === 'Draw' ? 0 : s.winner);
    },

    onServer: function (data, api) {
      if (data.game !== 'dots') return;
      if (data.type === 'init') {
        api.mySymbol = data.symbol; api.matchState = 'playing'; api.hideWaiting();
        api.setGame(function () { return { h: data.h, v: data.v, boxes: data.boxes, cur: data.currentTurn, winner: null, last: null }; });
        api.rerender(); api.refreshStatus(); return;
      }
      if (data.type === 'update') {
        api.matchState = 'playing';
        var winner = data.winner || null;
        api.setGame(function () { return { h: data.h, v: data.v, boxes: data.boxes, cur: data.currentTurn, winner: winner, last: data.last || null }; });
        api.rerender(); api.refreshStatus();
        api.sfx(data.claimed ? 'place' : 'drop');
        if (winner) {
          api.sfx(winner === 'Draw' ? 'beep' : (winner === api.mySymbol ? 'win' : 'lose'));
          api.showWin(winner === 'Draw' ? 0 : (winner === 'X' ? 1 : 2));
        }
      }
    },

    status: function (g, api) {
      var h = api.h;
      var c2 = counts(g);
      var scoreboard = h('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } }, [
        scorePill(h, api.P1, c2.X, g.cur === 'X' && !g.winner),
        h('span', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 9, color: '#5b4f70' } }, 'VS'),
        scorePill(h, api.P2, c2.O, g.cur === 'O' && !g.winner)
      ]);
      if (g.winner) return scoreboard;
      var turnCol, turnTxt;
      if (api.mode === 'online') {
        var mine = g.cur === api.mySymbol;
        turnCol = mine ? api.P1 : '#74618f'; turnTxt = mine ? '\u25b8 YOUR MOVE' : 'OPPONENT\u2026';
        if (api.matchState !== 'playing') return scoreboard;
      } else {
        turnCol = g.cur === 'X' ? api.P1 : api.P2; turnTxt = 'PLAYER ' + (g.cur === 'X' ? 1 : 2) + ' \u2014 DRAW';
      }
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } }, [scoreboard, api.pill(turnTxt, turnCol, turnCol !== '#74618f')]);
    },

    render: function (root, api) {
      var h = api.h, g = api.game;
      var GAP = 44, PAD = 20, DOT = 10, LINE = 6, HIT = 22;
      var w = PAD * 2 + NC * GAP, hgt = PAD * 2 + NR * GAP;
      var mine = api.mode !== 'online' || g.cur === api.mySymbol;
      var curCol = g.cur === 'X' ? api.P1 : api.P2;
      var kids = [];

      function colOf(sym) { return sym === 'X' ? api.P1 : api.P2; }
      function dotX(c) { return PAD + c * GAP; }
      function dotY(r) { return PAD + r * GAP; }

      // ---- box fills (behind the lines) ----
      for (var br = 0; br < NR; br++) for (var bc = 0; bc < NC; bc++) {
        var owner = g.boxes[br][bc];
        kids.push(h('div', {
          key: 'b' + br + '-' + bc,
          style: {
            position: 'absolute', left: dotX(bc) + LINE / 2, top: dotY(br) + LINE / 2,
            width: GAP - LINE, height: GAP - LINE, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: owner ? colOf(owner) + '26' : 'transparent', transition: 'background .25s',
            boxShadow: owner ? 'inset 0 0 16px ' + colOf(owner) + '33' : 'none'
          }
        }, owner ? h('span', {
          style: { fontFamily: "'Press Start 2P',monospace", fontSize: 11, color: colOf(owner), textShadow: '0 0 8px ' + colOf(owner) }
        }, owner === 'X' ? '1' : '2') : null));
      }

      // ---- edges ----
      function edgeEl(kind, r, c) {
        var drawn = edgeDrawn(g, kind, r, c);
        var owner = (kind === 'h' ? g.h : g.v)[r][c];
        var isLast = g.last && g.last.kind === kind && g.last.r === r && g.last.c === c;
        var clickable = !drawn && !g.winner && mine;
        var horiz = kind === 'h';
        var lineCol = drawn ? colOf(owner) : (clickable ? curCol + '2e' : 'rgba(255,255,255,.06)');
        // hit zone centered on the edge
        var hx = horiz ? dotX(c) + DOT / 2 : dotX(c) - HIT / 2;
        var hy = horiz ? dotY(r) - HIT / 2 : dotY(r) + DOT / 2;
        var hw = horiz ? GAP - DOT : HIT;
        var hh = horiz ? HIT : GAP - DOT;
        return h('div', {
          key: kind + r + '-' + c,
          onClick: clickable ? function () { Arcade.games['dots'].click(kind, r, c, api); } : null,
          style: {
            position: 'absolute', left: hx, top: hy, width: hw, height: hh,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: clickable ? 'pointer' : 'default'
          }
        }, h('div', {
          style: {
            width: horiz ? '100%' : LINE, height: horiz ? LINE : '100%', borderRadius: LINE,
            background: lineCol,
            boxShadow: drawn ? '0 0 10px ' + colOf(owner) + 'aa' : 'none',
            outline: isLast ? '2px solid rgba(255,255,255,.7)' : 'none',
            transition: 'background .15s, box-shadow .15s'
          }
        }));
      }
      for (var r = 0; r <= NR; r++) for (var c = 0; c < NC; c++) kids.push(edgeEl('h', r, c));
      for (var r2 = 0; r2 < NR; r2++) for (var c2 = 0; c2 <= NC; c2++) kids.push(edgeEl('v', r2, c2));

      // ---- dots (on top) ----
      for (var dr = 0; dr <= NR; dr++) for (var dc = 0; dc <= NC; dc++) {
        kids.push(h('div', {
          key: 'd' + dr + '-' + dc,
          style: {
            position: 'absolute', left: dotX(dc) - DOT / 2, top: dotY(dr) - DOT / 2,
            width: DOT, height: DOT, borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 30%,#fff,' + ACCENT + ')',
            boxShadow: '0 0 6px ' + ACCENT + 'aa'
          }
        }));
      }

      root.appendChild(h('div', {
        style: {
          position: 'relative', width: w, height: hgt, padding: 0, borderRadius: 14,
          background: 'linear-gradient(180deg,rgba(20,14,32,.9),rgba(8,6,14,.9))',
          border: '2px solid ' + ACCENT + '55', boxShadow: '0 0 30px ' + ACCENT + '22'
        }
      }, kids));
    }
  });

  function scorePill(h, color, n, active) {
    return h('div', { style: {
      display: 'flex', alignItems: 'center', gap: 8, padding: '4px 11px 4px 5px', borderRadius: 20,
      background: active ? color + '26' : 'transparent', border: '1px solid ' + (active ? color : 'transparent')
    } }, [
      h('div', { style: { width: 16, height: 16, borderRadius: 4, background: color, boxShadow: '0 0 8px ' + color } }),
      h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 12, color: color, textShadow: active ? '0 0 8px ' + color : 'none' } }, String(n))
    ]);
  }
})();

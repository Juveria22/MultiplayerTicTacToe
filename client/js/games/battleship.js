/* ============================================================
   Battleship - local 2P (hot-seat) + online.

   PLACEMENT : each player lays out a 5-ship fleet on a 10x10
               grid (rotate + click, or RANDOMIZE). Local play
               hides the board behind a "pass the device" screen
               between the two players.
   FIRING    : players alternate firing one shot at the enemy
               grid. Hit / miss / sink / win. The server is the
               authority online (it holds both fleets and scores
               every shot); locally the module keeps both boards.

   Board cell: '' water | 1..5 ship id.
   Shots cell: '' unknown | 'M' miss | 'H' hit.
   X = Player 1 (pink) · O = Player 2 (amber)
   ============================================================ */
(function () {
  var N = 10;
  var FIRE_CELL = 19; // fire-phase cell size; both panes derive from it so they stay side-by-side
  var GRID_PAD = 4;
  var ACCENT = '#ff2d9b';
  var SHIPS = [
    { id: 1, size: 5, name: 'CARRIER' },
    { id: 2, size: 4, name: 'BATTLESHIP' },
    { id: 3, size: 3, name: 'CRUISER' },
    { id: 4, size: 3, name: 'SUB' },
    { id: 5, size: 2, name: 'DESTROYER' }
  ];
  function shipById(id) { for (var i = 0; i < SHIPS.length; i++) if (SHIPS[i].id === id) return SHIPS[i]; return null; }

  /* ---------- board helpers (shared shape with server) ---------- */
  function emptyGrid() { var g = []; for (var r = 0; r < N; r++) { var row = []; for (var c = 0; c < N; c++) row.push(''); g.push(row); } return g; }
  function cloneGrid(g) { return g.map(function (r) { return r.slice(); }); }
  function shipCells(r, c, size, orient) {
    var cells = [];
    for (var i = 0; i < size; i++) cells.push(orient === 'H' ? [r, c + i] : [r + i, c]);
    return cells;
  }
  function canPlace(board, r, c, size, orient) {
    var cells = shipCells(r, c, size, orient);
    for (var i = 0; i < cells.length; i++) {
      var rr = cells[i][0], cc = cells[i][1];
      if (rr < 0 || rr >= N || cc < 0 || cc >= N) return false;
      if (board[rr][cc] !== '') return false;
    }
    return true;
  }
  function stamp(board, r, c, size, orient, id) {
    shipCells(r, c, size, orient).forEach(function (p) { board[p[0]][p[1]] = id; });
  }
  function randomizeBoard() {
    var board = emptyGrid();
    SHIPS.forEach(function (s) {
      var placed = false, guard = 0;
      while (!placed && guard++ < 500) {
        var orient = Math.random() < 0.5 ? 'H' : 'V';
        var r = Math.floor(Math.random() * N), c = Math.floor(Math.random() * N);
        if (canPlace(board, r, c, s.size, orient)) { stamp(board, r, c, s.size, orient, s.id); placed = true; }
      }
    });
    return board;
  }
  function fleetFrom(board) {
    return SHIPS.map(function (s) {
      var cells = [];
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (board[r][c] === s.id) cells.push([r, c]);
      return { id: s.id, size: s.size, name: s.name, hits: 0, sunk: false };
    });
  }
  // count a hit against a fleet; returns ship name if it just sank, else null
  function registerHit(fleet, board, r, c) {
    var id = board[r][c]; if (!id) return { hit: false, sunk: null };
    var ship = null; for (var i = 0; i < fleet.length; i++) if (fleet[i].id === id) ship = fleet[i];
    ship.hits++;
    var sunk = null;
    if (ship.hits >= ship.size) { ship.sunk = true; sunk = ship.name; }
    return { hit: true, sunk: sunk };
  }
  function allSunk(fleet) { return fleet.every(function (s) { return s.sunk; }); }
  function shipsLeft(fleet) { return fleet.filter(function (s) { return !s.sunk; }).length; }

  Arcade.registerGame('battleship', {
    meta: { name: 'BATTLESHIP', accent: ACCENT },
    online: true,

    fresh: function (api) {
      if (api && api.mode === 'online') {
        return {
          net: true, phase: 'place',
          myBoard: emptyGrid(), myShots: emptyGrid(), enemyShots: emptyGrid(),
          myFleet: null, placeIdx: 0, orient: 'H', hover: null,
          placed: false, oppReady: false, myTurn: false,
          lastResult: null, winner: null
        };
      }
      return {
        net: false, phase: 'place', placer: 1,
        boards: { 1: emptyGrid(), 2: emptyGrid() },
        shots: { 1: emptyGrid(), 2: emptyGrid() },
        fleets: { 1: null, 2: null },
        placeIdx: 0, orient: 'H', hover: null,
        fire: 1, peek: false, handoff: null, lastResult: null, winner: null
      };
    },

    peekFleet: function (api) {
      api.sfx('click');
      api.setGame(function (s) { return Object.assign({}, s, { peek: !s.peek }); });
      api.rerender();
    },
    handoffContinue: function (api) {
      api.sfx('go');
      api.setGame(function (s) { return Object.assign({}, s, { fire: s.handoff, handoff: null, peek: false }); });
      api.rerender();
      api.refreshStatus();
    },

    /* ---- controls invoked from the rendered UI ---- */
    rotate: function (api) { var g = api.game; api.sfx('click'); api.setGame(function (s) { return Object.assign({}, s, { orient: s.orient === 'H' ? 'V' : 'H' }); }); api.rerender(); },
    randomize: function (api) {
      api.sfx('drop');
      var b = randomizeBoard();
      if (api.game.net) api.setGame(function (s) { return Object.assign({}, s, { myBoard: b, placeIdx: SHIPS.length, hover: null }); });
      else { var p = api.game.placer; api.setGame(function (s) { var bs = Object.assign({}, s.boards); bs[p] = b; return Object.assign({}, s, { boards: bs, placeIdx: SHIPS.length, hover: null }); }); }
      api.rerender();
    },
    resetPlace: function (api) {
      api.sfx('click');
      if (api.game.net) api.setGame(function (s) { return Object.assign({}, s, { myBoard: emptyGrid(), placeIdx: 0, hover: null }); });
      else { var p = api.game.placer; api.setGame(function (s) { var bs = Object.assign({}, s.boards); bs[p] = emptyGrid(); return Object.assign({}, s, { boards: bs, placeIdx: 0, hover: null }); }); }
      api.rerender();
    },
    placeAt: function (r, c, api) {
      var g = api.game; if (g.placeIdx >= SHIPS.length) return;
      var ship = SHIPS[g.placeIdx];
      var board = g.net ? g.myBoard : g.boards[g.placer];
      if (!canPlace(board, r, c, ship.size, g.orient)) { api.sfx('error'); return; }
      var nb = cloneGrid(board); stamp(nb, r, c, ship.size, g.orient, ship.id);
      api.sfx('place');
      if (g.net) api.setGame(function (s) { return Object.assign({}, s, { myBoard: nb, placeIdx: s.placeIdx + 1 }); });
      else { var p = g.placer; api.setGame(function (s) { var bs = Object.assign({}, s.boards); bs[p] = nb; return Object.assign({}, s, { boards: bs, placeIdx: s.placeIdx + 1 }); }); }
      api.rerender();
    },
    hoverAt: function (r, c, api) {
      var g = api.game; if (g.phase !== 'place') return;
      if (g.hover && g.hover[0] === r && g.hover[1] === c) return;
      api.setGame(function (s) { return Object.assign({}, s, { hover: [r, c] }); });
      api.rerender();
    },
    confirmPlace: function (api) {
      var g = api.game; if (g.placeIdx < SHIPS.length) return;
      api.sfx('go');
      if (g.net) {
        api.send({ game: 'battleship', type: 'place', board: g.myBoard });
        api.setGame(function (s) { return Object.assign({}, s, { placed: true, myFleet: fleetFrom(s.myBoard), hover: null }); });
        api.rerender();
        return;
      }
      // ----- LOCAL -----
      var p = g.placer;
      var fleet = fleetFrom(g.boards[p]);
      if (p === 1) {
        api.setGame(function (s) { var f = Object.assign({}, s.fleets); f[1] = fleet; return Object.assign({}, s, { fleets: f, phase: 'pass', placeIdx: 0, orient: 'H', hover: null }); });
      } else {
        api.setGame(function (s) { var f = Object.assign({}, s.fleets); f[2] = fleet; return Object.assign({}, s, { fleets: f, phase: 'fire', fire: 1, hover: null }); });
      }
      api.rerender();
    },
    passReady: function (api) {
      api.sfx('go');
      api.setGame(function (s) { return Object.assign({}, s, { phase: 'place', placer: 2 }); });
      api.rerender();
    },

    /* ---- firing ---- */
    fireAt: function (r, c, api) {
      var g = api.game; if (g.phase !== 'fire' || g.winner) return;

      // ----- ONLINE -----
      if (g.net) {
        if (!g.myTurn) { api.sfx('error'); return; }
        if (g.myShots[r][c] !== '') { api.sfx('error'); return; }
        api.send({ game: 'battleship', type: 'fire', r: r, c: c });
        api.setGame(function (s) { return Object.assign({}, s, { myTurn: false }); });
        return;
      }

      // ----- LOCAL -----
      var shooter = g.fire, target = shooter === 1 ? 2 : 1;
      if (g.shots[shooter][r][c] !== '') { api.sfx('error'); return; }
      var board = g.boards[target];
      var shots = cloneGrid(g.shots[shooter]);
      var fleet = g.fleets[target].map(function (s) { return Object.assign({}, s); });
      var hit = board[r][c] !== '';
      shots[r][c] = hit ? 'H' : 'M';
      var sunk = null, win = false;
      if (hit) { var res = registerHit(fleet, board, r, c); sunk = res.sunk; win = allSunk(fleet); }
      api.sfx(hit ? 'place' : 'drop');
      var next = win ? null : (shooter === 1 ? 2 : 1);
      api.setGame(function (s) {
        var sh = Object.assign({}, s.shots); sh[shooter] = shots;
        var fl = Object.assign({}, s.fleets); fl[target] = fleet;
        // the shot stays on screen (and the turn stays put) until this player hands off
        return Object.assign({}, s, { shots: sh, fleets: fl, handoff: next, lastResult: { by: shooter, r: r, c: c, hit: hit, sunk: sunk }, winner: win ? shooter : null });
      });
      api.rerender();
      if (win) api.endRound(shooter);
    },

    /* ---- network ---- */
    onServer: function (data, api) {
      if (data.game !== 'battleship') return;
      var g = api.game;
      if (data.type === 'init') {
        api.mySymbol = data.symbol; api.matchState = 'playing'; api.hideWaiting();
        api.rerender(); api.refreshStatus(); return;
      }
      if (data.type === 'oppReady') { api.setGame(function (s) { return Object.assign({}, s, { oppReady: true }); }); api.rerender(); return; }
      if (data.type === 'begin') {
        api.setGame(function (s) { return Object.assign({}, s, { phase: 'fire', myTurn: data.currentTurn === api.mySymbol }); });
        api.rerender(); api.refreshStatus(); return;
      }
      if (data.type === 'result') { // my shot resolved
        api.setGame(function (s) {
          var sh = cloneGrid(s.myShots); sh[data.r][data.c] = data.hit ? 'H' : 'M';
          return Object.assign({}, s, { myShots: sh, myTurn: data.currentTurn === api.mySymbol, lastResult: { mine: true, hit: data.hit, sunk: data.sunk }, winner: data.win ? 'me' : s.winner });
        });
        api.sfx(data.hit ? 'place' : 'drop');
        api.rerender(); api.refreshStatus();
        if (data.win) api.showWin(api.mySymbol === 'X' ? 1 : 2);
        return;
      }
      if (data.type === 'incoming') { // opponent shot at me
        api.setGame(function (s) {
          var es = cloneGrid(s.enemyShots); es[data.r][data.c] = data.hit ? 'H' : 'M';
          return Object.assign({}, s, { enemyShots: es, myTurn: data.currentTurn === api.mySymbol, lastResult: { mine: false, hit: data.hit, sunk: data.sunk }, winner: data.lose ? 'them' : s.winner });
        });
        api.sfx(data.hit ? 'lose' : 'beep');
        api.rerender(); api.refreshStatus();
        if (data.lose) api.showWin(api.mySymbol === 'X' ? 2 : 1);
        return;
      }
      if (data.type === 'reset') {
        api.setGame(function () { return Arcade.games['battleship'].fresh(api); });
        api.rerender(); api.refreshStatus(); return;
      }
    },

    status: function (g, api) {
      var h = api.h;
      if (g.net) {
        if (g.phase === 'place') return api.pill(g.placed ? (g.oppReady ? 'BOTH READY\u2026' : 'WAITING FOR ENEMY\u2026') : 'PLACE YOUR FLEET', '#74618f', false);
        if (g.phase === 'fire' && !g.winner) return api.pill(g.myTurn ? '\u25b8 FIRE!' : 'ENEMY AIMING\u2026', g.myTurn ? api.P1 : '#74618f', g.myTurn);
        return null;
      }
      if (g.phase === 'place') return colorPill(h, api, g.placer, 'PLACE FLEET');
      if (g.phase === 'pass') return null;
      if (g.phase === 'fire' && !g.winner) return colorPill(h, api, g.fire, g.handoff ? 'SHOT LOGGED' : 'FIRE!');
      return null;
    },

    render: function (root, api) { render(root, api); }
  });

  function colorPill(h, api, who, label) {
    var c = who === 1 ? api.P1 : api.P2;
    return api.pill('PLAYER ' + who + ' - ' + label, c, true);
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function render(root, api) {
    var g = api.game;
    if (g.phase === 'pass') { root.appendChild(passScreen(api)); return; }
    if (g.phase === 'place') { root.appendChild(placeScreen(api)); return; }
    root.appendChild(fireScreen(api));
  }

  function panel(h, kids) {
    return h('div', { style: {
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
      padding: 20, borderRadius: 16, background: 'linear-gradient(180deg,rgba(20,14,32,.9),rgba(8,6,14,.9))',
      border: '2px solid ' + ACCENT + '44', boxShadow: '0 0 30px ' + ACCENT + '18'
    } }, kids);
  }
  function label(h, txt, color) {
    return h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 10, letterSpacing: 1, color: color || '#9d88ba' } }, txt);
  }
  function btn(h, api, txt, color, onClick, disabled) {
    return h('div', {
      onClick: disabled ? null : function () { onClick(api); },
      style: {
        fontFamily: "'Press Start 2P',monospace", fontSize: 9, letterSpacing: 1,
        padding: '10px 14px', borderRadius: 9, cursor: disabled ? 'default' : 'pointer',
        color: disabled ? '#5b4f70' : '#08060f', background: disabled ? 'rgba(255,255,255,.06)' : color,
        boxShadow: disabled ? 'none' : '0 0 14px ' + color + '88', transition: '.12s', userSelect: 'none'
      }
    }, txt);
  }

  function passScreen(api) {
    var h = api.h, c = api.P2;
    return panel(h, [
      label(h, 'PASS THE DEVICE', '#74618f'),
      h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 15, color: c, textShadow: '0 0 16px ' + c, textAlign: 'center', lineHeight: 1.7 } }, 'PLAYER 2'),
      h('div', { style: { fontSize: 12.5, color: '#9d88ba', textAlign: 'center', maxWidth: 300, lineHeight: 1.6 } }, 'Player 1 has hidden their fleet. Player 2 - take the device and place yours (no peeking!).'),
      btn(h, api, 'I\u2019M READY \u25b8', c, Arcade.games['battleship'].passReady)
    ]);
  }

  function placeScreen(api) {
    var h = api.h, g = api.game;
    var mine = g.net ? g.myBoard : g.boards[g.placer];
    var who = g.net ? (api.mySymbol === 'X' ? 1 : 2) : g.placer;
    var col = who === 1 ? api.P1 : api.P2;
    var done = g.placeIdx >= SHIPS.length;
    var waiting = g.net && g.placed;

    // preview cells for the ship being placed
    var preview = null, previewOK = false;
    if (!done && g.hover && !waiting) {
      var ship = SHIPS[g.placeIdx];
      previewOK = canPlace(mine, g.hover[0], g.hover[1], ship.size, g.orient);
      preview = {}; shipCells(g.hover[0], g.hover[1], ship.size, g.orient).forEach(function (p) { if (p[0] >= 0 && p[0] < N && p[1] >= 0 && p[1] < N) preview[p[0] + ',' + p[1]] = true; });
    }

    var grid = boardGrid(api, {
      board: mine, shots: null, showShips: true,
      onCell: waiting ? null : function (r, c) { Arcade.games['battleship'].placeAt(r, c, api); },
      onHover: waiting ? null : function (r, c) { Arcade.games['battleship'].hoverAt(r, c, api); },
      preview: preview, previewOK: previewOK, accent: col
    });

    // ship checklist
    var list = SHIPS.map(function (s, i) {
      var placed = i < g.placeIdx;
      var active = i === g.placeIdx && !done;
      return h('div', { style: {
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 7,
        background: active ? col + '22' : 'transparent', border: '1px solid ' + (active ? col : 'transparent')
      } }, [
        h('div', { style: { display: 'flex', gap: 2 } }, Array.from({ length: s.size }, function () {
          return h('div', { style: { width: 9, height: 9, borderRadius: 2, background: placed ? '#4a3d5e' : (active ? col : '#2a2038') } });
        })),
        h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 7.5, color: placed ? '#5b4f70' : (active ? col : '#9d88ba'), letterSpacing: .5 } }, s.name + (placed ? ' \u2713' : ''))
      ]);
    });

    var controls = waiting
      ? [label(h, g.oppReady ? 'BOTH FLEETS READY - STAND BY' : 'WAITING FOR ENEMY FLEET\u2026', '#74618f')]
      : [
          h('div', { style: { display: 'flex', gap: 8 } }, [
            btn(h, api, g.orient === 'H' ? 'ROTATE \u2194' : 'ROTATE \u2195', '#2de2ff', Arcade.games['battleship'].rotate, done),
            btn(h, api, 'RANDOMIZE', '#b14bff', Arcade.games['battleship'].randomize),
            btn(h, api, 'RESET', '#ff5a5a', Arcade.games['battleship'].resetPlace)
          ]),
          btn(h, api, done ? 'CONFIRM FLEET \u25b8' : 'PLACE ' + (SHIPS.length - g.placeIdx) + ' MORE', ACCENT, Arcade.games['battleship'].confirmPlace, !done)
        ];

    return panel(h, [
      colorPill(h, api, who, done ? 'FLEET SET' : 'PLACE FLEET'),
      h('div', { style: { display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'center' } }, [
        h('div', { onMouseLeave: waiting ? null : function () { Arcade.games['battleship'].hoverAt(-1, -1, api); } }, grid),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 168 } }, list)
      ]),
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 } }, controls)
    ]);
  }

  function fireScreen(api) {
    var h = api.h, g = api.game;
    var targetShots, myFleetBoard, myFleetShots, canFire, shooterCol, shooterNo;

    if (g.net) {
      targetShots = g.myShots;
      myFleetBoard = g.myBoard; myFleetShots = g.enemyShots;
      canFire = g.myTurn && !g.winner;
      shooterNo = api.mySymbol === 'X' ? 1 : 2; shooterCol = shooterNo === 1 ? api.P1 : api.P2;
      var targetBoard = null;
    } else {
      var shooter = g.fire, target = shooter === 1 ? 2 : 1;
      targetShots = g.shots[shooter];
      myFleetBoard = g.boards[shooter]; myFleetShots = g.shots[target];
      canFire = !g.winner && !g.handoff;
      shooterNo = shooter; shooterCol = shooter === 1 ? api.P1 : api.P2;
      var targetBoard = g.boards[target];
    }

    // target grid: fire here (show only shots, never enemy ships)
    var target = boardGrid(api, {
      board: targetBoard, shots: targetShots, showShips: false, sunkOnly: true,
      onCell: canFire ? function (r, c) { Arcade.games['battleship'].fireAt(r, c, api); } : null,
      onHover: null, accent: shooterCol, small: true, crosshair: canFire
    });
    // own fleet: show ships + incoming shots
    var fleet = boardGrid(api, {
      board: myFleetBoard, shots: myFleetShots, showShips: true,
      onCell: null, onHover: null, accent: '#2de2ff', small: true
    });
    // local hot-seat: keep your fleet hidden behind a cover until you tap to peek
    var fleetPane;
    if (!g.net && !g.peek) {
      fleetPane = fleetCover(h, api, shooterNo, myFleetShots);
    } else if (!g.net) {
      fleetPane = gridPane(h, 'YOUR FLEET - CLICK TO HIDE', '#2de2ff',
        h('div', { onClick: function () { Arcade.games['battleship'].peekFleet(api); }, style: { cursor: 'pointer' } }, fleet));
    } else {
      fleetPane = gridPane(h, 'YOUR FLEET', '#2de2ff', fleet);
    }

    var res = g.lastResult;
    var resTxt = '', resCol = '#9d88ba';
    if (res) {
      if (g.net) {
        if (res.mine) { resTxt = res.sunk ? 'YOU SANK THEIR ' + res.sunk + '!' : (res.hit ? 'DIRECT HIT!' : 'SPLASH - MISS'); resCol = res.hit ? '#39ff8b' : '#74618f'; }
        else { resTxt = res.sunk ? 'THEY SANK YOUR ' + res.sunk + '!' : (res.hit ? 'ENEMY HIT YOUR SHIP!' : 'ENEMY MISSED'); resCol = res.hit ? '#ff5a5a' : '#39ff8b'; }
      } else {
        var by = res.by;
        resTxt = res.sunk ? ('PLAYER ' + by + ' SANK THE ' + res.sunk + '!') : (res.hit ? ('PLAYER ' + by + ' - HIT!') : ('PLAYER ' + by + ' - MISS'));
        resCol = res.hit ? '#39ff8b' : '#74618f';
      }
    }

    // top row: shot result + (local) the handoff control, so it is always in view
    var topRow = [h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 9, letterSpacing: 1, color: resCol, textShadow: res && res.hit ? '0 0 10px ' + resCol : 'none' } }, resTxt)];
    if (!g.net && g.handoff) {
      topRow.push(btn(h, api, 'PLAYER ' + g.handoff + ' - CONTINUE \u25b8', g.handoff === 1 ? api.P1 : api.P2, Arcade.games['battleship'].handoffContinue));
    }
    return h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 } }, [
      h('div', { style: { minHeight: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'center' } }, topRow),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap', justifyContent: 'center' } }, [
        gridPane(h, canFire ? 'TARGET - FIRE!' : 'TARGET', shooterCol, target),
        fleetPane
      ])
    ]);
  }

  // covered fleet: same footprint as the grid, tap to reveal (local hot-seat privacy)
  function fleetCover(h, api, shooterNo, myFleetShots) {
    var col = shooterNo === 1 ? api.P1 : api.P2;
    var incoming = 0;
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (myFleetShots[r][c] === 'H') incoming++;
    var side = FIRE_CELL * N + GRID_PAD * 2; // matches the grid footprint exactly
    return gridPane(h, 'YOUR FLEET', '#2de2ff',
      h('div', {
        onClick: function () { Arcade.games['battleship'].peekFleet(api); },
        style: {
          width: side, height: side, boxSizing: 'border-box', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
          borderRadius: 8, border: '2px dashed ' + col + '99',
          background: 'repeating-linear-gradient(45deg,rgba(20,14,32,.96),rgba(20,14,32,.96) 10px,rgba(45,30,66,.96) 10px,rgba(45,30,66,.96) 20px)',
          boxShadow: 'inset 0 0 24px rgba(0,0,0,.7)', transition: '.12s'
        }
      }, [
        h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 8.5, letterSpacing: 1, color: col, textShadow: '0 0 8px ' + col, textAlign: 'center', lineHeight: 1.6 } }, 'PLAYER ' + shooterNo + ' - CLICK TO'),
        h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 8.5, letterSpacing: 1, color: col, textShadow: '0 0 8px ' + col, textAlign: 'center' } }, 'REVEAL FLEET'),
        h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 6.5, letterSpacing: .5, color: '#74618f', textAlign: 'center', lineHeight: 1.7, marginTop: 4 } }, incoming ? (incoming + ' HIT' + (incoming > 1 ? 'S' : '') + ' TAKEN') : 'HIDDEN FROM RIVAL')
      ])
    );
  }

  function gridPane(h, title, color, grid) {
    return h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 } }, [
      h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 8, letterSpacing: 1, color: color, textShadow: '0 0 8px ' + color } }, title),
      grid
    ]);
  }

  // opts: { board, shots, showShips, onCell, onHover, preview, previewOK, accent, small, crosshair }
  function boardGrid(api, opts) {
    var h = api.h;
    var sz = opts.small ? FIRE_CELL : 30, pad = GRID_PAD;
    var rows = [];
    for (var r = 0; r < N; r++) {
      var cells = [];
      for (var c = 0; c < N; c++) cells.push(cell(h, api, opts, r, c, sz));
      rows.push(h('div', { style: { display: 'flex' } }, cells));
    }
    var kids = rows;
    if ((opts.showShips || opts.sunkOnly) && opts.board) {
      extractShips(opts.board).forEach(function (sp) {
        var sunk = opts.shots ? sp.cells.every(function (p) { return opts.shots[p[0]][p[1]] === 'H'; }) : false;
        if (opts.sunkOnly && !sunk) return;
        kids = kids.concat(h('div', {
          style: {
            position: 'absolute', pointerEvents: 'none',
            left: (pad + sp.minC * sz) + 'px', top: (pad + sp.minR * sz) + 'px',
            width: ((sp.orient === 'H' ? sp.size : 1) * sz) + 'px',
            height: ((sp.orient === 'H' ? 1 : sp.size) * sz) + 'px'
          },
          html: shipSVG(sp.size, sp.orient, sunk)
        }));
      });
    }
    return h('div', { style: {
      position: 'relative', display: 'inline-flex', flexDirection: 'column', padding: pad, borderRadius: 8,
      background: 'rgba(4,8,20,.85)', border: '2px solid ' + opts.accent + '55', boxShadow: 'inset 0 0 20px rgba(0,0,0,.6)'
    } }, kids);
  }

  function cell(h, api, opts, r, c, sz) {
    var shot = opts.shots ? opts.shots[r][c] : '';
    var isPrev = opts.preview && opts.preview[r + ',' + c];
    var interactive = !!opts.onCell;
    var bg = 'rgba(20,40,70,.32)';       // water
    var content = null;
    if (shot === 'H') { bg = 'rgba(120,20,36,.5)'; content = smoke(h, sz); }
    else if (shot === 'M') { content = missX(h, sz); }
    if (isPrev) bg = opts.previewOK ? 'rgba(57,255,139,.4)' : 'rgba(255,90,90,.4)';

    return h('div', {
      onClick: interactive ? function () { opts.onCell(r, c); } : null,
      onMouseOver: opts.onHover ? function () { opts.onHover(r, c); } : null,
      style: {
        width: sz, height: sz, boxSizing: 'border-box',
        border: '1px solid ' + opts.accent + '22',
        background: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: interactive ? (opts.crosshair ? 'crosshair' : 'pointer') : 'default',
        transition: '.08s'
      }
    }, content);
  }
  // hit: a smoke puff rising off the water
  function smoke(h, sz) {
    return h('div', { style: {
      width: sz * 0.86, height: sz * 0.86, borderRadius: '50%',
      background: 'radial-gradient(circle at 50% 62%, rgba(255,196,96,.95) 0 18%, rgba(190,110,80,.8) 34%, rgba(150,146,150,.62) 58%, rgba(150,146,150,0) 78%)',
      filter: 'blur(.6px)', boxShadow: '0 0 12px rgba(255,140,70,.5)'
    } });
  }
  // miss: pixel X
  function missX(h, sz) {
    return h('div', { style: {
      fontFamily: "'Press Start 2P',monospace", fontSize: sz * 0.44, lineHeight: 1,
      color: '#6f86a6', opacity: .95, userSelect: 'none'
    } }, '\u2715');
  }
  function dot(h, color, big) {
    return h('div', { style: {
      width: big ? 12 : 8, height: big ? 12 : 8, borderRadius: '50%',
      background: color, boxShadow: big ? '0 0 10px ' + color : 'none'
    } });
  }

  // group same-id cells into a ship {minR,minC,size,orient,cells}
  function extractShips(board) {
    var map = {};
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var id = board[r][c];
      if (id) (map[id] = map[id] || []).push([r, c]);
    }
    return Object.keys(map).map(function (id) {
      var cells = map[id];
      var minR = Math.min.apply(null, cells.map(function (p) { return p[0]; }));
      var minC = Math.min.apply(null, cells.map(function (p) { return p[1]; }));
      var horiz = cells.every(function (p) { return p[0] === cells[0][0]; });
      return { id: +id, minR: minR, minC: minC, size: cells.length, orient: horiz ? 'H' : 'V', cells: cells };
    });
  }

  // line-art ship silhouette; L cells long, along the given orientation
  // top-down (bird's-eye) line-art ship; L cells long along the orientation axis.
  // axis coord `a` runs bow<-stern; cross coord `x` is 0..100 with centreline at 50.
  function shipSVG(L, orient, sunk) {
    var W = L * 100;
    var vb = orient === 'H' ? ('0 0 ' + W + ' 100') : ('0 0 100 ' + W);
    var col = sunk ? '#ff6b6b' : '#a9c6e0';
    var glow = sunk ? '#ff5a5a' : '#3f6486';
    function pt(a, x) { return orient === 'H' ? (a + ',' + x) : (x + ',' + a); }
    var bow = W - 6, hw = 30;                 // bow tip near the far end, hull half-width
    // hull: flat stern, straight sides, tapered pointed bow
    var hull = 'M' + pt(12, 50 - hw) + ' L' + pt(bow - 42, 50 - hw) +
               ' L' + pt(bow, 50) + ' L' + pt(bow - 42, 50 + hw) +
               ' L' + pt(12, 50 + hw) + ' Q' + pt(4, 50 + hw) + ' ' + pt(4, 50) +
               ' Q' + pt(4, 50 - hw) + ' ' + pt(12, 50 - hw) + ' Z';
    var ac = W / 2;
    // superstructure block amidships
    var sw = Math.min(46, W * 0.13), sh = 17;
    var bridge = 'M' + pt(ac - sw, 50 - sh) + ' L' + pt(ac + sw, 50 - sh) +
                 ' L' + pt(ac + sw, 50 + sh) + ' L' + pt(ac - sw, 50 + sh) + ' Z';
    // centreline deck seam
    var deck = 'M' + pt(14, 50) + ' L' + pt(bow - 20, 50);
    // gun turrets: circle + short barrel pointing toward the bow, spaced along the deck
    var guns = '';
    var slots = L >= 4 ? [0.20, 0.80] : (L >= 3 ? [0.22] : [0.24]);
    slots.forEach(function (f) {
      var a = 12 + (bow - 12) * f;
      guns += '<circle ' + (orient === 'H' ? ('cx="' + a + '" cy="50"') : ('cx="50" cy="' + a + '"')) + ' r="8"/>';
      guns += '<path d="M' + pt(a, 50) + ' L' + pt(a + 20, 50) + '" stroke-width="3"/>';
    });
    return '<svg viewBox="' + vb + '" preserveAspectRatio="none" width="100%" height="100%" fill="none" stroke="' + col +
      '" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" style="filter:drop-shadow(0 0 3px ' + glow + ')">' +
      '<path d="' + hull + '"/>' +
      '<path d="' + deck + '" stroke-width="2.5" opacity="0.5"/>' +
      '<path d="' + bridge + '" stroke-width="4"/>' + guns + '</svg>';
  }
})();

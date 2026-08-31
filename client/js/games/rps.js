/* ============================================================
   RPS Duel - best of five (first to 3).

   LOCAL : hotseat. P1 picks, then P2 picks, then reveal.
   ONLINE: both players pick simultaneously and secretly. The
           server collects both picks and broadcasts the reveal.
   ============================================================ */
(function () {
  var GLYPH = { rock: 'ROCK', paper: 'PAPER', scissors: 'SCISSORS' };
  function symNum(s) { return s === 'O' ? 2 : 1; }

  function beat(a, b) { if (a === b) return 0; var win = { rock: 'scissors', paper: 'rock', scissors: 'paper' }; return win[a] === b ? 1 : 2; }

  Arcade.registerGame('rps', {
    meta: { name: 'RPS DUEL', accent: '#2de2ff' },
    online: true,

    fresh: function () {
      // phase: pick (local p1) | pick2 (local p2) | choosing (online) | locked (online, waiting) | reveal
      return { cur: 1, p1: null, p2: null, phase: 'pick', scores: [0, 0], round: 1, last: null, oppReady: false };
    },

    pick: function (choice, api) {
      var g = api.game; if (!g) return;
      api.sfx('click');

      // ----- ONLINE -----
      if (api.mode === 'online') {
        if (g.phase !== 'choosing') return;
        api.setGame(Object.assign({}, g, { phase: 'locked', myPick: choice }));
        api.send({ game: 'rps', type: 'pick', choice: choice });
        api.rerender(); api.refreshStatus();
        return;
      }

      // ----- LOCAL -----
      if (g.phase === 'pick') { api.setGame(Object.assign({}, g, { p1: choice, phase: 'pick2' })); api.rerender(); }
      else if (g.phase === 'pick2') {
        var res = beat(g.p1, choice);
        var scores = g.scores.slice();
        if (res === 1) scores[0]++; else if (res === 2) scores[1]++;
        api.sfx(res === 0 ? 'beep' : 'match');
        var done = scores[0] === 3 || scores[1] === 3;
        api.setGame(Object.assign({}, g, { p2: choice, phase: 'reveal', scores: scores, last: res }));
        api.rerender();
        if (done) setTimeout(function () { api.showWin(scores[0] === 3 ? 1 : 2); }, 700);
      }
    },
    next: function (api) {
      var g = api.game;
      api.setGame(Object.assign({}, g, { p1: null, p2: null, phase: 'pick', round: g.round + 1, last: null }));
      api.rerender();
    },

    onServer: function (data, api) {
      if (data.game !== 'rps') return;
      if (data.type === 'init') {
        api.mySymbol = data.symbol; api.matchState = 'playing'; api.hideWaiting();
        api.setGame({ phase: 'choosing', myPick: null, p1: null, p2: null, scores: [data.scores.X, data.scores.O], last: null, round: 1, oppReady: false });
        api.rerender(); api.refreshStatus();
        return;
      }
      if (data.type === 'opponentReady') {
        api.setGame(Object.assign({}, api.game, { oppReady: true })); api.refreshStatus();
        return;
      }
      if (data.type === 'reveal') {
        var meX = api.mySymbol === 'X';
        var myPick = meX ? data.picks.X : data.picks.O;
        var oppPick = meX ? data.picks.O : data.picks.X;
        // 'last' in terms of P1/P2 for display: map result symbol -> 1/2/0
        var last = data.result === 'tie' ? 0 : symNum(data.result);
        api.sfx(data.result === 'tie' ? 'beep' : (data.result === api.mySymbol ? 'match' : 'beep'));
        api.setGame(Object.assign({}, api.game, {
          phase: 'reveal', p1: data.picks.X, p2: data.picks.O,
          myPick: myPick, oppPick: oppPick, scores: [data.scores.X, data.scores.O], last: last
        }));
        api.rerender();
        if (data.matchWinner) {
          setTimeout(function () { api.showWin(symNum(data.matchWinner)); }, 800);
        } else {
          setTimeout(function () {
            if (api.gameId !== 'rps' || api.matchState !== 'playing') return;
            api.setGame(Object.assign({}, api.game, { phase: 'choosing', myPick: null, oppReady: false, last: null }));
            api.rerender(); api.refreshStatus();
          }, 2200);
        }
      }
    },

    status: function (g, api) {
      if (api.mode === 'online') {
        if (g.phase === 'choosing') return api.pill(g.oppReady ? 'OPPONENT READY - PICK!' : 'CHOOSE YOUR MOVE', '#2de2ff', true);
        if (g.phase === 'locked') return api.pill('LOCKED IN - WAITING…', '#74618f', false);
        if (g.phase === 'reveal') return api.pill('ROUND RESULT', '#2de2ff', true);
        return null;
      }
      if (g.phase === 'reveal') return api.pill('ROUND RESULT', '#2de2ff', true);
      return api.pill('PLAYER ' + (g.phase === 'pick' ? 1 : 2) + ' - CHOOSE', g.phase === 'pick' ? api.P1 : api.P2, true);
    },

    render: function (root, api) {
      var h = api.h, g = api.game, online = api.mode === 'online';

      var p1Label = online ? (api.mySymbol === 'X' ? 'YOU' : 'OPP') : 'P1';
      var p2Label = online ? (api.mySymbol === 'O' ? 'YOU' : 'OPP') : 'P2';

      var score = h('div', { style: { display: 'flex', gap: 26, marginBottom: 26, alignItems: 'center', justifyContent: 'center' } }, [
        h('div', { style: { textAlign: 'center' } }, [
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 8 } }, [api.avatar(1, 18), h('span', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 9, color: api.P1 } }, p1Label)]),
          h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 28, color: api.P1, textShadow: '0 0 14px ' + api.P1 } }, String(g.scores[0]))
        ]),
        h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 14, color: '#74618f' } }, 'VS'),
        h('div', { style: { textAlign: 'center' } }, [
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 8 } }, [api.avatar(2, 18), h('span', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 9, color: api.P2 } }, p2Label)]),
          h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 28, color: api.P2, textShadow: '0 0 14px ' + api.P2 } }, String(g.scores[1]))
        ])
      ]);

      var body;
      if (g.phase === 'reveal') {
        var leftPick = online ? g.myPick : g.p1;
        var rightPick = online ? g.oppPick : g.p2;
        var leftColor = online ? (api.mySymbol === 'X' ? api.P1 : api.P2) : api.P1;
        var rightColor = online ? (api.mySymbol === 'X' ? api.P2 : api.P1) : api.P2;
        var txt, tc;
        if (g.last === 0) { txt = 'TIE ROUND'; tc = '#74618f'; }
        else if (online) {
          var iWon = (g.last === symNum(api.mySymbol));
          txt = iWon ? 'YOU SCORE' : 'OPP SCORES'; tc = iWon ? api.P1 : api.P2;
        } else { txt = (g.last === 1 ? 'P1 SCORES' : 'P2 SCORES'); tc = g.last === 1 ? api.P1 : api.P2; }
        var kids = [
          h('div', { style: { display: 'flex', gap: 50, alignItems: 'center' } }, [
            h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 19, color: leftColor, textShadow: '0 0 16px ' + leftColor, filter: 'drop-shadow(0 0 16px ' + leftColor + ')', animation: 'popIn .3s' } }, GLYPH[leftPick]),
            h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 16, color: '#74618f' } }, '×'),
            h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 19, color: rightColor, textShadow: '0 0 16px ' + rightColor, filter: 'drop-shadow(0 0 16px ' + rightColor + ')', animation: 'popIn .3s' } }, GLYPH[rightPick])
          ]),
          h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 15, color: tc, textShadow: '0 0 14px ' + tc } }, txt)
        ];
        if (!online) kids.push(h('div', { onClick: function () { Arcade.games['rps'].next(api); }, style: { cursor: 'pointer', marginTop: 6, padding: '13px 22px', borderRadius: 10, background: '#2de2ff', color: '#08060f', fontFamily: "'Press Start 2P',monospace", fontSize: 10, boxShadow: '0 0 18px rgba(45,226,255,.5)' } }, 'NEXT ROUND ▸'));
        else kids.push(h('div', { style: { fontSize: 12, color: '#8c78a8' } }, 'Next round starting…'));
        body = h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 } }, kids);
      } else if (online && g.phase === 'locked') {
        body = h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 } }, [
          h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 17, color: (api.mySymbol === 'X' ? api.P1 : api.P2), textShadow: '0 0 16px ' + (api.mySymbol === 'X' ? api.P1 : api.P2) } }, GLYPH[g.myPick]),
          h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 11, color: '#74618f', animation: 'blink 1.2s infinite' } }, 'WAITING FOR OPPONENT…')
        ]);
      } else {
        // choosing (online) OR pick/pick2 (local)
        var who, wc, hint;
        if (online) { who = null; wc = api.mySymbol === 'X' ? api.P1 : api.P2; hint = 'Pick at the same time - first to 3 wins.'; }
        else { who = g.phase === 'pick' ? 1 : 2; wc = who === 1 ? api.P1 : api.P2; hint = g.phase === 'pick2' ? 'P1 has locked in. No peeking!' : 'Best of five - first to 3.'; }
        var kids2 = [
          h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 12, color: wc, textShadow: '0 0 12px ' + wc, animation: 'blink 1.2s infinite' } }, online ? 'CHOOSE YOUR MOVE' : 'PLAYER ' + who + ' - CHOOSE'),
          h('div', { style: { fontSize: 13, color: '#8c78a8' } }, hint),
          h('div', { style: { display: 'flex', gap: 18 } }, [['rock', 'ROCK'], ['paper', 'PAPER'], ['scissors', 'SCISSORS']].map(function (o) {
            return h('div', {
              onClick: function () { Arcade.games['rps'].pick(o[0], api); },
              onMouseEnter: function () { api.sfx('hover'); },
              onMouseOver: function (e) { e.currentTarget.style.borderColor = wc; e.currentTarget.style.boxShadow = '0 0 20px ' + wc; e.currentTarget.style.transform = 'translateY(-5px)'; },
              onMouseOut: function (e) { e.currentTarget.style.borderColor = wc + '55'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; },
              style: { cursor: 'pointer', width: 104, height: 104, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 8px', fontFamily: "'Press Start 2P',monospace", fontSize: 13, color: wc, background: 'rgba(8,6,15,.6)', border: '2px solid ' + wc + '55', transition: '.15s' }
            }, o[1]);
          }))
        ];
        body = h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 } }, kids2);
      }

      root.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 30px', minWidth: 420 } }, [score, body]));
    }
  });
})();

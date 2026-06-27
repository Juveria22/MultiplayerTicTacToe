/* ============================================================
   Memory — flip two cards; a match keeps your turn and scores.
   Most pairs when the board clears wins.

   LOCAL : the deck is shuffled and owned client-side.
   ONLINE: the SERVER owns the shuffle and validates every flip,
           so both players see the same layout. Faces are only
           revealed by the server as cards are turned over.
   ============================================================ */
(function () {
  var FACES = [['★','#ff2d9b'],['♦','#ffb000'],['▲','#2de2ff'],['●','#b14bff'],['♥','#ff5a5a'],['⬢','#39ff8b'],['✦','#ffd24d'],['◆','#7ad1ff']];
  function symNum(s) { return s === 'O' ? 2 : 1; }

  Arcade.registerGame('memory', {
    meta: { name: 'MEMORY', accent: '#b14bff' },
    online: true,

    fresh: function () {
      var deck = [];
      FACES.forEach(function (f, i) { deck.push({ id: i, face: f }, { id: i, face: f }); });
      for (var i = deck.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
      return { cards: deck.map(function (d, idx) { return { id: d.id, face: d.face, key: idx, flipped: false, matched: false }; }), cur: 1, flipped: [], scores: [0, 0], lock: false, winner: null };
    },

    // online cards are placeholders; faces arrive from the server on reveal
    freshOnline: function () {
      var cards = [];
      for (var i = 0; i < 16; i++) cards.push({ key: i, pair: null, face: null, flipped: false, matched: false });
      return { cards: cards, cur: 1, scores: [0, 0], lock: false, winner: null };
    },

    flip: function (idx, api) {
      var g = api.game; if (!g || g.lock) return;
      var card = g.cards[idx]; if (card.flipped || card.matched) return;

      // ----- ONLINE -----
      if (api.mode === 'online') {
        if (g.cur !== symNum(api.mySymbol)) { api.sfx('error'); return; }
        api.send({ game: 'memory', type: 'flip', idx: idx });
        return;
      }

      // ----- LOCAL -----
      api.sfx('flip');
      var cards = g.cards.map(function (c) { return Object.assign({}, c); });
      cards[idx].flipped = true;
      var flipped = g.flipped.concat([idx]);
      if (flipped.length < 2) { api.setGame(Object.assign({}, g, { cards: cards, flipped: flipped })); api.rerender(); return; }
      var a = flipped[0], b = flipped[1];
      if (cards[a].id === cards[b].id) {
        cards[a].matched = cards[b].matched = true;
        var scores = g.scores.slice(); scores[g.cur - 1]++;
        api.sfx('match');
        var done = cards.every(function (c) { return c.matched; });
        api.setGame(Object.assign({}, g, { cards: cards, flipped: [], scores: scores }));
        api.rerender();
        if (done) { var w = scores[0] === scores[1] ? 0 : (scores[0] > scores[1] ? 1 : 2); setTimeout(function () { api.showWin(w); }, 400); }
      } else {
        api.setGame(Object.assign({}, g, { cards: cards, flipped: flipped, lock: true }));
        api.rerender();
        setTimeout(function () {
          var g2 = api.game; var cc = g2.cards.map(function (c) { return Object.assign({}, c); });
          cc[a].flipped = false; cc[b].flipped = false;
          api.setGame(Object.assign({}, g2, { cards: cc, flipped: [], lock: false, cur: g2.cur === 1 ? 2 : 1 }));
          api.rerender(); api.refreshStatus();
        }, 850);
      }
    },

    onServer: function (data, api) {
      if (data.game !== 'memory') return;
      var g = api.game;
      function setCards(mut) {
        var cards = api.game.cards.map(function (c) { return Object.assign({}, c); });
        mut(cards); api.setGame(Object.assign({}, api.game, { cards: cards }));
      }
      if (data.type === 'init') {
        api.mySymbol = data.symbol; api.matchState = 'playing'; api.hideWaiting();
        var mod = Arcade.games['memory'];
        api.setGame(Object.assign(mod.freshOnline(), { cur: symNum(data.currentTurn), scores: [data.scores.X, data.scores.O] }));
        api.rerender(); api.refreshStatus();
        return;
      }
      if (data.type === 'reveal') {
        api.sfx('flip');
        setCards(function (cards) { cards[data.idx].pair = data.pair; cards[data.idx].face = FACES[data.pair]; cards[data.idx].flipped = true; });
        return;
      }
      if (data.type === 'matched') {
        api.sfx('match');
        setCards(function (cards) { data.idxs.forEach(function (i) { cards[i].matched = true; cards[i].flipped = true; }); });
        api.setGame(Object.assign({}, api.game, { scores: [data.scores.X, data.scores.O], cur: symNum(data.currentTurn) }));
        api.rerender(); api.refreshStatus();
        return;
      }
      if (data.type === 'hide') {
        setCards(function (cards) { data.idxs.forEach(function (i) { cards[i].flipped = false; cards[i].face = null; cards[i].pair = null; }); });
        api.setGame(Object.assign({}, api.game, { cur: symNum(data.currentTurn) }));
        api.rerender(); api.refreshStatus();
        return;
      }
      if (data.type === 'over') {
        var w = data.winner === 'Draw' ? 0 : symNum(data.winner);
        setTimeout(function () { api.showWin(w); }, 400);
        return;
      }
      if (data.type === 'restart') {
        var mod2 = Arcade.games['memory'];
        api.setGame(Object.assign(mod2.freshOnline(), { cur: symNum(data.currentTurn), scores: [data.scores.X, data.scores.O] }));
        api.matchState = 'playing'; api.rerender(); api.refreshStatus();
        return;
      }
    },

    status: function (g, api) {
      var h = api.h;
      if (api.mode === 'online') {
        var mine = g.cur === symNum(api.mySymbol);
        var myScore = api.mySymbol === 'X' ? g.scores[0] : g.scores[1];
        var oppScore = api.mySymbol === 'X' ? g.scores[1] : g.scores[0];
        return h('div', { style: { display: 'flex', gap: 16, alignItems: 'center' } }, [
          api.pill(mine ? '▸ YOUR TURN' : 'OPPONENT…', mine ? api.P1 : '#74618f', mine),
          h('span', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 10, color: '#9d88ba' } }, 'YOU ' + myScore + ' · OPP ' + oppScore)
        ]);
      }
      return h('div', { style: { display: 'flex', gap: 18, alignItems: 'center' } }, [
        h('span', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 11, color: api.P1, textShadow: g.cur === 1 ? '0 0 12px ' + api.P1 : 'none', opacity: g.cur === 1 ? 1 : .5 } }, 'P1  ' + g.scores[0]),
        h('span', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 11, color: api.P2, textShadow: g.cur === 2 ? '0 0 12px ' + api.P2 : 'none', opacity: g.cur === 2 ? 1 : .5 } }, 'P2  ' + g.scores[1])
      ]);
    },

    render: function (root, api) {
      var h = api.h, g = api.game;
      var cards = g.cards.map(function (c, idx) {
        var show = c.flipped || c.matched;
        var face = c.face || ['?', '#3a2a52'];
        return h('div', {
          onClick: function () { Arcade.games['memory'].flip(idx, api); },
          onMouseEnter: function () { if (!show) api.sfx('hover'); },
          style: {
            width: 72, height: 88, borderRadius: 10, cursor: show ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34,
            color: show ? face[1] : '#3a2a52', transition: '.2s',
            background: show ? 'rgba(8,6,15,.85)' : 'linear-gradient(150deg,rgba(60,30,90,.9),rgba(28,14,42,.9))',
            border: '2px solid ' + (show ? face[1] : 'rgba(177,75,255,.3)'),
            boxShadow: show ? '0 0 16px ' + face[1] : 'none', opacity: c.matched ? .55 : 1,
            textShadow: show ? '0 0 12px ' + face[1] : 'none'
          }
        }, show ? face[0] : '?');
      });
      root.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,72px)', gap: 10, padding: 16, borderRadius: 16, background: 'rgba(0,0,0,.25)' } }, cards));
    }
  });
})();

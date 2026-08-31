/* ============================================================
   Dress Up - neon stick-figure styling. A chill, no-points game.

   TWO characters. LOCAL 2P: one keyboard, a "⇄ SWITCH" button
   flips which figure you edit. ONLINE: X edits figure 0, O edits
   figure 1; both players see both figures and every change live,
   simultaneously.

   SLOTS: hair, shirt, pants, shoes, acc(essory). One item per slot
   (pick again to remove). Every slot AND the body has its own color
   - choose a PAINT target, then tap a neon swatch to recolor it.

   ONLINE PROTOCOL (build the server to match)
   -------------------------------------------
   client -> server, on any change:
     { game:'dressup', type:'dress', char:0|1, data:<charObject> }
   server -> the joining client:
     { game:'dressup', type:'init', symbol:'X'|'O', chars:[c0,c1] }
   server -> both clients, after any change:
     { game:'dressup', type:'update', chars:[c0,c1] }
   charObject = { body, hair,hairCol, shirt,shirtCol, pants,pantsCol,
                  shoes,shoesCol, acc,accCol }  (null item = nothing).
   Reject a 'dress' whose char index != the sender's own (X=0, O=1).
   Chat uses the shared { game, type:'chat', message }.
   ============================================================ */
(function () {
  // persisted home-screen avatars for P1 / P2 (this device)
  var AV_KEY = 'arcade_dressup_avatars';
  function loadAv() { try { return JSON.parse(localStorage.getItem(AV_KEY)) || [null, null]; } catch (e) { return [null, null]; } }
  function saveAv(arr) {
    try { localStorage.setItem(AV_KEY, JSON.stringify(arr)); } catch (e) {}
    try { window.dispatchEvent(new Event('arcade:avatars')); } catch (e) {}
  }

  var ITEMS = {
    hair:  [{ v: 'pony', label: 'PONYTAIL' }, { v: 'volume', label: 'VOLUME' }, { v: 'boy', label: 'BOY CUT' }],
    shirt: [{ v: 'girly', label: 'CUTE TOP' }, { v: 'tee', label: 'T-SHIRT' }, { v: 'long', label: 'LONG SLV' }],
    pants: [{ v: 'skirt', label: 'SKIRT' }, { v: 'pants', label: 'PANTS' }, { v: 'shorts', label: 'SHORTS' }],
    shoes: [{ v: 'heels', label: 'HEELS' }, { v: 'sneakers', label: 'SNEAKERS' }, { v: 'flops', label: 'FLIP FLOPS' }],
    acc:   [{ v: 'earrings', label: 'HOOPS' }, { v: 'sunglasses', label: 'SHADES' }, { v: 'matcha', label: 'MATCHA' }, { v: 'basket', label: 'BASKET' }, { v: 'badminton', label: 'BADMINTON' }]
  };
  var SLOTS = ['hair', 'shirt', 'pants', 'shoes', 'acc'];
  var COLKEY = { body: 'body', hair: 'hairCol', shirt: 'shirtCol', pants: 'pantsCol', shoes: 'shoesCol', acc: 'accCol' };
  var TARGETS = [['body', 'BODY'], ['hair', 'HAIR'], ['shirt', 'SHIRT'], ['pants', 'PANTS'], ['shoes', 'SHOES'], ['acc', 'ACCESS']];
  var COLORS = ['#39ff8b', '#2de2ff', '#ff2d9b', '#ffb000', '#b14bff', '#ff79c6', '#caff00', '#ff5a5a', '#ffffff'];

  /* ---- one piece -> svg inner markup (120x220 space), tinted `c` ---- */
  function piece(slot, v, c) {
    if (!v) return '';
    var f = ' fill="' + c + '" fill-opacity="0.22" stroke="' + c + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"';
    var fe = ' fill="' + c + '" fill-opacity="0.22" fill-rule="evenodd" stroke="' + c + '" stroke-width="2.5" stroke-linejoin="round"';
    var fl = ' fill="' + c + '" stroke="' + c + '" stroke-width="1.4"';
    var ln = ' fill="none" stroke="' + c + '" stroke-width="3" stroke-linecap="round"';
    var th = ' fill="none" stroke="' + c + '" stroke-width="1.6" stroke-linecap="round"';
    switch (v) {
      /* HAIR (head cx60 cy28 r13) */
      case 'pony':   return '<path d="M44,26 Q44,10 60,9 Q76,10 76,24 Q70,15 60,14 Q50,15 44,26 Z"' + f + '/><path d="M71,16 Q56,17 47,29 Q44,35 47,41 Q50,33 59,27 Q67,21 73,20 Z"' + f + '/><circle cx="73" cy="17" r="2.6"' + fl + '/><path d="M73,15 Q93,13 93,35 Q93,54 82,66 Q80,57 83,49 Q88,34 75,24 Q71,19 73,15 Z"' + f + '/><path d="M78,30 Q86,42 82,58"' + th + '/><path d="M48,29 Q43,22 48,16"' + th + '/>';
      case 'volume': return '<path d="M40,46 Q33,40 36,33 Q31,26 38,21 Q36,13 45,12 Q47,6 56,8 Q60,5 64,8 Q75,6 75,12 Q84,13 82,21 Q89,26 84,33 Q87,40 80,46 Q70,49 60,48 Q50,49 40,46 Z M48,28 a12,12 0 1 0 24,0 a12,12 0 1 0 -24,0 Z"' + fe + '/><path d="M60,15 Q50,16 47,28 Q49,30 52,28 Q56,20 60,18 Z"' + f + '/><path d="M60,15 Q70,16 73,28 Q71,30 68,28 Q64,20 60,18 Z"' + f + '/><path d="M44,23 q4,3 2,8 M76,23 q-4,3 -2,8" fill="none" stroke="' + c + '" stroke-width="1.5" stroke-linecap="round" opacity="0.55"/>';
      case 'boy':    return '<path d="M44,27 Q46,11 60,14 Q67,6 76,20 Q70,17 64,18 Q56,12 50,25 Q47,28 44,27 Z"' + f + '/>';
      /* SHIRT (shoulders y61, hem y100) */
      case 'girly':  return '<path d="M53,63 Q52,82 45,104 Q60,110 75,104 Q68,82 67,63 Q60,59 53,63 Z"' + f + '/><path d="M53,62 Q41,62 41,75 Q43,82 52,79 Q53,70 56,65 Z"' + f + '/><path d="M67,62 Q79,62 79,75 Q77,82 68,79 Q67,70 64,65 Z"' + f + '/><path d="M57,59 L60,64 L57,69 Z M63,59 L60,64 L63,69 Z"' + fl + '/><circle cx="60" cy="64" r="1.6"' + fl + '/>';
      case 'tee':    return '<path d="M48,61 L72,61 L74,100 L46,100 Z"' + f + '/><path d="M49,61 L40,82 L48,86 L55,67 Z"' + f + '/><path d="M71,61 L80,82 L72,86 L65,67 Z"' + f + '/>';
      case 'long':   return '<path d="M47,61 L73,61 L74,101 L46,101 Z"' + f + '/><path d="M49,63 L32,99 L39,103 L55,68 Z"' + f + '/><path d="M71,63 L88,99 L81,103 L65,68 Z"' + f + '/>';
      /* PANTS / lower (waist y102) */
      case 'skirt':  return '<path d="M52,101 L68,101 Q72,124 86,144 L34,144 Q48,124 52,101 Z"' + f + '/><path d="M34,144 Q41,151 48,144 Q54,151 60,144 Q66,151 72,144 Q79,151 86,144"' + ln + '/>';
      case 'pants':  return '<path d="M52,102 L68,102 Q72,150 80,202 L63,202 Q61,170 60,150 Q59,170 57,202 L40,202 Q48,150 52,102 Z"' + f + '/>';
      case 'shorts': return '<path d="M52,102 L68,102 Q70,128 78,150 L63,150 Q61,138 60,128 Q59,138 57,150 L42,150 Q50,128 52,102 Z"' + f + '/>';
      /* SHOES (feet y202) */
      /* Minnie-style pumps in side profile: toe on the floor up front, thin heel down at the back */
      case 'heels':    return '<path d="M39,214 Q36,207 41,203 Q47,200 54,201 Q57,202 55,205 Q49,207 44,208 Q40,211 39,214 Z"' + f + '/><path d="M52,205 L56,214 L54,214 L50,207 Z"' + f + '/><path d="M42,206 Q47,204 52,205"' + th + '/><path d="M63,214 Q60,207 65,203 Q71,200 78,201 Q81,202 79,205 Q73,207 68,208 Q64,211 63,214 Z"' + f + '/><path d="M76,205 L80,214 L78,214 L74,207 Z"' + f + '/><path d="M66,206 Q71,204 76,205"' + th + '/>';
      case 'sneakers': return '<path d="M38,198 Q37,208 48,208 L57,208 Q59,200 52,198 Z"' + f + '/><path d="M82,198 Q83,208 72,208 L63,208 Q61,200 68,198 Z"' + f + '/>';
      case 'flops':    return '<ellipse cx="47" cy="206" rx="9" ry="3.6"' + f + '/><path d="M47,206 L44,200 M47,206 L50,200"' + ln + '/><ellipse cx="73" cy="206" rx="9" ry="3.6"' + f + '/><path d="M73,206 L70,200 M73,206 L76,200"' + ln + '/>';
      /* ACCESSORIES (ears ~ sides y41, eyes ~ y26, right hand ~84,100) */
      case 'earrings':   return '<circle cx="48" cy="41" r="4"' + ln + '/><circle cx="72" cy="41" r="4"' + ln + '/>';
      case 'sunglasses': return '<path d="M48,24 h9 v3 a4.5,4.5 0 0 1 -9,0 z"' + f + '/><path d="M63,24 h9 v3 a4.5,4.5 0 0 1 -9,0 z"' + f + '/><path d="M57,25 L63,25"' + ln + '/>';
      case 'matcha':     return '<path d="M80,97 L93,97 L91,113 L82,113 Z"' + f + '/><path d="M79,97 L94,97"' + ln + '/><path d="M82,102 L91,102"' + th + '/><path d="M89,97 L93,86"' + ln + '/>';
      case 'badminton':  return '<path d="M84,101 L90,83"' + ln + '/><ellipse cx="93" cy="74" rx="9.5" ry="12.5" transform="rotate(18 93 74)"' + f + '/><path d="M87,68 L98,80 M85,74 L97,70 M89,63 L94,85"' + th + '/>';
      case 'basket':     return '<path d="M76,98 L98,98 L95,114 L79,114 Z"' + f + '/><path d="M76,98 Q87,86 98,98"' + ln + '/><path d="M82,98 L83,114 M87,98 L87,114 M92,98 L91,114"' + th + '/><path d="M77,104 L97,104"' + th + '/>';
    }
    return '';
  }

  /* ---- full figure ---- */
  function figureInner(char) {
    var c = char.body;
    var bs = ' fill="none" stroke="' + c + '" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"';
    var body =
      '<circle cx="60" cy="28" r="13" fill="none" stroke="' + c + '" stroke-width="4"/>' +
      /* simple face: two eyes + smile */
      '<circle cx="55" cy="26" r="1.9" fill="' + c + '"/><circle cx="65" cy="26" r="1.9" fill="' + c + '"/>' +
      '<path d="M57,33 Q60,35.2 63,33" fill="none" stroke="' + c + '" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M60,41 L60,54"' + bs + '/>' +
      '<path d="M60,55 L60,128"' + bs + '/>' +
      '<path d="M60,61 L36,100"' + bs + '/>' +
      '<path d="M60,61 L84,100"' + bs + '/>' +
      '<path d="M60,128 L48,202"' + bs + '/>' +
      '<path d="M60,128 L72,202"' + bs + '/>';
    var clothes = piece('pants', char.pants, char.pantsCol) + piece('shoes', char.shoes, char.shoesCol) +
      piece('shirt', char.shirt, char.shirtCol) + piece('hair', char.hair, char.hairCol) +
      piece('acc', char.acc, char.accCol);
    return body + clothes;
  }
  function figureSVG(char, maxW) {
    var c = char.body;
    return '<svg viewBox="0 0 120 220" style="display:block;width:100%;height:auto;max-width:' + maxW + 'px;margin:0 auto;filter:drop-shadow(0 0 6px ' + c + '88);overflow:visible">' + figureInner(char) + '</svg>';
  }
  // head-only mini used by the lobby roster and in-game avatars
  function miniFigureSVG(char, pxH) {
    var c = char.body;
    return '<svg viewBox="36 2 48 50" style="display:block;height:' + pxH + 'px;width:' + pxH + 'px;filter:drop-shadow(0 0 4px ' + c + '88);overflow:hidden">' + figureInner(char) + '</svg>';
  }

  /* ---- mini option preview ---- */
  var CROP = { hair: '33 3 56 56', shirt: '30 52 60 58', pants: '30 98 60 80', shoes: '34 192 54 26' };
  var GUIDE = {
    hair:  '<circle cx="60" cy="28" r="13" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="3"/>',
    shirt: '<path d="M60,54 L60,102 M60,60 L40,96 M60,60 L80,96" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="3" stroke-linecap="round"/>',
    pants: '<path d="M60,100 L50,202 M60,100 L70,202" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="3" stroke-linecap="round"/>',
    shoes: '<path d="M52,180 L48,202 M68,180 L72,202" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="3" stroke-linecap="round"/>'
  };
  function pieceIcon(slot, v, wpx, color) {
    var crop, guide;
    if (slot === 'acc') {
      var hand = (v === 'matcha' || v === 'basket' || v === 'badminton');
      crop = v === 'badminton' ? '74 56 34 50' : (v === 'basket' ? '72 82 32 38' : (v === 'matcha' ? '76 82 26 36' : '40 11 40 40'));
      guide = hand
        ? '<path d="M68,89 L84,100" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="3" stroke-linecap="round"/><circle cx="84" cy="100" r="3" fill="rgba(255,255,255,.13)"/>'
        : '<circle cx="60" cy="28" r="13" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="3"/>';
    } else { crop = CROP[slot]; guide = GUIDE[slot]; }
    var p = crop.split(' ').map(Number);
    var scale = Math.min(wpx / p[2], wpx / p[3]);
    var w = Math.round(p[2] * scale), hpx = Math.round(p[3] * scale);
    return '<svg viewBox="' + crop + '" width="' + w + '" height="' + hpx + '" style="overflow:visible">' + guide + piece(slot, v, color) + '</svg>';
  }

  function newChar(body, h, s, p, sh, a) {
    return { body: body, hair: null, hairCol: h, shirt: null, shirtCol: s, pants: null, pantsCol: p, shoes: null, shoesCol: sh, acc: null, accCol: a };
  }

  Arcade.registerGame('dressup', {
    meta: { name: 'DRESS UP', accent: '#ff79c6' },
    online: true,

    fresh: function () {
      return {
        chars: [
          newChar('#39ff8b', '#ff79c6', '#ff2d9b', '#2de2ff', '#ff2d9b', '#caff00'),
          newChar('#ff79c6', '#b14bff', '#ffb000', '#2de2ff', '#caff00', '#2de2ff')
        ],
        active: 0, paint: 'body'
      };
    },

    _idx: function (api) { return api.mode === 'online' ? (api.mySymbol === 'O' ? 1 : 0) : api.game.active; },
    _sync: function (api, idx) { if (api.mode === 'online') api.send({ game: 'dressup', type: 'dress', char: idx, data: api.game.chars[idx] }); },

    set: function (slot, value, api) {
      if (!api) return;
      var g = api.game; if (!g) return;
      var idx = this._idx(api);
      api.sfx('place');
      var chars = g.chars.map(function (c) { return Object.assign({}, c); });
      chars[idx][slot] = (chars[idx][slot] === value) ? null : value;
      api.setGame(Object.assign({}, g, { chars: chars, paint: slot }));
      this._touchAvatar(idx, chars[idx]);
      api.rerender();
      this._sync(api, idx);
    },

    setColor: function (col, api) {
      if (!api) return;
      var g = api.game; if (!g) return;
      var idx = this._idx(api);
      api.sfx('click');
      var chars = g.chars.map(function (c) { return Object.assign({}, c); });
      chars[idx][COLKEY[g.paint]] = col;
      api.setGame(Object.assign({}, g, { chars: chars }));
      this._touchAvatar(idx, chars[idx]);
      api.rerender();
      this._sync(api, idx);
    },

    // once an avatar is placed on the home screen, keep it in sync with edits
    _touchAvatar: function (idx, char) { var av = loadAv(); if (av[idx]) { av[idx] = char; saveAv(av); } },
    confirmAvatar: function (idx, api) { var av = loadAv(); av[idx] = api.game.chars[idx]; saveAv(av); api.sfx('go'); api.rerender(); },
    removeAvatar: function (idx, api) { var av = loadAv(); av[idx] = null; saveAv(av); api.sfx('drop'); api.rerender(); },

    setPaint: function (t, api) { api.sfx('hover'); api.setGame(Object.assign({}, api.game, { paint: t })); api.rerender(); },

    switchP: function (api) {
      var g = api.game; api.sfx('click');
      api.setGame(Object.assign({}, g, { active: g.active === 0 ? 1 : 0 }));
      api.rerender(); api.refreshStatus();
    },

    onServer: function (data, api) {
      if (data.game !== 'dressup') return;
      if (data.type === 'init') {
        api.mySymbol = data.symbol; api.matchState = 'playing'; api.hideWaiting();
        var base = api.game || this.fresh();
        api.setGame(Object.assign({}, base, { chars: data.chars || base.chars, active: data.symbol === 'O' ? 1 : 0 }));
        api.rerender(); api.refreshStatus();
      } else if (data.type === 'update') {
        api.matchState = 'playing';
        api.setGame(Object.assign({}, api.game, { chars: data.chars }));
        api.rerender();
      }
    },

    status: function (g, api) {
      if (api.mode === 'online') {
        if (api.matchState !== 'playing') return null;
        var c = api.mySymbol === 'O' ? api.P2 : api.P1;
        return api.pill('● STYLING LIVE - NO RULES, JUST VIBES', c, true);
      }
      var col = g.active === 0 ? api.P1 : api.P2;
      return api.pill('EDITING PLAYER ' + (g.active + 1) + ' - ⇄ TO SWAP', col, true);
    },

    render: function (root, api) {
      var h = api.h, g = api.game, online = api.mode === 'online';
      var self = Arcade.games['dressup'];
      var myIdx = online ? (api.mySymbol === 'O' ? 1 : 0) : g.active;
      var P = [api.P1, api.P2];

      function stage(idx) {
        var ch = g.chars[idx], mine = idx === myIdx, pcol = P[idx];
        var label = online ? (mine ? 'YOU' : 'PARTNER') : ('PLAYER ' + (idx + 1));
        var av = loadAv(), saved = !!av[idx];
        var editable = online ? mine : true;
        var btnBase = { cursor: 'pointer', fontFamily: "'Press Start 2P',monospace", fontSize: 6.5, letterSpacing: .5, padding: '6px 9px', borderRadius: 8, transition: '.15s' };
        var controls = editable ? h('div', { style: { display: 'flex', gap: 6, marginTop: 1, flexWrap: 'wrap', justifyContent: 'center' } },
          saved ? [
            h('div', { style: Object.assign({}, btnBase, { cursor: 'default', color: '#39ff8b', border: '1.5px solid #39ff8b', background: 'rgba(57,255,139,.12)' }) }, '\u2713 ON HOME'),
            h('div', {
              onClick: function () { self.removeAvatar(idx, api); },
              onMouseEnter: function (e) { api.sfx('hover'); e.currentTarget.style.background = 'rgba(255,90,90,.2)'; },
              onMouseLeave: function (e) { e.currentTarget.style.background = 'rgba(8,6,15,.4)'; },
              style: Object.assign({}, btnBase, { color: '#ff5a5a', border: '1.5px solid #ff5a5a', background: 'rgba(8,6,15,.4)' })
            }, '\u2715 REMOVE')
          ] : [
            h('div', {
              onClick: function () { self.confirmAvatar(idx, api); },
              onMouseEnter: function (e) { api.sfx('hover'); e.currentTarget.style.boxShadow = '0 0 14px ' + pcol; },
              onMouseLeave: function (e) { e.currentTarget.style.boxShadow = 'none'; },
              style: Object.assign({}, btnBase, { color: pcol, border: '1.5px solid ' + pcol, background: pcol + '18' })
            }, '\uFF0B ADD TO HOME')
          ]
        ) : null;
        return h('div', { style: { flex: '1 1 0', maxWidth: 250, minWidth: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 } }, [
          h('div', {
            style: {
              position: 'relative', width: '100%', padding: '16px 6% 12px', borderRadius: 16,
              border: '2px solid ' + (mine ? pcol : 'rgba(255,255,255,.1)'),
              background: 'radial-gradient(120% 90% at 50% 18%, rgba(255,255,255,.05), rgba(8,6,15,.5))',
              boxShadow: mine ? '0 0 26px ' + pcol + '55, inset 0 0 20px rgba(0,0,0,.55)' : 'inset 0 0 20px rgba(0,0,0,.55)',
              transition: '.2s'
            }
          }, [
            h('div', { style: { width: '100%' }, html: figureSVG(ch, 230) }),
            mine ? h('div', { style: { position: 'absolute', top: 9, right: 12, fontFamily: "'Press Start 2P',monospace", fontSize: 6.5, color: pcol, letterSpacing: 1, textShadow: '0 0 8px ' + pcol } }, 'EDITING') : null
          ]),
          h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 10, color: pcol, textShadow: '0 0 8px ' + pcol, letterSpacing: 1 } }, label),
          controls
        ]);
      }
      var stages = h('div', { style: { display: 'flex', gap: '5%', alignItems: 'flex-end', justifyContent: 'center', width: '100%' } }, [stage(0), stage(1)]);

      var me = g.chars[myIdx], meCol = P[myIdx];

      var header = h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 } }, [
        h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 9, color: meCol, textShadow: '0 0 10px ' + meCol, letterSpacing: 1 } }, online ? 'DRESS YOUR FIGURE' : 'DRESSING PLAYER ' + (myIdx + 1)),
        online
          ? h('div', { style: { fontSize: 11, color: '#8c78a8' } }, 'Partner edits the other - live')
          : h('div', {
              onClick: function () { self.switchP(api); },
              onMouseEnter: function (e) { api.sfx('hover'); e.currentTarget.style.boxShadow = '0 0 16px ' + meCol; },
              onMouseLeave: function (e) { e.currentTarget.style.boxShadow = 'none'; },
              style: { cursor: 'pointer', padding: '9px 13px', borderRadius: 9, border: '1.5px solid ' + meCol, color: meCol, fontFamily: "'Press Start 2P',monospace", fontSize: 7.5, letterSpacing: 1, transition: '.15s' }
            }, '\u21C4 SWITCH PLAYER')
      ]);

      // PAINT target chips
      var paintRow = h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11, flexWrap: 'wrap' } },
        [h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 7, color: '#74618f', width: 44, letterSpacing: 1 } }, 'PAINT')].concat(
          TARGETS.map(function (t) {
            var on = g.paint === t[0];
            var tcol = me[COLKEY[t[0]]];
            return h('div', {
              onClick: function () { self.setPaint(t[0], api); },
              style: {
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 9px', borderRadius: 8,
                border: '1.5px solid ' + (on ? tcol : 'rgba(255,255,255,.1)'), background: on ? tcol + '1f' : 'rgba(8,6,15,.4)',
                boxShadow: on ? '0 0 12px ' + tcol + '55' : 'none', transition: '.15s'
              }
            }, [
              h('span', { style: { width: 11, height: 11, borderRadius: '50%', background: tcol, boxShadow: '0 0 6px ' + tcol } }),
              h('span', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 6.5, letterSpacing: .5, color: on ? tcol : '#9d88ba' } }, t[1])
            ]);
          })
        ));

      // COLOR swatches (paint active target)
      var activeColor = me[COLKEY[g.paint]];
      var colorRow = h('div', { style: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 15, flexWrap: 'wrap' } },
        [h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 7, color: '#74618f', width: 44, letterSpacing: 1 } }, 'COLOR')].concat(
          COLORS.map(function (col) {
            var sel = activeColor === col;
            return h('div', {
              onClick: function () { self.setColor(col, api); },
              onMouseEnter: function () { api.sfx('hover'); },
              style: { cursor: 'pointer', width: 24, height: 24, borderRadius: '50%', background: col, transition: '.15s', boxShadow: sel ? '0 0 0 2px #0c0816, 0 0 0 4px ' + col + ', 0 0 12px ' + col : '0 0 7px ' + col + '88' }
            });
          })
        ));

      function cell(slot) {
        var slotCol = me[COLKEY[slot]];
        var btns = ITEMS[slot].map(function (o) {
          var sel = me[slot] === o.v;
          return h('div', {
            onClick: function () { self.set(slot, o.v, api); },
            onMouseEnter: function (e) { api.sfx('hover'); if (!sel) e.currentTarget.style.borderColor = slotCol + '99'; },
            onMouseLeave: function (e) { if (!sel) e.currentTarget.style.borderColor = 'rgba(255,255,255,.1)'; },
            style: {
              cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '7px 3px 6px', borderRadius: 9,
              border: '1.5px solid ' + (sel ? slotCol : 'rgba(255,255,255,.1)'), background: sel ? slotCol + '20' : 'rgba(8,6,15,.4)',
              boxShadow: sel ? '0 0 14px ' + slotCol + '55' : 'none', transition: '.15s'
            }
          }, [
            h('div', { style: { height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center' }, html: pieceIcon(slot, o.v, 38, slotCol) }),
            h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 5.5, letterSpacing: .4, color: sel ? slotCol : '#9d88ba' } }, o.label)
          ]);
        });
        return h('div', { style: { flex: slot === 'acc' ? '1 1 100%' : '1 1 232px', minWidth: 210 } }, [
          h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 7, color: '#74618f', marginBottom: 6, letterSpacing: 1 } }, slot === 'acc' ? 'ACCESSORIES' : slot.toUpperCase()),
          h('div', { style: { display: 'flex', gap: 7 } }, btns)
        ]);
      }
      var grid = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '13px 16px' } }, SLOTS.map(cell));

      var panel = h('div', { style: { flex: '1 1 360px', minWidth: 296, maxWidth: 480, alignSelf: 'stretch', overflowY: 'auto', padding: '18px 20px', borderRadius: 16, border: '1.5px solid rgba(255,255,255,.08)', background: 'rgba(10,6,18,.55)' } }, [header, paintRow, colorRow, grid]);

      var stageWrap = h('div', { style: { flex: '1 1 300px', minWidth: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, [stages]);

      root.appendChild(h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 20, width: 'min(calc(100vw - 358px), 1160px)', height: 'calc(100vh - 150px)', margin: '0 auto', alignItems: 'stretch', justifyContent: 'center', overflowY: 'auto' } }, [stageWrap, panel]));
    }
  });

  // expose the mini figure + saved avatars so the lobby can render a roster
  Arcade.dressupMini = miniFigureSVG;
  Arcade.loadAvatars = loadAv;
})();

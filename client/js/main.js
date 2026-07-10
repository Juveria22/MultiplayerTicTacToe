/* ============================================================
   Neon Arcade — core (main.js)

   Owns: WebSocket connection, lobby, screen routing, chat,
   sound, cosmetic FX, and the win/overlay flow.

   GAME MODULE CONTRACT
   --------------------
   Each game lives in its own file under js/games/ and registers
   itself:

     Arcade.registerGame('my-game', {
       meta:   { name, tagline, accent, badge, font },
       online: true,                 // shows ONLINE badge / allows online mode
       fresh(api)        { return {...state} },        // new game state
       render(root, api) { root.appendChild(...) },    // build the board UI
       status(g, api)    { return node | null },       // optional turn HUD
       onServer(data, api){ ... },    // optional: handle a server message
       start(api) {}, stop(api) {},   // optional: loops (e.g. canvas games)
     });

   The `api` object (passed everywhere) gives a game everything it
   needs WITHOUT reaching into the core:

     api.mode / api.mySymbol / api.matchState / api.gameId
     api.game            -> current game state (also api.setGame)
     api.P1 / api.P2      -> player colors
     api.h(tag, props, kids)  -> tiny createElement helper (style objects ok)
     api.icon(id, color, size) -> svg string for a game icon
     api.send(obj)        -> WebSocket send (online)
     api.sfx(kind)        -> sound effect
     api.setGame(obj|fn)  -> update state (no auto-render)
     api.rerender()       -> rebuild the board (call after a local move)
     api.refreshStatus()  -> rebuild just the turn HUD
     api.endRound(winner) -> winner: 0 draw | 1 | 2 (or 'X'/'O')
     api.showWin(winner)  -> show the win overlay immediately
     api.pushSys(text) / api.pushChat(side, text, who)

   WIRING A GAME ONLINE
   --------------------
   1. set `online: true`
   2. in your click handler, when api.mode === 'online', send the
      move to the server with api.send({ game:'my-game', type:'move', ... })
      instead of mutating local state
   3. implement onServer(data, api) to apply the authoritative state
      the server broadcasts back (see tic-tac-toe.js for the model)
   ============================================================ */

(function () {
  'use strict';

  var SERVER_URL = 'wss://multiplayertictactoe-xwzj.onrender.com';
  var P1 = '#ff2d9b', P2 = '#ffb000';

  /* ---------- tiny DOM helper (createElement-like) ---------- */
  var UNITLESS = { zIndex:1, opacity:1, flex:1, flexGrow:1, flexShrink:1, order:1, lineHeight:1, fontWeight:1, zoom:1 };
  function cssKey(k) { return k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }); }
  function applyStyle(el, o) {
    for (var k in o) {
      var v = o[k];
      if (v == null) continue;
      if (typeof v === 'number' && !UNITLESS[k]) v = v + 'px';
      el.style.setProperty(cssKey(k), String(v));
    }
  }
  function append(el, kids) {
    if (kids == null || kids === false) return;
    if (Array.isArray(kids)) { kids.forEach(function (k) { append(el, k); }); return; }
    if (kids instanceof Node) { el.appendChild(kids); return; }
    el.appendChild(document.createTextNode(String(kids)));
  }
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    if (props) {
      for (var k in props) {
        var v = props[k];
        if (v == null) continue;
        if (k === 'style' && typeof v === 'object') applyStyle(el, v);
        else if (k === 'class' || k === 'className') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'ref' && typeof v === 'function') v(el);
        else el.setAttribute(k, v);
      }
    }
    append(el, kids);
    return el;
  }

  /* ---------- game icons (svg strings) ---------- */
  function icon(id, accent, size) {
    size = size || 56;
    var open = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + accent +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 7px ' + accent + ')">';
    var a = accent;
    var body = {
      'tic-tac-toe': '<line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>',
      'connect-four': '<circle cx="7" cy="8" r="2" fill="' + a + '"/><circle cx="12" cy="8" r="2"/><circle cx="17" cy="8" r="2" fill="' + a + '"/><circle cx="7" cy="14" r="2"/><circle cx="12" cy="14" r="2" fill="' + a + '"/><circle cx="17" cy="14" r="2"/>',
      'rps': '<circle cx="8" cy="8" r="4"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
      'memory': '<rect x="4" y="4" width="7" height="7" rx="1" fill="' + a + '"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1" fill="' + a + '"/>',
      'checkers': '<circle cx="8" cy="8" r="3" fill="' + a + '"/><circle cx="16" cy="16" r="3"/><line x1="4" y1="20" x2="20" y2="4"/>',
      'reversi': '<circle cx="12" cy="12" r="8"/><path d="M12 4 a8 8 0 0 1 0 16 z" fill="' + a + '" stroke="none"/>',
      'dots': '<circle cx="6" cy="6" r="1.6" fill="' + a + '"/><circle cx="18" cy="6" r="1.6" fill="' + a + '"/><circle cx="6" cy="18" r="1.6" fill="' + a + '"/><circle cx="18" cy="18" r="1.6" fill="' + a + '"/><line x1="6" y1="6" x2="18" y2="6"/><line x1="6" y1="6" x2="6" y2="18"/>',
      'battleship': '<path d="M4 14 h16 l-2 4 H6 z" fill="' + a + '" stroke="none"/><line x1="12" y1="5" x2="12" y2="14"/><line x1="9" y1="9" x2="15" y2="9"/>',
      'pong': '<rect x="4" y="8" width="2" height="8" fill="' + a + '" stroke="none"/><rect x="18" y="8" width="2" height="8" fill="' + a + '" stroke="none"/><circle cx="12" cy="12" r="2" fill="' + a + '"/><line x1="12" y1="4" x2="12" y2="20" stroke-dasharray="2 3" opacity=".5"/>',
      'drawing': '<path d="M4 18 C 8 6, 12 6, 14 12 S 18 18, 20 8"/>',
      'sugar': '<path d="M7 14 h10 v4 a2 2 0 0 1-2 2 H9 a2 2 0 0 1-2-2 z" fill="' + a + '" stroke="none" opacity=".85"/><circle cx="10" cy="6" r="1" fill="' + a + '"/><circle cx="13" cy="9" r="1" fill="' + a + '"/><circle cx="11" cy="11" r="1" fill="' + a + '"/>',
      'dressup': '<path d="M9 4 L5 7 L7 10 L9 8.5 V20 H15 V8.5 L17 10 L19 7 L15 4 C14 6.2 10 6.2 9 4 Z"/>'
    }[id] || '<circle cx="12" cy="12" r="7"/>';
    return open + body + '</svg>';
  }

  /* card display fonts */
  function cardFont(id) {
    return {
      'tic-tac-toe': "'Bungee Shade', cursive", 'connect-four': "'Faster One', cursive",
      'rps': "'Wallpoet', cursive", 'memory': "'Bowlby One SC', cursive",
      'checkers': "'Audiowide', cursive", 'reversi': "'Bungee Shade', cursive",
      'dots': "'Faster One', cursive", 'battleship': "'Wallpoet', cursive",
      'pong': "'Bungee Shade', cursive", 'drawing': "'Bowlby One SC', cursive",
      'sugar': "'Bungee', cursive", 'dressup': "'Bowlby One SC', cursive"
    }[id] || "'Bungee', cursive";
  }

  /* ============================================================
     STATE
     ============================================================ */
  var S = {
    screen: 'lobby', mode: 'local', gameId: null, soundOn: true,
    conn: 'connecting', matchState: 'idle', mySymbol: null,
    series: [0, 0], chat: [], game: null, winInfo: null
  };

  // catalog: order + cosmetic meta for the lobby. Games that are not
  // registered fall back to a "coming soon" board but still show a cabinet.
  var CATALOG = [
    { id: 'tic-tac-toe', name: 'TIC TAC TOE', tagline: 'Three in a row. The classic standoff.', accent: '#ff2d9b', badge: 'WEB' },
    { id: 'connect-four', name: 'CONNECT 4', tagline: 'Drop discs, line up four to win.', accent: '#2de2ff', badge: 'WEB' },
    { id: 'rps', name: 'RPS DUEL', tagline: 'Rock paper scissors, best of five.', accent: '#ffb000', badge: 'WEB' },
    { id: 'memory', name: 'MEMORY', tagline: 'Flip cards, match pairs, sharpest mind wins.', accent: '#b14bff', badge: 'WEB' },
    { id: 'checkers', name: 'CHECKERS', tagline: 'Jump and capture across the board.', accent: '#39ff8b', badge: 'WEB' },
    { id: 'reversi', name: 'REVERSI', tagline: 'Flank to flip. Own the board.', accent: '#ff5a5a', badge: 'WEB' },
    { id: 'dots', name: 'DOTS & BOXES', tagline: 'Close a box, claim it, take another turn.', accent: '#39ff8b', badge: 'WEB' },
    { id: 'battleship', name: 'BATTLESHIP', tagline: 'Hide your fleet. Sink theirs first.', accent: '#ff2d9b', badge: 'WEB' },
    { id: 'pong', name: 'PONG', tagline: 'Reflex paddle classic. First to 7.', accent: '#2de2ff', badge: 'WEB' },
    { id: 'drawing', name: 'DOODLE', tagline: 'Draw together on a shared canvas.', accent: '#ffb000', badge: 'WEB' },
    { id: 'sugar', name: 'SUGAR RUSH', tagline: 'Draw lines, pour sugar, fill your cup first.', accent: '#ff5a5a', badge: 'WEB' },
    { id: 'dressup', name: 'DRESS UP', tagline: 'Style a neon figure together. Pure chill.', accent: '#b14bff', badge: 'WEB' }
  ];
  function catById(id) { for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].id === id) return CATALOG[i]; return CATALOG[0]; }

  /* ============================================================
     REGISTRY
     ============================================================ */
  var Arcade = window.Arcade = {
    games: {},
    h: h, icon: icon,
    registerGame: function (id, mod) { this.games[id] = mod; }
  };
  function activeGame() { return S.gameId ? Arcade.games[S.gameId] : null; }

  /* ============================================================
     AUDIO
     ============================================================ */
  var _ac = null;
  function ac() {
    if (!_ac) { try { _ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (_ac && _ac.state === 'suspended') _ac.resume();
    return _ac;
  }
  function tone(freq, dur, type, vol, slideTo) {
    if (!S.soundOn) return;
    var a = ac(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'triangle'; o.frequency.value = freq;
    if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, a.currentTime + dur);
    var peak = (vol == null ? 0.06 : vol);
    // soft attack + smooth decay so notes bloom instead of clicking
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.linearRampToValueAtTime(peak, a.currentTime + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination);
    o.start(); o.stop(a.currentTime + dur);
  }
  // little two-note musical blip helper (soft, nostalgic)
  function blip(f1, f2, dur, vol, type) {
    tone(f1, dur, type || 'triangle', vol, f2);
  }
  function sfx(kind) {
    switch (kind) {
      case 'hover': tone(1047, 0.035, 'sine', 0.018); break;
      case 'click': blip(659, 880, 0.08, 0.04); break;
      case 'place': blip(587, 784, 0.10, 0.05); break;
      case 'drop': blip(392, 262, 0.14, 0.045); break;
      case 'flip': blip(784, 1175, 0.07, 0.032, 'sine'); break;
      case 'match': [659, 988].forEach(function (f, i) { setTimeout(function () { tone(f, 0.12, 'triangle', 0.05); }, i * 85); }); break;
      case 'win': [523, 659, 784, 880, 1047].forEach(function (f, i) { setTimeout(function () { tone(f, 0.18, 'triangle', 0.055); }, i * 105); }); break;
      case 'lose': [587, 494, 392, 330].forEach(function (f, i) { setTimeout(function () { tone(f, 0.2, 'triangle', 0.05); }, i * 120); }); break;
      case 'beep': tone(784, 0.11, 'sine', 0.05); break;
      case 'go': blip(659, 1319, 0.24, 0.06); break;
      case 'error': blip(330, 247, 0.16, 0.045); break;
    }
  }

  /* ============================================================
     WEBSOCKET
     ============================================================ */
  var ws = null;
  function connect() {
    try {
      ws = new WebSocket(SERVER_URL);
      ws.onopen = function () { setConn('online'); };
      ws.onclose = function () { setConn('offline'); };
      ws.onerror = function () { setConn('offline'); };
      ws.onmessage = function (e) { try { onServer(JSON.parse(e.data)); } catch (err) {} };
    } catch (e) { setConn('offline'); }
  }
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function stripHtml(s) { return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

  function onServer(data) {
    if (data.type === 'chat') { pushChat(data.player === S.mySymbol ? 'me' : 'them', data.message, data.player); return; }
    if (data.type === 'message') { pushSys(stripHtml(data.message)); return; }
    if (data.type === 'countdown') { S.matchState = 'countdown'; showCountdown((data.message.match(/\d/) || ['3'])[0]); sfx('beep'); return; }
    if (data.type === 'error') { pushSys(data.message); return; }
    if (data.type === 'opponentLeft') {
      var mod0 = activeGame(); if (mod0 && mod0.stop) mod0.stop(api);
      S.matchState = 'waiting'; S.winInfo = null;
      hideOverlays();
      document.getElementById('ov-waiting').hidden = false;
      pushSys('Opponent left — waiting for a new player…');
      return;
    }
    var g = activeGame();
    if (g && g.onServer) g.onServer(data, api);
  }

  /* ============================================================
     CONNECTION PILL
     ============================================================ */
  function setConn(state) {
    S.conn = state;
    var map = { connecting: ['#ffb000', 'CONNECTING'], online: ['#39ff8b', 'SERVER LIVE'], offline: ['#ff5a5a', 'LOCAL ONLY'] };
    var c = map[state] || map.connecting;
    var pill = document.getElementById('conn');
    pill.style.borderColor = c[0] + '55';
    pill.querySelector('.conn-dot').style.background = c[0];
    pill.querySelector('.conn-dot').style.boxShadow = '0 0 10px ' + c[0];
    var lbl = pill.querySelector('.conn-label');
    lbl.style.color = c[0]; lbl.textContent = c[1];
  }

  /* ============================================================
     CHAT
     ============================================================ */
  function addMsg(who, text, color, textColor) {
    S.chat.push({ who: who, text: text, color: color, textColor: textColor || '#e9dcf7' });
    var box = document.getElementById('messages');
    if (!box) return;
    var row = h('div', { class: 'chat-msg' }, [
      h('span', { class: 'chat-who', style: { color: color } }, who),
      h('span', { class: 'chat-text', style: { color: textColor || '#e9dcf7' } }, text)
    ]);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }
  function pushChat(side, text, who) {
    var map = { me: { who: 'YOU', color: '#ff2d9b' }, them: { who: 'P2', color: '#ffb000' } };
    var m = map[side] || { who: who || '?', color: '#ffb000' };
    addMsg(m.who, text, m.color);
  }
  function pushSys(text) { if (text) addMsg('SYSTEM', text, '#2de2ff', '#9fbed0'); }
  function clearChat() { S.chat = []; var box = document.getElementById('messages'); if (box) box.innerHTML = ''; }
  function sendChat() {
    var inp = document.getElementById('chat-input');
    var msg = (inp.value || '').trim(); if (!msg) return;
    sfx('click');
    if (S.mode === 'online') { send({ game: S.gameId, type: 'chat', message: msg }); }
    else {
      var cur = S.game && S.game.cur;
      var isP2 = cur === 2 || cur === 'O';
      addMsg(isP2 ? 'P2' : 'P1', msg, isP2 ? '#ffb000' : '#ff2d9b');
    }
    inp.value = '';
  }

  /* ============================================================
     HOVER SPARKLES (background only)
     ============================================================ */
  var _starThrottle = 0;
  function onStarHover(e) {
    var now = Date.now();
    if (now - _starThrottle < 65) return;
    var t = e.target;
    if (t && t.closest && t.closest('.cabinet, .game-screen, a, button, input')) return;
    if (t && t !== e.currentTarget && getComputedStyle(t).cursor === 'pointer') return;
    _starThrottle = now;
    var palette = ['#2de2ff', '#ff2d9b', '#b14bff', '#ffb000', '#39ff8b'];
    var glyphs = ['✦', '✧', '★', '✶'];
    var color = palette[(Math.random() * palette.length) | 0];
    var span = h('span', {
      style: {
        left: (e.clientX + (Math.random() * 22 - 11)) + 'px',
        top: (e.clientY + (Math.random() * 22 - 11)) + 'px',
        color: color, fontSize: (9 + Math.random() * 12) + 'px',
        textShadow: '0 0 10px ' + color + ', 0 0 20px ' + color
      }
    }, glyphs[(Math.random() * glyphs.length) | 0]);
    document.getElementById('star-layer').appendChild(span);
    if (S.soundOn && Math.random() < 0.5) tone(880 + Math.random() * 500, 0.05, 'triangle', 0.018);
    setTimeout(function () { span.remove(); }, 1600);
  }

  /* static twinkling stars */
  function buildStars() {
    var defs = [
      [8,13,'#2de2ff',18,4.2,0],[18,31,'#ff2d9b',13,5.1,1.2],[27,9,'#b14bff',12,3.6,.6],[37,23,'#2de2ff',15,5.6,2],
      [45,40,'#ffb000',12,4.4,1.5],[13,53,'#39ff8b',11,4.8,.8],[6,73,'#ff2d9b',14,5.3,2.4],[22,85,'#2de2ff',12,4.1,1],
      [33,66,'#b14bff',12,5.8,1.8],[58,15,'#ffb000',16,4.6,.3],[67,34,'#2de2ff',12,5.2,2.2],[76,11,'#ff2d9b',13,3.9,1.1],
      [88,25,'#b14bff',18,5.5,.7],[92,50,'#39ff8b',11,4.3,1.9],[82,70,'#2de2ff',14,5.0,.5],[70,83,'#ff2d9b',12,4.7,2.1],
      [60,60,'#ffb000',10,5.4,1.4],[49,77,'#b14bff',13,4.0,.9],[3,40,'#b14bff',11,5.7,1.3],[40,55,'#2de2ff',10,4.5,.4],
      [52,25,'#ff2d9b',12,5.2,1.7],[63,46,'#39ff8b',11,4.9,2.3],[30,46,'#ffb000',10,4.2,.9],[78,58,'#b14bff',13,5.6,1.5],
      [95,78,'#2de2ff',11,4.6,.6],[11,90,'#ff2d9b',12,5.0,2.0],[55,90,'#ffb000',11,4.4,1.1],[86,40,'#39ff8b',10,5.3,.8],
      [71,7,'#2de2ff',12,4.7,1.6],[46,6,'#b14bff',10,5.1,.5]
    ];
    var glyphs = ['✦','✧','★'];
    var wrap = document.getElementById('bg-stars');
    defs.forEach(function (d, i) {
      var s = h('span', { style: {
        left: d[0] + '%', top: d[1] + '%', color: d[2], fontSize: d[3] + 'px',
        textShadow: '0 0 10px ' + d[2], animation: 'twinkle ' + d[4] + 's ease-in-out ' + d[5] + 's infinite'
      } }, glyphs[i % 3]);
      wrap.appendChild(s);
    });
  }

  /* ============================================================
     COSMETIC: 3D coin + geometry-dash runner
     ============================================================ */
  function buildCoin() {
    var D = 54, T = 16, N = 16, layers = [];
    for (var i = 0; i < N; i++) {
      var z = -T / 2 + T * (i / (N - 1));
      var isFront = i === N - 1, isBack = i === 0, face = isFront || isBack;
      var bg = face ? 'radial-gradient(circle at 36% 30%, #fff3c0, #ffc83d 48%, #b9760a)'
                    : 'radial-gradient(circle at 50% 45%, #e0980f, #8f5d00)';
      var child = null;
      if (isFront) child = h('span', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 18, color: '#7a4f00' } }, '★');
      else if (isBack) child = h('span', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 18, color: '#7a4f00', transform: 'scaleX(-1)' } }, '★');
      layers.push(h('div', { style: {
        position: 'absolute', inset: 0, borderRadius: '50%', background: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'translateZ(' + z + 'px)',
        boxShadow: face ? '0 0 18px rgba(255,176,0,.75), inset 0 0 8px rgba(255,255,255,.4)' : 'none',
        border: face ? '1px solid rgba(255,240,180,.5)' : 'none'
      } }, child));
    }
    var coin = h('div', { style: { transformStyle: 'preserve-3d', transform: 'rotateX(-14deg)' } },
      h('div', { style: { position: 'relative', width: D, height: D, transformStyle: 'preserve-3d', animation: 'coinspin 1.9s linear infinite' } }, layers));
    document.getElementById('coin').appendChild(coin);
  }
  function buildRunnerSprite() {
    var border = '#04101a';
    var cube = h('div', { style: {
      width: 34, height: 34, position: 'relative',
      background: 'linear-gradient(145deg,#1d6f9c,#0e4f74 54%,#082c43)',
      border: '3px solid ' + border,
      boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.10), 0 0 7px rgba(45,226,255,.5)'
    } }, h('div', { style: { position: 'absolute', inset: 6, background: 'linear-gradient(145deg,#1c5f86,#0c3147)' } }));
    document.getElementById('gd-runner').appendChild(cube);
  }

  var _groundTop = null, _retry = null, _smokeTimer = null;
  function measurePlatforms() {
    var runner = document.getElementById('gd-runner');
    if (!runner) return null;
    var wrap = runner.parentElement;
    var cards = wrap.querySelectorAll('.cabinet');
    if (!cards.length) return null;
    var wr = wrap.getBoundingClientRect();
    var rects = Array.prototype.map.call(cards, function (c) {
      var r = c.getBoundingClientRect();
      return { left: r.left - wr.left, right: r.right - wr.left, top: r.top - wr.top };
    });
    var minTop = Math.min.apply(null, rects.map(function (r) { return r.top; }));
    rects = rects.filter(function (r) { return Math.abs(r.top - minTop) < 24; }).sort(function (a, b) { return a.left - b.left; });
    return { plats: rects, top: minTop };
  }
  function spawnSmoke(x, y) {
    var layer = document.getElementById('gd-smoke'); if (!layer) return;
    var sz = 7 + Math.random() * 5;
    var d = h('div', { style: {
      position: 'absolute', left: (x - 3) + 'px', top: (y - 9) + 'px', width: sz + 'px', height: sz + 'px',
      borderRadius: '50%', pointerEvents: 'none',
      background: 'radial-gradient(circle,rgba(170,235,255,.5),rgba(45,226,255,0) 70%)',
      animation: 'gdsmoke .8s ease-out forwards'
    } });
    layer.appendChild(d);
    d.addEventListener('animationend', function () { d.remove(); });
  }
  function setupRunner() {
    if (S.screen !== 'lobby') return;
    var runner = document.getElementById('gd-runner');
    var pf = measurePlatforms();
    if (!runner || !pf || pf.plats.length < 1) { _retry = setTimeout(setupRunner, 120); return; }
    var wrap = runner.parentElement, wr = wrap.getBoundingClientRect();
    var size = 34, speed = 150, hopTime = 0.46, arc = 26;
    var cards = pf.plats, cardTop = pf.top;
    _groundTop = cardTop - size;
    var segs = [];
    var toggleEl = document.getElementById('gd-toggle');
    if (toggleEl) {
      var tr = toggleEl.getBoundingClientRect();
      var tg = { left: tr.left - wr.left, right: tr.right - wr.left, top: tr.top - wr.top };
      var c0 = cards[0];
      var upX = Math.min(Math.max(tg.left, c0.left + 14), c0.right - 4);
      segs.push({ left: c0.left, right: upX, top: cardTop });
      segs.push({ left: tg.left, right: tg.right, top: tg.top, takeoff: true });
      cards.forEach(function (c) { if (c.right > tg.right + 4) segs.push({ left: Math.max(c.left, tg.right), right: c.right, top: cardTop }); });
    } else {
      cards.forEach(function (c) { segs.push({ left: c.left, right: c.right, top: cardTop }); });
    }
    var gY = function (s) { return s.top - size; };
    var tl = [], t = 0, rot = 0;
    tl.push({ t: 0, x: segs[0].left, y: gY(segs[0]), rot: 0 });
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      var runEnd = s.takeoff ? s.right : Math.max(s.left, s.right - size);
      t += Math.max(0.02, (runEnd - s.left) / speed);
      tl.push({ t: t, x: runEnd, y: gY(s), rot: rot });
      if (i < segs.length - 1) {
        var nx = segs[i + 1], gA = gY(s), gB = gY(nx), x0 = runEnd, x1 = nx.left, base = rot;
        var over = arc + Math.max(0, gA - gB) * 0.12, n = 6;
        for (var k = 1; k <= n; k++) {
          var tt = k / n;
          tl.push({ t: t + hopTime * tt, x: x0 + (x1 - x0) * tt, y: (gA + (gB - gA) * tt) - over * Math.sin(Math.PI * tt), rot: base + 90 * tt });
        }
        t += hopTime; rot = base + 90;
      }
    }
    var T2 = Math.max(2, t), kf = '', lastPct = -1;
    tl.forEach(function (p) {
      var pct = +(100 * p.t / T2).toFixed(3);
      if (pct <= lastPct) pct = lastPct + 0.001;
      lastPct = pct;
      kf += pct + '%{transform:translate(' + p.x.toFixed(2) + 'px,' + p.y.toFixed(2) + 'px) rotate(' + p.rot.toFixed(2) + 'deg)}';
    });
    var style = document.getElementById('gd-kf');
    if (!style) { style = document.createElement('style'); style.id = 'gd-kf'; document.head.appendChild(style); }
    style.textContent = '@keyframes gdrun{' + kf + '}';
    runner.style.animation = 'gdrun ' + T2.toFixed(2) + 's linear infinite';
  }
  function smokeTick() {
    if (S.screen !== 'lobby') return;
    var runner = document.getElementById('gd-runner'), layer = document.getElementById('gd-smoke');
    if (!runner || !layer) return;
    var rr = runner.getBoundingClientRect(), lr = layer.getBoundingClientRect();
    if (rr.width === 0) return;
    var footY = rr.bottom - lr.top;
    var groundY = (_groundTop != null ? _groundTop : 0) + 34;
    if (groundY - footY > 7) return;
    spawnSmoke((rr.left - lr.left) + 2, footY);
  }

  /* ============================================================
     LOBBY — build cabinets
     ============================================================ */
  function buildCabinet(meta) {
    var a = meta.accent;
    return h('div', {
      class: 'cabinet',
      onClick: function () { enterGame(meta.id); },
      onMouseEnter: function (e) { e.currentTarget.style.transform = 'translateY(-7px)'; e.currentTarget.style.background = a; e.currentTarget.style.filter = 'drop-shadow(0 0 13px ' + a + ') drop-shadow(0 0 2px ' + a + ')'; },
      onMouseLeave: function (e) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.background = 'rgba(255,255,255,.10)'; e.currentTarget.style.filter = 'none'; }
    }, h('div', { class: 'cab-inner' }, [
      h('div', { class: 'cab-strip left', style: { background: a, boxShadow: '0 0 8px ' + a } }),
      h('div', { class: 'cab-strip right', style: { background: a, boxShadow: '0 0 8px ' + a } }),
      h('div', { class: 'cab-hood', style: { background: 'linear-gradient(180deg,' + a + '33,rgba(0,0,0,.55))' } },
        h('div', { class: 'cab-name', style: { fontFamily: cardFont(meta.id), textShadow: '0 0 10px ' + a + ',0 0 4px ' + a } }, meta.name)),
      h('div', { class: 'cab-lightbar', style: { background: a, boxShadow: '0 0 14px 1px ' + a } }),
      h('div', { class: 'cab-screen', style: { boxShadow: 'inset 0 0 24px rgba(0,0,0,.9),0 0 0 1px ' + a + '33' } }, [
        h('div', { class: 'scan' }),
        h('div', { class: 'cab-badge', style: { color: a, border: '1px solid ' + a } }, S.mode === 'local' ? 'LOCAL' : 'WEB'),
        h('div', { class: 'cab-iconwrap' }, h('div', { class: 'cab-icon', html: icon(meta.id, a, 56) }))
      ]),
      h('div', { class: 'cab-tag' }, meta.tagline),
      h('div', { class: 'cab-deck' }, h('div', { class: 'cab-deck-row' }, [
        h('div', { class: 'cab-joy' }, [
          h('div', { class: 'base' }),
          h('div', { class: 'stick' }),
          h('div', { class: 'ball', style: { background: 'radial-gradient(circle at 35% 30%,' + a + ',rgba(0,0,0,.5))', boxShadow: '0 0 10px ' + a } })
        ]),
        h('div', { class: 'cab-btns' }, [
          h('div', { style: { background: 'radial-gradient(circle at 35% 30%,' + a + ',rgba(0,0,0,.6))', boxShadow: '0 0 7px ' + a } }),
          h('div', { style: { background: 'radial-gradient(circle at 35% 30%,rgba(255,255,255,.5),rgba(0,0,0,.6))', boxShadow: '0 0 5px rgba(255,255,255,.25)' } }),
          h('div', { style: { background: 'radial-gradient(circle at 35% 30%,' + a + ',rgba(0,0,0,.6))', boxShadow: '0 0 7px ' + a } })
        ])
      ])),
      h('div', { class: 'cab-door' }, [
        h('div', { class: 'slot', style: { boxShadow: 'inset 0 0 0 1.5px ' + a + '66' } }),
        h('div', { class: 'start', style: { color: a } }, 'INSERT COIN')
      ])
    ]));
  }
  function buildLobby() {
    var grid = document.getElementById('game-grid');
    grid.innerHTML = '';
    CATALOG.forEach(function (m) { grid.appendChild(buildCabinet(m)); });
    renderRoster();
  }

  /* ---- home-screen player roster: shows saved Dress Up avatars ---- */
  function renderRoster() {
    var el = document.getElementById('roster'); if (!el) return;
    el.innerHTML = '';
    var avs = (typeof Arcade.loadAvatars === 'function') ? Arcade.loadAvatars() : [null, null];
    var cols = [P1, P2];
    el.appendChild(h('span', { class: 'roster-tag' }, 'PLAYERS'));
    [0, 1].forEach(function (i) {
      var c = avs[i], mini = c && typeof Arcade.dressupMini === 'function';
      var fig = mini
        ? h('div', { class: 'roster-fig', html: Arcade.dressupMini(c, 34) })
        : h('div', { class: 'roster-fig empty' }, h('span', { style: { width: 11, height: 11, borderRadius: '50%', background: cols[i], boxShadow: '0 0 8px ' + cols[i], display: 'block' } }));
      el.appendChild(h('div', {
        class: 'roster-badge', title: 'Player ' + (i + 1),
        style: { borderColor: cols[i] + '55', background: cols[i] + '12' }
      }, [fig, h('span', { class: 'roster-lbl', style: { color: cols[i] } }, 'P' + (i + 1))]));
    });
  }

  /* ============================================================
     NAVIGATION
     ============================================================ */
  function setMode(m) {
    sfx('click'); S.mode = m;
    document.getElementById('mode-local').className = 'mode-btn' + (m === 'local' ? ' active-pink' : '');
    document.getElementById('mode-online').className = 'mode-btn' + (m === 'online' ? ' active-cyan' : '');
    document.getElementById('mode-hint').textContent = m === 'local'
      ? 'Two players, one keyboard.'
      : 'Matchmake with a 2nd browser. Every game plays over the web.';
    var badgeTxt = m === 'local' ? 'LOCAL' : 'WEB';
    var badges = document.querySelectorAll('.cab-badge');
    for (var i = 0; i < badges.length; i++) badges[i].textContent = badgeTxt;
  }

  function enterGame(id) {
    sfx('go');
    S.gameId = id; S.screen = 'game'; S.winInfo = null; S.mySymbol = null; S.series = [0, 0];
    clearChat();
    var mod = Arcade.games[id];
    var meta = catById(id);
    var online = S.mode === 'online';

    // top bar dressing
    document.getElementById('game-icon').innerHTML = icon(meta.id, meta.accent, 26);
    document.getElementById('game-icon').style.background = 'radial-gradient(closest-side,' + meta.accent + '33,transparent)';
    var title = document.getElementById('game-title');
    title.textContent = meta.name; title.style.color = meta.accent; title.style.textShadow = '0 0 14px ' + meta.accent;
    document.getElementById('mode-badge').textContent = online ? '🌐 WEB' : '🎮 LOCAL';
    document.getElementById('series').hidden = online;
    document.getElementById('series-p1').textContent = '0';
    document.getElementById('series-p2').textContent = '0';
    document.getElementById('btn-rematch').style.background = meta.accent;
    document.getElementById('btn-rematch').style.boxShadow = '0 0 22px ' + meta.accent;
    document.getElementById('btn-rematch').textContent = online ? '▸ CONTINUE' : '↻ REMATCH';

    hideOverlays();
    S.game = mod ? mod.fresh(api) : { cur: 1, winner: null };

    showScreen('game');

    if (online && mod && mod.online) {
      S.matchState = 'waiting';
      document.getElementById('ov-waiting').hidden = false;
      send({ type: 'selectGame', game: id }); send({ type: 'join' });
      pushSys('Searching for an opponent…');
    } else {
      S.matchState = 'playing';
      if (online) pushSys('This game is local-only for now.');
      else pushSys('Local 2-player. Player 1 = pink, Player 2 = amber.');
      if (mod && mod.start) mod.start(api);
    }
    renderBoard(); renderStatus();
  }

  function goLobby() {
    sfx('click');
    var mod = activeGame();
    if (mod && mod.stop) mod.stop(api);
    S.screen = 'lobby'; S.gameId = null; S.matchState = 'idle'; S.winInfo = null;
    hideOverlays();
    showScreen('lobby');
    requestAnimationFrame(function () { requestAnimationFrame(setupRunner); });
    setTimeout(setupRunner, 180);
  }

  function showScreen(which) {
    document.getElementById('lobby').hidden = which !== 'lobby';
    document.getElementById('game-screen').hidden = which !== 'game';
    if (which === 'lobby') renderRoster();
  }

  /* ============================================================
     BOARD + STATUS RENDER
     ============================================================ */
  function renderBoard() {
    var root = document.getElementById('board');
    if (!root) return;
    root.innerHTML = '';
    var mod = activeGame();
    if (mod && mod.render) mod.render(root, api);
    else root.appendChild(comingSoon());
  }
  function comingSoon() {
    return h('div', { style: {
      width: 420, height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '1.5px dashed rgba(255,255,255,.18)', borderRadius: 16, color: '#74618f',
      fontFamily: "'Press Start 2P',monospace", fontSize: 11, textAlign: 'center', lineHeight: 1.8, whiteSpace: 'pre-line'
    } }, 'COMING\nSOON…');
  }
  function pill(txt, color, glow) {
    return h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 11, color: color, textShadow: glow ? '0 0 12px ' + color : 'none', letterSpacing: 1 } }, txt);
  }
  function renderStatus() {
    var slot = document.getElementById('status'); if (!slot) return;
    slot.innerHTML = '';
    var g = S.game, mod = activeGame();
    if (!g) return;
    if (S.matchState === 'waiting') { slot.appendChild(pill('CONNECTING…', '#74618f', false)); return; }
    if (mod && mod.status) { var node = mod.status(g, api); if (node) { slot.appendChild(node); return; } }
    if (g.winner === 'Draw') { slot.appendChild(pill('DRAW GAME', '#74618f', false)); return; }
    // default turn indicator
    var cur = g.cur;
    var isP1 = cur === 1 || cur === 'X' || cur == null;
    var c = isP1 ? P1 : P2;
    slot.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } }, [
      h('span', { style: { width: 12, height: 12, borderRadius: '50%', background: c, boxShadow: '0 0 12px ' + c } }),
      pill("PLAYER " + (isP1 ? 1 : 2) + "'S TURN", c, true)
    ]));
  }

  /* ============================================================
     WIN / OVERLAYS
     ============================================================ */
  function hideOverlays() {
    document.getElementById('ov-waiting').hidden = true;
    document.getElementById('ov-countdown').hidden = true;
    document.getElementById('ov-winner').hidden = true;
  }
  function showCountdown(txt) {
    document.getElementById('count-num').textContent = txt;
    document.getElementById('ov-countdown').hidden = false;
  }
  function endRound(winner) {
    var w = winner; if (w === 'X') w = 1; if (w === 'O') w = 2;
    sfx(w === 0 ? 'beep' : 'win');
    setTimeout(function () { showWin(w); }, 650);
  }
  function showWin(winner) {
    var w = winner; if (w === 'X') w = 1; if (w === 'O') w = 2; if (w === 'Draw') w = 0;
    S.winInfo = w;
    document.getElementById('ov-waiting').hidden = true;
    document.getElementById('ov-countdown').hidden = true;
    S.matchState = 'done';
    if (S.mode === 'local' && (w === 1 || w === 2)) {
      S.series[w - 1]++;
      document.getElementById('series-p1').textContent = S.series[0];
      document.getElementById('series-p2').textContent = S.series[1];
    }
    var meta = catById(S.gameId);
    var winColor = w === 0 ? '#74618f' : (w === 1 ? P1 : P2);
    var winText = w === 0 ? 'DRAW!'
      : (S.mode === 'online' ? (w === (S.mySymbol === 'X' ? 1 : 2) ? 'YOU WIN!' : 'YOU LOSE') : 'PLAYER ' + w + '\nWINS!');
    document.getElementById('win-kicker').textContent = w === 0 ? 'STALEMATE' : 'GAME OVER';
    var wt = document.getElementById('win-text');
    wt.textContent = winText; wt.style.color = winColor; wt.style.textShadow = '0 0 24px ' + winColor;
    document.getElementById('ov-winner').hidden = false;
  }
  function playAgain() {
    var id = S.gameId, mod = activeGame();
    // ----- ONLINE: the server keeps the session and resets the round
    // itself, so "continue" just dismisses the overlay onto the fresh board.
    if (S.mode === 'online') {
      sfx('click');
      hideOverlays();
      S.winInfo = null; S.matchState = 'playing';
      renderBoard(); renderStatus();
      return;
    }
    sfx('go');
    hideOverlays();
    S.winInfo = null; S.matchState = 'playing';
    if (mod && mod.stop) mod.stop(api);
    S.game = mod ? mod.fresh(api) : { cur: 1, winner: null };
    if (mod && mod.start) mod.start(api);
    renderBoard(); renderStatus();
  }

  /* ============================================================
     API handed to game modules
     ============================================================ */
  var api = {
    P1: P1, P2: P2, h: h, icon: icon,
    get mode() { return S.mode; },
    get mySymbol() { return S.mySymbol; },
    set mySymbol(v) { S.mySymbol = v; },
    get matchState() { return S.matchState; },
    set matchState(v) { S.matchState = v; },
    get gameId() { return S.gameId; },
    get screen() { return S.screen; },
    get game() { return S.game; },
    get soundOn() { return S.soundOn; },
    send: send, sfx: sfx, tone: tone,
    setGame: function (u) { S.game = (typeof u === 'function') ? u(S.game) : Object.assign({}, S.game, u); },
    rerender: function () { renderBoard(); renderStatus(); },
    refreshStatus: renderStatus,
    pill: pill,
    endRound: endRound, showWin: showWin,
    pushSys: pushSys, pushChat: pushChat,
    hideWaiting: function () { document.getElementById('ov-waiting').hidden = true; document.getElementById('ov-countdown').hidden = true; }
  };

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    buildStars();
    buildCoin();
    // test/debug seam: lets tooling inject a server message as if received
    Arcade._inject = function (data) { onServer(data); };
    buildRunnerSprite();
    buildLobby();
    setMode('local');

    document.getElementById('root').addEventListener('mousemove', onStarHover);
    document.getElementById('sound-lobby').addEventListener('click', toggleSound);
    document.getElementById('sound-game').addEventListener('click', toggleSound);
    document.getElementById('mode-local').addEventListener('click', function () { setMode('local'); });
    document.getElementById('mode-online').addEventListener('click', function () { setMode('online'); });
    document.getElementById('exit-btn').addEventListener('click', goLobby);
    document.getElementById('btn-games').addEventListener('click', goLobby);
    document.getElementById('btn-rematch').addEventListener('click', playAgain);
    document.getElementById('chat-send').addEventListener('click', sendChat);
    document.getElementById('chat-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendChat(); });

    window.addEventListener('resize', setupRunner);
    window.addEventListener('storage', function (e) { if (e.key === 'arcade_dressup_avatars') renderRoster(); });
    _smokeTimer = setInterval(smokeTick, 55);

    connect();
    setupRunner();
    setTimeout(setupRunner, 200);
  }

  function toggleSound() {
    S.soundOn = !S.soundOn;
    var ico = S.soundOn ? '🔊' : '🔇', lbl = S.soundOn ? 'SFX ON' : 'SFX OFF';
    document.querySelector('#sound-lobby .sound-ico').textContent = ico;
    document.querySelector('#sound-lobby .sound-label').textContent = lbl;
    document.getElementById('sound-game').textContent = ico;
    sfx('click');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

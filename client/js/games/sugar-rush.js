/* ============================================================
   Sugar Rush — local 2P, canvas + physics.

   Each player gets a turn: draw ramps with the mouse to funnel
   falling sugar into the cup before the timer runs out. Most
   sugar collected wins. Uses the start()/stop() lifecycle hooks
   for its requestAnimationFrame loop, and updates its HUD in
   place so the canvas is never torn down mid-animation.
   ============================================================ */
(function () {
  var P1 = '#ff2d9b', P2 = '#ffb000';
  var W = 460, H = 440;

  // module-local runtime (not part of the serialisable game state)
  var M = { canvas: null, sg: null, phaseStart: 0, raf: null, hud: null, lastCount: -1, lastInt: -1, lastInk: -1 };

  function freshSim() {
    return { grains: [], lines: [], stroke: null, count: 0, ink: 950, drawing: false, sid: 0, spawnAcc: 0 };
  }

  function commitStroke(api) {
    var sg = M.sg; if (!sg) return;
    if (!sg.stroke || sg.stroke.length < 2) { sg.stroke = null; return; }
    var sid = (sg.sid = (sg.sid || 0) + 1);
    for (var k = 1; k < sg.stroke.length; k++) { var a = sg.stroke[k - 1], b = sg.stroke[k]; sg.lines.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, sid: sid }); }
    sg.stroke = null; api.sfx('place');
  }

  function pointer(type, e, api) {
    var g = api.game, sg = M.sg, cv = M.canvas;
    if (!sg || !g || g.winner || !cv) return;
    var rect = cv.getBoundingClientRect();
    var ct = (e.touches && e.touches[0]) || e;
    var x = ct.clientX - rect.left, y = ct.clientY - rect.top;
    if (type === 'down') { sg.stroke = [{ x: x, y: y }]; sg.drawing = true; }
    else if (type === 'move') {
      if (!sg.drawing || !sg.stroke) return;
      var last = sg.stroke[sg.stroke.length - 1];
      var dl = Math.hypot(x - last.x, y - last.y);
      if (dl < 6) return;
      if (sg.ink <= 0) { sg.drawing = false; commitStroke(api); return; }
      sg.ink = Math.max(0, sg.ink - dl);
      sg.stroke.push({ x: x, y: y });
      M.lastInk = -999;
    } else if (type === 'up') { sg.drawing = false; commitStroke(api); }
  }

  function frame(now, api) {
    if (api.screen !== 'game' || api.gameId !== 'sugar') { M.raf = null; return; }
    M.raf = requestAnimationFrame(function (t) { frame(t, api); });
    var cv = M.canvas, g = api.game, sg = M.sg;
    if (!cv || !g || !sg || g.winner) return;
    var ctx = cv.getContext('2d');
    var ARM = 1.7;
    var elapsed = (now - M.phaseStart) / 1000;
    var armed = elapsed >= ARM;
    var playT = Math.max(0, elapsed - ARM);
    var timeLeft = Math.max(0, Math.ceil(g.dur - playT));

    var cupW = 96, cupH = 116, cupX = W - cupW - 26, cupY = H - cupH - 8, wall = 9;
    var spoutX = 66 + Math.sin(now / 520) * 26;
    if (armed && timeLeft > 0 && sg.grains.length < 300) {
      sg.spawnAcc += 1;
      if (sg.spawnAcc >= 2) { sg.spawnAcc = 0; sg.grains.push({ x: spoutX + (Math.random() * 8 - 4), y: 24, vx: (Math.random() * .6 - .3), vy: 1.0 }); }
    }

    var GR = 0.22, r = 3, rad = r + 3.6, lines = sg.lines;
    grainLoop:
    for (var i = sg.grains.length - 1; i >= 0; i--) {
      var p = sg.grains[i];
      p.vy += GR; p.vx *= 0.995;
      if (p.vy > 8.5) p.vy = 8.5;
      var spd = Math.hypot(p.vx, p.vy);
      var steps = Math.min(7, Math.max(1, Math.ceil(spd / 2.5)));
      for (var st = 0; st < steps; st++) {
        p.x += p.vx / steps; p.y += p.vy / steps;
        for (var li = 0; li < lines.length; li++) {
          var s = lines[li];
          var dx = s.bx - s.ax, dy = s.by - s.ay;
          var len2 = dx * dx + dy * dy; if (len2 < 1) continue;
          var tt = ((p.x - s.ax) * dx + (p.y - s.ay) * dy) / len2;
          tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
          var cx = s.ax + dx * tt, cy = s.ay + dy * tt;
          var ox = p.x - cx, oy = p.y - cy;
          var d2 = ox * ox + oy * oy;
          if (d2 < rad * rad) {
            var d = Math.sqrt(d2) || 0.0001;
            var nx = ox / d, ny = oy / d;
            if (d < 0.05) { nx = 0; ny = -1; }
            p.x = cx + nx * rad; p.y = cy + ny * rad;
            var vn = p.vx * nx + p.vy * ny;
            p.vx -= 1.0 * vn * nx; p.vy -= 1.0 * vn * ny;
            p.vx *= 0.97; p.vy *= 0.97;
          }
        }
        if (p.y > cupY && p.x > cupX && p.x < cupX + cupW) { sg.count++; sg.grains.splice(i, 1); continue grainLoop; }
      }
      if (p.y > cupY - 2 && p.y < cupY + cupH) {
        if (p.x > cupX - rad && p.x < cupX) { p.x = cupX - rad; p.vx = -Math.abs(p.vx) * .4; }
        else if (p.x < cupX + cupW + rad && p.x > cupX + cupW) { p.x = cupX + cupW + rad; p.vx = Math.abs(p.vx) * .4; }
      }
      if (p.y > H + 20 || p.x < -20 || p.x > W + 20) sg.grains.splice(i, 1);
    }

    // ---- draw ----
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#3a2a52'; ctx.fillRect(spoutX - 16, 6, 32, 16);
    ctx.fillStyle = '#2de2ff'; ctx.fillRect(spoutX - 16, 18, 32, 3);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var lineColor = g.active === 1 ? P1 : P2;
    var drawStroke = function (pts) {
      if (pts.length < 2) return;
      ctx.strokeStyle = lineColor; ctx.lineWidth = 6; ctx.shadowColor = lineColor; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.stroke(); ctx.shadowBlur = 0;
    };
    var groups = {};
    sg.lines.forEach(function (s) { (groups[s.sid] = groups[s.sid] || []).push(s); });
    Object.keys(groups).forEach(function (k) {
      var segs = groups[k];
      drawStroke([{ x: segs[0].ax, y: segs[0].ay }].concat(segs.map(function (s) { return { x: s.bx, y: s.by }; })));
    });
    if (sg.stroke && sg.stroke.length) drawStroke(sg.stroke);
    for (var gi = 0; gi < sg.grains.length; gi++) { var gp = sg.grains[gi]; ctx.fillStyle = '#fff6e0'; ctx.fillRect(gp.x - 1.6, gp.y - 1.6, 3.4, 3.4); }
    var fillFrac = Math.min(1, sg.count / g.target);
    var fillH = (cupH - wall) * fillFrac;
    ctx.fillStyle = g.active === 1 ? 'rgba(255,45,155,.85)' : 'rgba(255,176,0,.85)';
    ctx.fillRect(cupX + wall, cupY + cupH - wall - fillH, cupW - wall * 2, fillH);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cupX, cupY); ctx.lineTo(cupX + wall, cupY + cupH); ctx.lineTo(cupX + cupW - wall, cupY + cupH); ctx.lineTo(cupX + cupW, cupY); ctx.stroke();
    if (!armed) {
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = "18px 'Press Start 2P', monospace"; ctx.textAlign = 'center';
      ctx.fillText('GET READY', W / 2, H / 2 - 8);
      ctx.font = "11px 'Press Start 2P', monospace"; ctx.fillStyle = lineColor;
      ctx.fillText('P' + g.active + ' — DRAW YOUR RAMPS', W / 2, H / 2 + 20);
      ctx.textAlign = 'left';
    }

    // ---- HUD sync (update DOM in place — do NOT rebuild) ----
    if (sg.count !== M.lastCount || timeLeft !== M.lastInt || sg.ink !== M.lastInk) {
      M.lastCount = sg.count; M.lastInt = timeLeft; M.lastInk = sg.ink;
      var fills = api.game.fills.slice(); fills[g.active - 1] = sg.count;
      api.setGame(Object.assign({}, api.game, { fills: fills, timeLeft: timeLeft, ink: sg.ink }));
      if (M.hud) {
        M.hud.count.textContent = sg.count + '/' + g.target;
        M.hud.time.textContent = String(timeLeft);
        M.hud.ink.style.width = (Math.max(0, Math.min(1, sg.ink / 950)) * 100) + '%';
      }
    }

    // ---- phase advance ----
    var filled = sg.count >= g.target;
    if (armed && (timeLeft <= 0 || filled)) {
      var f2 = api.game.fills.slice(); f2[g.active - 1] = sg.count;

      // ----- ONLINE: report my round, then wait for the server -----
      if (M.mode === 'online') {
        api.setGame(Object.assign({}, api.game, { phase: 'submitted', fills: f2 }));
        if (M.raf) { cancelAnimationFrame(M.raf); M.raf = null; }
        api.send({ game: 'sugar', type: 'result', count: sg.count });
        api.sfx('beep'); api.rerender(); api.refreshStatus();
        return;
      }

      // ----- LOCAL: P1 then P2, then compare -----
      if (g.active === 1) {
        api.setGame(Object.assign({}, api.game, { active: 2, phase: 'p2', fills: f2, timeLeft: g.dur, ink: 950 }));
        M.sg = freshSim(); M.phaseStart = performance.now(); M.lastCount = -1; M.lastInt = -1; M.lastInk = -1;
        api.sfx('go'); api.rerender(); api.refreshStatus();
      } else {
        var w = f2[0] === f2[1] ? 0 : (f2[0] > f2[1] ? 1 : 2);
        api.setGame(Object.assign({}, api.game, { phase: 'done', fills: f2, winner: w === 0 ? 'Draw' : w }));
        if (M.raf) { cancelAnimationFrame(M.raf); M.raf = null; }
        api.endRound(w);
      }
    }
  }

  function myNum(api) { return api.mySymbol === 'O' ? 2 : 1; }
  function beginRound(api) {
    M.sg = freshSim(); M.phaseStart = performance.now();
    M.lastCount = -1; M.lastInt = -1; M.lastInk = -1;
    if (M.raf) cancelAnimationFrame(M.raf);
    M.raf = requestAnimationFrame(function (t) { frame(t, api); });
  }

  Arcade.registerGame('sugar', {
    meta: { name: 'SUGAR RUSH', accent: '#ff5a5a' },
    online: true,

    fresh: function () { return { sugar: true, phase: 'p1', active: 1, fills: [0, 0], target: 38, timeLeft: 20, dur: 20, ink: 950, winner: null }; },

    start: function (api) {
      M.mode = 'local';
      beginRound(api);
    },
    stop: function () { if (M.raf) { cancelAnimationFrame(M.raf); M.raf = null; } M.canvas = null; M.sg = null; M.hud = null; M.mode = null; },

    onServer: function (data, api) {
      if (data.game !== 'sugar') return;
      M.mode = 'online';
      var mine = myNum(api);
      if (data.type === 'init') {
        api.mySymbol = data.symbol; api.matchState = 'playing'; api.hideWaiting();
        var active = (data.active === 'O') ? 2 : 1;
        api.setGame({ sugar: true, phase: 'play', active: active, fills: [0, 0], target: data.target || 38, timeLeft: 20, dur: 20, ink: 950, winner: null });
        api.rerender(); api.refreshStatus();
        if (active === myNum(api)) beginRound(api); // my turn first
        return;
      }
      if (data.type === 'turn') {
        if (M.raf) { cancelAnimationFrame(M.raf); M.raf = null; }
        var act = (data.active === 'O') ? 2 : 1;
        api.setGame(Object.assign({}, api.game, { active: act, phase: 'play', fills: [data.fills.X || 0, data.fills.O || 0], timeLeft: 20, ink: 950 }));
        api.rerender(); api.refreshStatus();
        if (act === myNum(api)) beginRound(api);
        return;
      }
      if (data.type === 'over') {
        if (M.raf) { cancelAnimationFrame(M.raf); M.raf = null; }
        var w = data.winner === 'Draw' ? 0 : (data.winner === 'O' ? 2 : 1);
        api.setGame(Object.assign({}, api.game, { phase: 'done', fills: [data.fills.X, data.fills.O], winner: data.winner === 'Draw' ? 'Draw' : w }));
        api.rerender();
        if (w === 0) api.sfx('beep'); else api.sfx(data.winner === api.mySymbol ? 'win' : 'lose');
        api.showWin(w);
        return;
      }
      if (data.type === 'restart') {
        var a2 = (data.active === 'O') ? 2 : 1;
        api.setGame({ sugar: true, phase: 'play', active: a2, fills: [0, 0], target: api.game.target || 38, timeLeft: 20, dur: 20, ink: 950, winner: null });
        api.matchState = 'playing'; api.rerender(); api.refreshStatus();
        if (a2 === myNum(api)) beginRound(api);
        return;
      }
    },

    status: function (g, api) {
      if (g.winner) return api.pill('FINISHED', '#74618f', false);
      if (api.mode === 'online') {
        var mineTurn = g.active === myNum(api);
        return api.pill(mineTurn ? 'YOUR ROUND — FILL UP!' : 'OPPONENT IS PLAYING…', mineTurn ? (myNum(api) === 1 ? api.P1 : api.P2) : '#74618f', mineTurn);
      }
      var sc = g.active === 1 ? api.P1 : api.P2;
      return api.pill('PLAYER ' + g.active + ' — FILL UP!', sc, true);
    },

    render: function (root, api) {
      var h = api.h, g = api.game;

      // ONLINE: when it isn't my round, show a waiting panel instead of the canvas
      if (api.mode === 'online' && !g.winner) {
        var mineTurn = g.active === myNum(api);
        if (!mineTurn || g.phase === 'submitted') {
          var waitingForMe = g.phase === 'submitted';
          var myFill = g.fills[myNum(api) - 1] || 0;
          root.appendChild(h('div', { style: { width: W + 'px', height: (H + 64) + 'px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, borderRadius: 14, background: 'radial-gradient(120% 120% at 50% 0%, rgba(40,20,60,.6), rgba(8,6,15,.9))', border: '2px solid rgba(255,90,90,.25)' } }, [
            h('div', { style: { width: 46, height: 46, border: '3px solid rgba(255,90,90,.25)', borderTopColor: '#ff5a5a', borderRadius: '50%', animation: 'spin .9s linear infinite' } }),
            h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 12, color: '#ff5a5a', textAlign: 'center', lineHeight: 1.7, whiteSpace: 'pre-line' } }, waitingForMe ? 'ROUND SUBMITTED' : 'OPPONENT IS\nPLAYING…'),
            h('div', { style: { fontSize: 13, color: '#8c78a8', textAlign: 'center' } }, waitingForMe ? ('You poured ' + myFill + ' sugar. Waiting for your opponent…') : 'You go after they finish their round.')
          ]));
          return;
        }
      }

      var accent = g.active === 1 ? api.P1 : api.P2;

      var inkBar = h('div', { style: { width: (Math.max(0, Math.min(1, (g.ink || 0) / 950)) * 100) + '%', height: '100%', background: accent } });
      var countEl = h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 11, color: accent } }, ((g.fills && g.fills[g.active - 1]) || 0) + '/' + g.target);
      var timeEl = h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 14, color: '#ffb000', textShadow: '0 0 10px rgba(255,176,0,.6)', minWidth: 30, textAlign: 'right' } }, String(g.timeLeft != null ? g.timeLeft : g.dur));
      M.hud = { ink: inkBar, count: countEl, time: timeEl };

      var hud = h('div', { style: { width: W + 'px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 } }, [
        h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 9, color: accent, textShadow: '0 0 10px ' + accent, whiteSpace: 'nowrap' } }, 'P' + g.active),
        h('div', { style: { flex: 1, height: 10, borderRadius: 6, background: 'rgba(255,255,255,.08)', overflow: 'hidden', border: '1px solid rgba(255,255,255,.12)' } }, inkBar),
        h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 7, color: '#74618f' } }, 'INK'),
        timeEl, countEl
      ]);

      var canvas = h('canvas', {
        width: W, height: H,
        ref: function (el) { M.canvas = el; },
        onMouseDown: function (e) { pointer('down', e, api); },
        onMouseMove: function (e) { pointer('move', e, api); },
        onMouseUp: function (e) { pointer('up', e, api); },
        onMouseLeave: function (e) { pointer('up', e, api); },
        onTouchStart: function (e) { e.preventDefault(); pointer('down', e, api); },
        onTouchMove: function (e) { e.preventDefault(); pointer('move', e, api); },
        onTouchEnd: function (e) { pointer('up', e, api); },
        style: { width: W + 'px', height: H + 'px', borderRadius: 14, background: 'radial-gradient(120% 120% at 50% 0%, rgba(40,20,60,.6), rgba(8,6,15,.9))', border: '2px solid rgba(255,90,90,.3)', boxShadow: '0 0 30px rgba(255,90,90,.12)', cursor: 'crosshair', touchAction: 'none', display: 'block' }
      });

      var tip = h('div', { style: { width: W + 'px', marginTop: 10, textAlign: 'center', fontSize: 12, color: '#8c78a8', lineHeight: 1.4 } }, 'Drag to draw ramps — funnel the sugar into your cup before the timer runs out. Players take turns; most sugar wins.');

      root.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } }, [hud, canvas, tip]));
    }
  });
})();

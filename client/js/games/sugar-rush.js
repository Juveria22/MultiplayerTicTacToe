/* ============================================================
   Sugar Rush - local 2P + online, canvas + granular physics.

   Each player gets a turn: draw ramps with the mouse to funnel
   falling sugar into the cup before the timer runs out. Most
   sugar collected wins.

   PHYSICS (v2): grains are real particles with grain-to-grain
   collision resolved on a spatial hash, so sugar piles, heaps and
   settles like sand instead of vanishing. Low restitution + tangential
   friction give it a granular, non-bouncy feel. Grains rest on ramps,
   blocks, cup walls and the floor.

   VARIETY: every round builds a fresh randomised level -
     · the spout appears top-left / top-centre / top-right, or as a
       side chute that fires sugar in sideways;
     · the cup changes width, height, position and wall taper;
     · 0–2 obstacles (ledges / round pegs) may block the fall.

   Uses start()/stop() for the rAF loop and updates its HUD in place.
   ============================================================ */
(function () {
  var P1 = '#ff2d9b', P2 = '#ffb000';
  var W = 460, H = 440;

  // grain physics constants
  var GR = 0.30, MAXSPD = 9.5, RG = 2.9, SRAD = 6, MAXG = 280;

  // module-local runtime (not part of the serialisable game state)
  var M = { canvas: null, sg: null, phaseStart: 0, raf: null, hud: null, lastCount: -1, lastInt: -1, lastInk: -1, level: null, segStatic: [], pegs: [] };

  function freshSim() {
    return { grains: [], lines: [], stroke: null, count: 0, ink: 950, drawing: false, sid: 0, spawnAcc: 0 };
  }

  /* --------------------- level generation -------------------------- */
  function makeLevel() {
    var r = Math.random;
    // ----- spout -----
    var spout;
    if (r() < 0.24) {
      // side chute - fires sugar in from the left, moving right
      spout = { side: true, x: 12, y: 54 + r() * 90, vx: 2.2 + r() * 1.4, drift: 0 };
    } else {
      var spots = [{ x: 66, drift: 24 }, { x: W / 2, drift: 42 }, { x: W - 88, drift: 24 }];
      var s = spots[(r() * spots.length) | 0];
      spout = { side: false, x: s.x, y: 22, vx: 0, drift: s.drift };
    }
    // ----- cup -----
    var cupW = 84 + ((r() * 48) | 0);
    var cupH = 92 + ((r() * 46) | 0);
    var margin = 18;
    var cupX = margin + r() * (W - cupW - margin * 2);
    var cupY = H - cupH - 6;
    var tp = [0.0, 0.10, 0.20][(r() * 3) | 0];   // wall taper (narrower base)
    var cup = {
      x: cupX, y: cupY, w: cupW, h: cupH, wall: 9, tp: tp,
      topLx: cupX, topRx: cupX + cupW,
      botLx: cupX + tp * cupW, botRx: cupX + cupW - tp * cupW
    };
    // ----- obstacles -----
    var blocks = [], pegs = [];
    var n = r() < 0.32 ? 0 : (r() < 0.72 ? 1 : 2);
    for (var i = 0; i < n; i++) {
      if (r() < 0.5) {
        var bw = 58 + r() * 72, bh = 12 + r() * 10;
        var bx = 34 + r() * (W - 68 - bw);
        var by = 150 + r() * 150;
        // keep clear of the cup mouth
        if (by > cupY - 30) by = cupY - 40;
        blocks.push({ x: bx, y: by, w: bw, h: bh });
      } else {
        var pr = 13 + r() * 15;
        var px = 60 + r() * (W - 120);
        var py = 150 + r() * 150;
        if (py > cupY - 30) py = cupY - 40;
        pegs.push({ x: px, y: py, r: pr });
      }
    }
    return { spout: spout, cup: cup, blocks: blocks, pegs: pegs };
  }

  function buildStatic(level) {
    var segs = [];
    function seg(ax, ay, bx, by) { segs.push({ ax: ax, ay: ay, bx: bx, by: by }); }
    // field floor + side walls
    seg(0, H - 2, W, H - 2);
    seg(1, 0, 1, H);
    seg(W - 1, 0, W - 1, H);
    // cup trapezoid (left wall, right wall, floor)
    var c = level.cup;
    seg(c.topLx, c.y, c.botLx, c.y + c.h);
    seg(c.topRx, c.y, c.botRx, c.y + c.h);
    seg(c.botLx, c.y + c.h, c.botRx, c.y + c.h);
    // blocks (4 edges each)
    level.blocks.forEach(function (b) {
      seg(b.x, b.y, b.x + b.w, b.y);
      seg(b.x + b.w, b.y, b.x + b.w, b.y + b.h);
      seg(b.x + b.w, b.y + b.h, b.x, b.y + b.h);
      seg(b.x, b.y + b.h, b.x, b.y);
    });
    M.segStatic = segs;
    M.pegs = level.pegs;
  }

  function insideCup(c, x, y) {
    if (y <= c.y + 3 || y >= c.y + c.h) return false;
    var f = (y - c.y) / c.h;
    var lx = c.topLx + (c.botLx - c.topLx) * f + c.wall * 0.5;
    var rx = c.topRx + (c.botRx - c.topRx) * f - c.wall * 0.5;
    return x > lx && x < rx;
  }

  /* --------------------- collision helpers ------------------------- */
  function collideSeg(p, ax, ay, bx, by, rad) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy; if (len2 < 1) return;
    var tt = ((p.x - ax) * dx + (p.y - ay) * dy) / len2;
    tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
    var cx = ax + dx * tt, cy = ay + dy * tt;
    var ox = p.x - cx, oy = p.y - cy;
    var d2 = ox * ox + oy * oy;
    if (d2 < rad * rad) {
      var d = Math.sqrt(d2) || 0.0001;
      var nx = ox / d, ny = oy / d;
      if (d < 0.05) { nx = 0; ny = -1; }
      p.x = cx + nx * rad; p.y = cy + ny * rad;
      var vn = p.vx * nx + p.vy * ny;
      if (vn < 0) {
        var e = 0.12;                       // low restitution - sand, not rubber
        p.vx -= (1 + e) * vn * nx; p.vy -= (1 + e) * vn * ny;
        p.vx *= 0.84; p.vy *= 0.84;         // tangential friction
      }
    }
  }
  function collidePeg(p, px, py, pr, rad) {
    var ox = p.x - px, oy = p.y - py;
    var d2 = ox * ox + oy * oy, R = pr + rad;
    if (d2 < R * R) {
      var d = Math.sqrt(d2) || 0.0001;
      var nx = ox / d, ny = oy / d;
      p.x = px + nx * R; p.y = py + ny * R;
      var vn = p.vx * nx + p.vy * ny;
      if (vn < 0) { p.vx -= 1.12 * vn * nx; p.vy -= 1.12 * vn * ny; p.vx *= 0.84; p.vy *= 0.84; }
    }
  }
  // resolve a grain against every solid surface (ramps, the in-progress stroke,
  // static geometry, pegs). Called during integration AND after each grain-grain
  // relaxation pass, so pile pressure can never push sugar through a line.
  function collideSurfaces(p, sg) {
    var lines = sg.lines;
    for (var li = 0; li < lines.length; li++) collideSeg(p, lines[li].ax, lines[li].ay, lines[li].bx, lines[li].by, SRAD);
    if (sg.stroke && sg.stroke.length > 1) {
      for (var qi = 1; qi < sg.stroke.length; qi++) {
        var q0 = sg.stroke[qi - 1], q1 = sg.stroke[qi];
        collideSeg(p, q0.x, q0.y, q1.x, q1.y, SRAD);
      }
    }
    var statics = M.segStatic;
    for (var si = 0; si < statics.length; si++) collideSeg(p, statics[si].ax, statics[si].ay, statics[si].bx, statics[si].by, SRAD);
    var pegs = M.pegs;
    for (var pi = 0; pi < pegs.length; pi++) collidePeg(p, pegs[pi].x, pegs[pi].y, pegs[pi].r, RG);
  }
  function cupContain(p, cup) {
    if (p.y <= cup.y + 2 || p.y >= cup.y + cup.h) return;
    var cf = (p.y - cup.y) / cup.h;
    var outerL = cup.topLx + (cup.botLx - cup.topLx) * cf;
    var outerR = cup.topRx + (cup.botRx - cup.topRx) * cf;
    if (p.x <= outerL || p.x >= outerR) return;      // not inside the cup body
    var cwall = cup.wall * 0.5 + RG;
    var inL = outerL + cwall, inR = outerR - cwall;
    if (inR < inL) { inL = inR = (outerL + outerR) / 2; }
    if (p.x < inL) { p.x = inL; if (p.vx < 0) p.vx *= -0.2; }
    else if (p.x > inR) { p.x = inR; if (p.vx > 0) p.vx *= -0.2; }
    var cfloorY = cup.y + cup.h - cup.wall * 0.5 - RG;
    if (p.y > cfloorY) { p.y = cfloorY; if (p.vy > 0) p.vy *= -0.08; p.vx *= 0.8; }
  }

  /* ---------------------- input handling --------------------------- */
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
    // the canvas draws in a fixed logical space but is displayed at a different
    // CSS size (board auto-fit zoom), so convert screen px -> logical px
    var sx = rect.width ? cv.width / rect.width : 1;
    var sy = rect.height ? cv.height / rect.height : 1;
    var x = (ct.clientX - rect.left) * sx, y = (ct.clientY - rect.top) * sy;
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

  /* --------------------------- loop -------------------------------- */
  function frame(now, api) {
    if (api.screen !== 'game' || api.gameId !== 'sugar') { M.raf = null; return; }
    M.raf = requestAnimationFrame(function (t) { frame(t, api); });
    var cv = M.canvas, g = api.game, sg = M.sg, lvl = M.level;
    if (!cv || !g || !sg || !lvl || g.winner) return;
    var ctx = cv.getContext('2d');
    var ARM = 1.7;
    var elapsed = (now - M.phaseStart) / 1000;
    var armed = elapsed >= ARM;
    var playT = Math.max(0, elapsed - ARM);
    var timeLeft = Math.max(0, Math.ceil(g.dur - playT));
    var cup = lvl.cup, sp = lvl.spout;

    // ---- spawn ----
    var spoutCurX = sp.side ? sp.x : sp.x + Math.sin(now / 560) * sp.drift;
    if (armed && timeLeft > 0 && sg.grains.length < MAXG) {
      sg.spawnAcc += 0.62;
      if (sg.spawnAcc >= 1) {
        sg.spawnAcc -= 1;
        if (sp.side) sg.grains.push({ x: sp.x + 6, y: sp.y + (Math.random() * 14 - 7), vx: sp.vx, vy: Math.random() * .6 - .3 });
        else sg.grains.push({ x: spoutCurX + (Math.random() * 8 - 4), y: 26, vx: (Math.random() * .5 - .25), vy: 1.2 });
      }
    }

    // ---- integrate (surface collision during substeps prevents tunneling) ----
    for (var i = 0; i < sg.grains.length; i++) {
      var p = sg.grains[i];
      p.vy += GR * 0.62; p.vx *= 0.999;   // gentler gravity - sugar falls slower
      var spd = Math.hypot(p.vx, p.vy);
      if (spd > MAXSPD) { p.vx *= MAXSPD / spd; p.vy *= MAXSPD / spd; spd = MAXSPD; }
      var steps = Math.min(4, Math.max(1, Math.ceil(spd / 2.5)));
      for (var st = 0; st < steps; st++) {
        p.x += p.vx / steps; p.y += p.vy / steps;
        collideSurfaces(p, sg);
      }
    }

    // ---- constraint relaxation: grain-grain, then RE-ENFORCE every surface +
    //      the cup, so pile pressure can't shove sugar through a drawn line ----
    var CELL = 12, minD = 2 * RG, minD2 = minD * minD;
    for (var iter = 0; iter < 3; iter++) {
      var hash = {};
      for (var hi = 0; hi < sg.grains.length; hi++) {
        var gp = sg.grains[hi];
        var key = ((gp.x / CELL) | 0) + '_' + ((gp.y / CELL) | 0);
        (hash[key] || (hash[key] = [])).push(hi);
      }
      for (var ci = 0; ci < sg.grains.length; ci++) {
        var a = sg.grains[ci];
        var gxk = (a.x / CELL) | 0, gyk = (a.y / CELL) | 0;
        for (var ax2 = -1; ax2 <= 1; ax2++) for (var ay2 = -1; ay2 <= 1; ay2++) {
          var arr = hash[(gxk + ax2) + '_' + (gyk + ay2)]; if (!arr) continue;
          for (var ni = 0; ni < arr.length; ni++) {
            var j = arr[ni]; if (j <= ci) continue;
            var b = sg.grains[j];
            var dx = b.x - a.x, dy = b.y - a.y, dd = dx * dx + dy * dy;
            if (dd < minD2 && dd > 0.0001) {
              var d = Math.sqrt(dd);
              var nx = dx / d, ny = dy / d, push = (minD - d) * 0.5;
              a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
              var rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
              if (rvn < 0) { var imp = rvn * 0.5; a.vx += imp * nx; a.vy += imp * ny; b.vx -= imp * nx; b.vy -= imp * ny; }
            }
          }
        }
      }
      // re-solve solids + cup after grains have pushed each other around
      for (var ei = 0; ei < sg.grains.length; ei++) { collideSurfaces(sg.grains[ei], sg); cupContain(sg.grains[ei], cup); }
    }

    // ---- count grains resting in the cup ----
    var count = 0;
    for (var k2 = 0; k2 < sg.grains.length; k2++) { if (insideCup(cup, sg.grains[k2].x, sg.grains[k2].y)) count++; }
    sg.count = count;

    // ---- draw ----
    ctx.clearRect(0, 0, W, H);
    // spout
    if (sp.side) {
      ctx.fillStyle = '#3a2a52'; ctx.fillRect(0, sp.y - 12, 24, 24);
      ctx.fillStyle = '#2de2ff'; ctx.fillRect(20, sp.y - 12, 3, 24);
    } else {
      ctx.fillStyle = '#3a2a52'; ctx.fillRect(spoutCurX - 16, 6, 32, 16);
      ctx.fillStyle = '#2de2ff'; ctx.fillRect(spoutCurX - 16, 18, 32, 3);
    }
    // obstacles
    lvl.blocks.forEach(function (b) {
      ctx.fillStyle = 'rgba(120,90,160,.5)'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(180,140,220,.8)'; ctx.lineWidth = 2; ctx.strokeRect(b.x, b.y, b.w, b.h);
    });
    lvl.pegs.forEach(function (pg) {
      ctx.fillStyle = 'rgba(120,90,160,.5)'; ctx.beginPath(); ctx.arc(pg.x, pg.y, pg.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(180,140,220,.8)'; ctx.lineWidth = 2; ctx.stroke();
    });
    // ramps
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
    Object.keys(groups).forEach(function (kk) {
      var segs = groups[kk];
      drawStroke([{ x: segs[0].ax, y: segs[0].ay }].concat(segs.map(function (s) { return { x: s.bx, y: s.by }; })));
    });
    if (sg.stroke && sg.stroke.length) drawStroke(sg.stroke);
    // grains (tint the ones sitting in the cup with the player's colour)
    var potColor = g.active === 1 ? '#ff7ac0' : '#ffce6b';
    for (var gi = 0; gi < sg.grains.length; gi++) {
      var q = sg.grains[gi];
      ctx.fillStyle = insideCup(cup, q.x, q.y) ? potColor : '#fff6e0';
      ctx.fillRect(q.x - 1.7, q.y - 1.7, 3.5, 3.5);
    }
    // cup walls (drawn last, on top)
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cup.topLx, cup.y); ctx.lineTo(cup.botLx, cup.y + cup.h);
    ctx.lineTo(cup.botRx, cup.y + cup.h); ctx.lineTo(cup.topRx, cup.y);
    ctx.stroke();
    if (!armed) {
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = "18px 'Press Start 2P', monospace"; ctx.textAlign = 'center';
      ctx.fillText('GET READY', W / 2, H / 2 - 8);
      ctx.font = "11px 'Press Start 2P', monospace"; ctx.fillStyle = lineColor;
      ctx.fillText('P' + g.active + ' - DRAW YOUR RAMPS', W / 2, H / 2 + 20);
      ctx.textAlign = 'left';
    }

    // ---- HUD sync (update DOM in place - do NOT rebuild) ----
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
    // once the spout is done, end as soon as all the sugar has come to rest
    var settled = false;
    if (armed && timeLeft <= 0) {
      settled = true;
      for (var q = 0; q < sg.grains.length; q++) {
        var gp = sg.grains[q];
        if (Math.abs(gp.vx) > 0.22 || Math.abs(gp.vy) > 0.22) { settled = false; break; }
      }
      if (sg.grains.length === 0) settled = true;
    }
    if (armed && (settled || filled)) {
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
        beginRound(api, true);   // same level for P2 - keep the match fair
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
  function beginRound(api, keepLevel) {
    M.sg = freshSim(); M.phaseStart = performance.now();
    M.lastCount = -1; M.lastInt = -1; M.lastInk = -1;
    if (!keepLevel || !M.level) { M.level = makeLevel(); }
    buildStatic(M.level);
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
    stop: function () { if (M.raf) { cancelAnimationFrame(M.raf); M.raf = null; } M.canvas = null; M.sg = null; M.hud = null; M.mode = null; M.level = null; },

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
        return api.pill(mineTurn ? 'YOUR ROUND - FILL UP!' : 'OPPONENT IS PLAYING…', mineTurn ? (myNum(api) === 1 ? api.P1 : api.P2) : '#74618f', mineTurn);
      }
      var sc = g.active === 1 ? api.P1 : api.P2;
      return api.pill('PLAYER ' + g.active + ' - FILL UP!', sc, true);
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

      var tip = h('div', { style: { width: W + 'px', marginTop: 10, textAlign: 'center', fontSize: 12, color: '#8c78a8', lineHeight: 1.4 } }, 'Drag to draw ramps - funnel the sugar into your cup before the timer runs out. Every round the spout, cup and obstacles change.');

      root.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } }, [hud, canvas, tip]));
    }
  });
})();

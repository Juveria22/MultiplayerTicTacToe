/* ============================================================
   PONG — local 2P + online.

   LOCAL  : full physics runs client-side in a requestAnimationFrame
            loop. P1 = W / S, P2 = ArrowUp / ArrowDown. First to 7.
   ONLINE : the server is authoritative. It runs the ball + paddle
            physics in a fixed tick and broadcasts { x,y,vx,vy,p1y,
            p2y,s1,s2,winner }. We send our paddle intent (dir -1/0/1)
            and render the broadcast state, extrapolating the ball by
            its velocity so motion stays smooth between packets.

   Field is a fixed logical 800 x 500 space; the canvas is drawn in
   those units and scaled with CSS. All physics constants match the
   server (build/server/server.js — pong engine) exactly.
   ============================================================ */
(function () {
  var ACCENT = '#2de2ff';

  // ---- logical field + physics constants (MUST match the server) ----
  var FW = 800, FH = 500, PW = 15, PH = 94, BR = 9, PADX = 28;
  var PSPEED = 560, BSP0 = 380, BSPMAX = 800, WIN = 7;

  // ---- module-live rendering / loop state ----
  var cv = null, ctx = null, raf = 0, curApi = null, running = false;
  var keys = {}, kd = null, ku = null, lastT = 0, lastDir = 0;
  var L = null;                       // local physics ({x,y,vx,vy,p1y,p2y,launchAt,serveDir})
  var net = null, netShown = null, lastNetT = 0, shownWinner = null;  // online smoothing

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ------------------------- local physics ------------------------- */
  function freshPhysics() {
    return {
      x: FW / 2, y: FH / 2, vx: 0, vy: 0,
      p1y: (FH - PH) / 2, p2y: (FH - PH) / 2,
      launchAt: performance.now() + 750, serveDir: Math.random() < 0.5 ? 1 : -1
    };
  }
  function serve(b, dir) {
    var ang = (Math.random() * 0.5 - 0.25);   // -0.25..0.25 rad
    b.vx = Math.cos(ang) * BSP0 * dir;
    b.vy = Math.sin(ang) * BSP0;
  }
  function bounce(b, py) {
    var rel = clamp((b.y - (py + PH / 2)) / (PH / 2), -1, 1);
    var speed = Math.min(Math.hypot(b.vx, b.vy) * 1.06, BSPMAX);
    var ang = rel * (Math.PI * 0.40);
    var dir = b.vx < 0 ? 1 : -1;              // bounce away from the paddle it hit
    b.vx = dir * speed * Math.cos(ang);
    b.vy = speed * Math.sin(ang);
    curApi.sfx('place');
  }
  function stepPaddles(dt) {
    var d1 = (keys['w'] ? -1 : 0) + (keys['s'] ? 1 : 0);
    var d2 = (keys['arrowup'] ? -1 : 0) + (keys['arrowdown'] ? 1 : 0);
    L.p1y = clamp(L.p1y + d1 * PSPEED * dt, 0, FH - PH);
    L.p2y = clamp(L.p2y + d2 * PSPEED * dt, 0, FH - PH);
  }
  function stepBall(dt) {
    L.x += L.vx * dt; L.y += L.vy * dt;
    if (L.y < BR) { L.y = BR; L.vy = -L.vy; curApi.sfx('flip'); }
    else if (L.y > FH - BR) { L.y = FH - BR; L.vy = -L.vy; curApi.sfx('flip'); }
    // left paddle
    if (L.vx < 0 && L.x - BR <= PADX + PW && L.x - BR >= PADX - 6 &&
        L.y >= L.p1y - BR && L.y <= L.p1y + PH + BR) { L.x = PADX + PW + BR; bounce(L, L.p1y); }
    // right paddle
    if (L.vx > 0 && L.x + BR >= FW - PADX - PW && L.x + BR <= FW - PADX + 6 &&
        L.y >= L.p2y - BR && L.y <= L.p2y + PH + BR) { L.x = FW - PADX - PW - BR; bounce(L, L.p2y); }
    // score
    if (L.x < -BR - 6) score(2);
    else if (L.x > FW + BR + 6) score(1);
  }
  function score(w) {
    var g = curApi.game;
    var s1 = (g.s1 || 0) + (w === 1 ? 1 : 0);
    var s2 = (g.s2 || 0) + (w === 2 ? 1 : 0);
    curApi.sfx('drop');
    var winner = s1 >= WIN ? 1 : (s2 >= WIN ? 2 : null);
    curApi.setGame(function () { return { s1: s1, s2: s2, winner: winner ? (winner === 1 ? 'X' : 'O') : null }; });
    curApi.refreshStatus();
    if (winner) { running = false; curApi.endRound(winner); return; }
    // recentre + serve the opposite way from the previous round
    L.x = FW / 2; L.y = FH / 2; L.vx = 0; L.vy = 0;
    L.serveDir = -L.serveDir;
    L.launchAt = performance.now() + 650;
  }

  /* --------------------------- loop -------------------------------- */
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!lastT) lastT = t;
    var dt = Math.min(0.034, (t - lastT) / 1000); lastT = t;
    var g = curApi.game;

    if (curApi.mode === 'local' && curApi.matchState === 'playing' && !(g && g.winner)) {
      stepPaddles(dt);
      if (L.launchAt) { if (t >= L.launchAt) { serve(L, L.serveDir); L.launchAt = 0; } }
      else stepBall(dt);
    } else if (curApi.mode === 'online' && net) {
      // extrapolate ball by its velocity, gently reconcile toward last packet
      if (!netShown) netShown = { x: net.x, y: net.y, p1y: net.p1y, p2y: net.p2y };
      var frozen = (g && g.winner) || net.frozen;
      if (!frozen) { netShown.x += net.vx * dt; netShown.y += net.vy * dt; }
      netShown.x += (net.x - netShown.x) * 0.16;
      netShown.y += (net.y - netShown.y) * 0.16;
      netShown.p1y += (net.p1y - netShown.p1y) * 0.35;
      netShown.p2y += (net.p2y - netShown.p2y) * 0.35;
    }
    draw();
  }

  /* --------------------------- draw -------------------------------- */
  function snapshot() {
    var g = curApi.game || {};
    if (curApi.mode === 'local') return { x: L.x, y: L.y, p1y: L.p1y, p2y: L.p2y, s1: g.s1 || 0, s2: g.s2 || 0 };
    if (netShown) return { x: netShown.x, y: netShown.y, p1y: netShown.p1y, p2y: netShown.p2y, s1: g.s1 || 0, s2: g.s2 || 0 };
    return { x: FW / 2, y: FH / 2, p1y: (FH - PH) / 2, p2y: (FH - PH) / 2, s1: 0, s2: 0 };
  }
  function draw() {
    if (!ctx) return;
    var s = snapshot();
    ctx.clearRect(0, 0, FW, FH);
    // court
    ctx.fillStyle = '#0a0713';
    ctx.fillRect(0, 0, FW, FH);
    // centre dashed line
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 4; ctx.setLineDash([14, 18]);
    ctx.beginPath(); ctx.moveTo(FW / 2, 8); ctx.lineTo(FW / 2, FH - 8); ctx.stroke();
    ctx.restore();
    // scores
    ctx.save();
    ctx.font = "64px 'Press Start 2P', monospace";
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = curApi.P1; ctx.shadowColor = curApi.P1; ctx.shadowBlur = 18;
    ctx.fillText(String(s.s1), FW * 0.30, 26);
    ctx.fillStyle = curApi.P2; ctx.shadowColor = curApi.P2;
    ctx.fillText(String(s.s2), FW * 0.70, 26);
    ctx.restore();
    // paddles
    drawPaddle(PADX, s.p1y, curApi.P1);
    drawPaddle(FW - PADX - PW, s.p2y, curApi.P2);
    // ball
    ctx.save();
    ctx.shadowColor = ACCENT; ctx.shadowBlur = 22;
    ctx.fillStyle = '#eafbff';
    ctx.beginPath(); ctx.arc(s.x, s.y, BR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawPaddle(x, y, col) {
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 20;
    ctx.fillStyle = col;
    var r = 7;
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + PW, y, x + PW, y + PH, r);
    ctx.arcTo(x + PW, y + PH, x, y + PH, r); ctx.arcTo(x, y + PH, x, y, r);
    ctx.arcTo(x, y, x + PW, y, r); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ---------------------- input handling --------------------------- */
  function computeDir() {
    return (keys['w'] || keys['arrowup'] ? -1 : 0) + (keys['s'] || keys['arrowdown'] ? 1 : 0);
  }
  function attachKeys() {
    detachKeys();
    kd = function (e) {
      var k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'w', 's'].indexOf(k) < 0) return;
      if (k.slice(0, 5) === 'arrow') e.preventDefault();
      keys[k] = true;
      if (curApi.mode === 'online') sendDir();
    };
    ku = function (e) {
      var k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'w', 's'].indexOf(k) < 0) return;
      keys[k] = false;
      if (curApi.mode === 'online') sendDir();
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
  }
  function detachKeys() {
    if (kd) window.removeEventListener('keydown', kd);
    if (ku) window.removeEventListener('keyup', ku);
    kd = ku = null; keys = {};
  }
  function sendDir() {
    var d = computeDir();
    if (d === lastDir) return;
    lastDir = d;
    curApi.send({ game: 'pong', type: 'input', dir: d });
  }

  function startLoop() { lastT = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }

  /* --------------------------- module ------------------------------ */
  Arcade.registerGame('pong', {
    meta: { name: 'PONG', accent: ACCENT },
    online: true,

    fresh: function () {
      net = null; netShown = null; shownWinner = null; lastDir = 0;
      return { s1: 0, s2: 0, winner: null };
    },

    // LOCAL only — the core calls start()/stop() for local play.
    start: function (api) {
      curApi = api; running = true;
      L = freshPhysics();
      attachKeys();
      startLoop();
    },
    stop: function (api) {
      running = false;
      cancelAnimationFrame(raf); raf = 0;
      detachKeys();
    },

    render: function (root, api) {
      curApi = api;
      var h = api.h;
      cv = document.createElement('canvas');
      cv.width = FW; cv.height = FH;
      cv.style.display = 'block';
      cv.style.width = 'min(640px, 78vh)';
      cv.style.maxWidth = '100%';
      cv.style.height = 'auto';
      cv.style.borderRadius = '12px';
      ctx = cv.getContext('2d');

      var controls = api.mode === 'online'
        ? 'MOVE  \u2191 / \u2193   or   W / S'
        : 'P1  W / S      \u00b7      P2  \u2191 / \u2193';

      var wrap = h('div', {
        style: {
          position: 'relative', padding: 10, borderRadius: 16,
          background: 'linear-gradient(180deg,rgba(20,14,32,.9),rgba(8,6,14,.9))',
          border: '2px solid ' + ACCENT + '55', boxShadow: '0 0 30px ' + ACCENT + '22',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8
        }
      }, [
        cv,
        h('div', {
          style: {
            fontFamily: "'Press Start 2P',monospace", fontSize: 9, letterSpacing: 1,
            color: '#74618f', textAlign: 'center'
          }
        }, controls)
      ]);
      root.appendChild(wrap);
      draw();
    },

    status: function (g, api) {
      var h = api.h;
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } }, [
        scorePill(h, api.P1, g.s1 || 0),
        h('span', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 9, color: '#5b4f70' } }, 'FIRST TO ' + WIN),
        scorePill(h, api.P2, g.s2 || 0)
      ]);
    },

    // ONLINE — set up here (the core does NOT call start() online).
    onServer: function (data, api) {
      if (data.game !== 'pong') return;
      curApi = api;
      if (data.type === 'init') {
        api.mySymbol = data.symbol; api.matchState = 'playing'; api.hideWaiting();
        net = null; netShown = null; shownWinner = null; lastDir = 0;
        api.setGame(function () { return { s1: 0, s2: 0, winner: null }; });
        api.rerender(); api.refreshStatus();
        attachKeys(); startLoop();
        return;
      }
      if (data.type === 'state') {
        api.matchState = 'playing';
        net = { x: data.x, y: data.y, vx: data.vx, vy: data.vy, p1y: data.p1y, p2y: data.p2y, frozen: !!data.winner };
        var winner = data.winner || null;
        api.setGame(function () { return { s1: data.s1, s2: data.s2, winner: winner }; });
        api.refreshStatus();
        if (winner && winner !== shownWinner) {
          shownWinner = winner;
          api.sfx(winner === api.mySymbol ? 'win' : 'lose');
          api.showWin(winner === 'X' ? 1 : 2);
        } else if (!winner) { shownWinner = null; }
      }
    }
  });

  function scorePill(h, color, n) {
    return h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px 4px 5px', borderRadius: 20,
        background: color + '1f', border: '1px solid ' + color + '66'
      }
    }, [
      h('div', { style: { width: 16, height: 16, borderRadius: 4, background: color, boxShadow: '0 0 8px ' + color } }),
      h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 12, color: color, textShadow: '0 0 8px ' + color } }, String(n))
    ]);
  }
})();

/* ============================================================
   DOODLE - shared drawing canvas. Local + online.

   LOCAL  : one shared canvas; pick a colour / brush and draw.
   ONLINE : the server relays strokes. Each freehand segment is sent
            as normalised (0..1) coordinates so it lands in the same
            place on the opponent's differently-sized canvas. We draw
            our own strokes immediately and ignore the echo of them,
            applying only the opponent's. CLEAR wipes both canvases.

   No winner - pure co-op. Uses the server's built-in 'drawing' relay
   ({game:'drawing', type:'drawing'|'clear'}), which the live server
   already supports, so online works today.
   ============================================================ */
(function () {
  var ACCENT = '#ffb000';
  var W = 900, H = 540;                       // internal canvas resolution
  var PALETTE = ['#ff2d9b', '#ffb000', '#2de2ff', '#39ff8b', '#b14bff', '#ffffff'];
  var SIZES = { S: 4, M: 9, L: 18 };
  var ERASE_SIZE = 30;

  var cv = null, ctx = null, curApi = null;
  var color = '#2de2ff', brush = 9, erasing = false;
  var drawing = false, lastN = null;
  var swatchEls = [], sizeEls = [], eraseEl = null;

  /* ------------------------- drawing ------------------------------- */
  function drawSeg(x0, y0, x1, y1, col, size, erase) {
    // coords are normalised 0..1
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = size;
    if (erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = size * 0.9;
    }
    ctx.beginPath();
    ctx.moveTo(x0 * W, y0 * H);
    ctx.lineTo(x1 * W, y1 * H);
    ctx.stroke();
    ctx.restore();
  }
  function dot(nx, ny, col, size, erase) { drawSeg(nx, ny, nx + 0.0001, ny, col, size, erase); }

  function posOf(e) {
    var r = cv.getBoundingClientRect();
    var t = (e.touches && e.touches[0]) || e;
    return { x: (t.clientX - r.left) / r.width, y: (t.clientY - r.top) / r.height };
  }
  function relay(obj) {
    if (curApi.mode === 'online') curApi.send(Object.assign({ game: 'drawing', by: curApi.mySymbol }, obj));
  }

  function onDown(e) {
    if (curApi.matchState !== 'playing') return;
    e.preventDefault();
    drawing = true;
    var p = posOf(e); lastN = p;
    var size = erasing ? ERASE_SIZE : brush;
    dot(p.x, p.y, color, size, erasing);
    relay({ type: 'drawing', seg: [p.x, p.y, p.x + 0.0001, p.y], color: color, size: size, erase: erasing });
    curApi.sfx('hover');
  }
  function onMove(e) {
    if (!drawing) return;
    e.preventDefault();
    var p = posOf(e);
    var size = erasing ? ERASE_SIZE : brush;
    drawSeg(lastN.x, lastN.y, p.x, p.y, color, size, erasing);
    relay({ type: 'drawing', seg: [lastN.x, lastN.y, p.x, p.y], color: color, size: size, erase: erasing });
    lastN = p;
  }
  function onUp() { drawing = false; lastN = null; }

  function clearAll(local) {
    ctx.clearRect(0, 0, W, H);
    if (!local) return;
    curApi.sfx('drop');
    if (curApi.mode === 'online') curApi.send({ game: 'drawing', type: 'clear' });
  }

  /* --------------------------- toolbar ----------------------------- */
  function refreshTool() {
    swatchEls.forEach(function (o) {
      o.el.style.outline = (!erasing && o.c === color) ? '2px solid #fff' : '2px solid transparent';
      o.el.style.transform = (!erasing && o.c === color) ? 'scale(1.15)' : 'none';
    });
    sizeEls.forEach(function (o) {
      var on = !erasing && brush === o.v;
      o.el.style.background = on ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.05)';
      o.el.style.borderColor = on ? '#fff' : 'rgba(255,255,255,.18)';
    });
    if (eraseEl) {
      eraseEl.style.background = erasing ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.05)';
      eraseEl.style.borderColor = erasing ? '#fff' : 'rgba(255,255,255,.18)';
    }
  }

  function buildToolbar(h) {
    swatchEls = []; sizeEls = []; eraseEl = null;
    var swatches = PALETTE.map(function (c) {
      var el = h('div', {
        onClick: function () { color = c; erasing = false; refreshTool(); curApi.sfx('click'); },
        style: {
          width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
          background: c, boxShadow: '0 0 8px ' + c, outline: '2px solid transparent',
          outlineOffset: 2, transition: 'transform .12s'
        }
      });
      swatchEls.push({ el: el, c: c });
      return el;
    });
    var sizes = Object.keys(SIZES).map(function (k) {
      var v = SIZES[k];
      var el = h('div', {
        onClick: function () { brush = v; erasing = false; refreshTool(); curApi.sfx('click'); },
        style: {
          width: 30, height: 30, borderRadius: 8, cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,.18)',
          background: 'rgba(255,255,255,.05)', transition: 'all .12s'
        }
      }, h('div', { style: { width: v, height: v, borderRadius: '50%', background: '#e9dcf7' } }));
      sizeEls.push({ el: el, v: v });
      return el;
    });
    eraseEl = h('div', {
      onClick: function () { erasing = true; refreshTool(); curApi.sfx('click'); },
      style: {
        padding: '0 12px', height: 30, borderRadius: 8, cursor: 'pointer', display: 'flex',
        alignItems: 'center', border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.05)',
        fontFamily: "'Press Start 2P',monospace", fontSize: 8, color: '#c9bce0', letterSpacing: 1, transition: 'all .12s'
      }
    }, 'ERASE');
    var clearBtn = h('div', {
      onClick: function () { clearAll(true); },
      style: {
        padding: '0 12px', height: 30, borderRadius: 8, cursor: 'pointer', display: 'flex',
        alignItems: 'center', border: '1px solid ' + ACCENT + '66', background: ACCENT + '1a',
        fontFamily: "'Press Start 2P',monospace", fontSize: 8, color: ACCENT, letterSpacing: 1
      }
    }, 'CLEAR');

    function group(kids) { return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, kids); }
    function sep() { return h('div', { style: { width: 1, height: 24, background: 'rgba(255,255,255,.12)' } }); }

    return h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'center',
        padding: '8px 12px', borderRadius: 12, background: 'rgba(255,255,255,.04)',
        border: '1px solid rgba(255,255,255,.10)'
      }
    }, [group(swatches), sep(), group(sizes), sep(), group([eraseEl, clearBtn])]);
  }

  /* --------------------------- module ------------------------------ */
  Arcade.registerGame('drawing', {
    meta: { name: 'DOODLE', accent: ACCENT },
    online: true,

    fresh: function () { drawing = false; lastN = null; return { cur: 1, winner: null }; },

    render: function (root, api) {
      curApi = api;
      var h = api.h;
      cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      cv.style.display = 'block';
      cv.style.width = 'min(660px, 74vh)';
      cv.style.maxWidth = '100%';
      cv.style.height = 'auto';
      cv.style.borderRadius = '12px';
      cv.style.cursor = 'crosshair';
      cv.style.touchAction = 'none';
      cv.style.background = '#0a0713';
      ctx = cv.getContext('2d');

      cv.addEventListener('mousedown', onDown);
      cv.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      cv.addEventListener('touchstart', onDown, { passive: false });
      cv.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);

      var wrap = h('div', {
        style: {
          position: 'relative', padding: 12, borderRadius: 16,
          background: 'linear-gradient(180deg,rgba(20,14,32,.9),rgba(8,6,14,.9))',
          border: '2px solid ' + ACCENT + '55', boxShadow: '0 0 30px ' + ACCENT + '22',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10
        }
      }, [cv, buildToolbar(h)]);
      root.appendChild(wrap);
      refreshTool();
    },

    status: function (g, api) {
      var h = api.h;
      var label = api.mode === 'online' ? 'SHARED CANVAS - LIVE' : 'SHARED CANVAS';
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
        h('span', { style: { width: 12, height: 12, borderRadius: 3, background: ACCENT, boxShadow: '0 0 10px ' + ACCENT } }),
        h('div', { style: { fontFamily: "'Press Start 2P',monospace", fontSize: 10, color: ACCENT, textShadow: '0 0 10px ' + ACCENT, letterSpacing: 1 } }, label)
      ]);
    },

    onServer: function (data, api) {
      if (data.game !== 'drawing') return;
      curApi = api;
      if (data.type === 'init') {
        api.mySymbol = data.symbol; api.matchState = 'playing'; api.hideWaiting();
        api.refreshStatus();
        return;
      }
      if (data.type === 'clear') { if (ctx) ctx.clearRect(0, 0, W, H); return; }
      if (data.type === 'drawing') {
        if (data.by && data.by === api.mySymbol) return;   // ignore echo of our own strokes
        if (!ctx || !data.seg) return;
        var s = data.seg;
        drawSeg(s[0], s[1], s[2], s[3], data.color, data.size, data.erase);
      }
    }
  });
})();

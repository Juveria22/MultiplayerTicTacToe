// drawing.js Concurrent drawing game

//future integration for Fabric.js and Konva.js

let drawing = false;
let ctx;
let colorPicker, brushSize, clearBtn, canvas;
let waitingOverlay, countdownOverlay;
let joinedDrawing = false;
let lastX = 0, lastY = 0;
const playerId = Math.random().toString(36).substr(2, 9); // unique per client
let strokes = {}; // strokes[playerId] = [{x1,y1,x2,y2,color,size}, ...]

// initialize drawing game screen
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('drawing-canvas');
  colorPicker = document.getElementById('color-picker');
  brushSize = document.getElementById('brush-size');
  clearBtn = document.getElementById('clear-btn');
  waitingOverlay = document.getElementById('drawing-waiting');
  countdownOverlay = document.getElementById('drawing-countdown');
  ctx = canvas.getContext('2d');

  // clears the player who clicked the buttons drawings on both screens
  clearBtn.addEventListener('click', () => {
    strokes[playerId] = [];       // remove own strokes locally
    redrawCanvas();               // redraw without own strokes
    ws.send(JSON.stringify({      // tell other client to remove this player's strokes
      game: 'drawing',
      type: 'clearOwn',
      playerId
    }));
  });

  // drawing events
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseout', stopDrawing);
  canvas.addEventListener('mousemove', draw);
});

function startDrawing(e) {
  if (!joinedDrawing) return;
  drawing = true;
  const rect = canvas.getBoundingClientRect();
  lastX = e.clientX - rect.left;
  lastY = e.clientY - rect.top;
}

function stopDrawing() {
  drawing = false;
}

// drawing mechanic
function draw(e) {
  if (!drawing || !joinedDrawing) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const color = colorPicker.value;
  const size = brushSize.value;

  // drawing line segments
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // store stroke values
  if (!strokes[playerId]) strokes[playerId] = [];
  strokes[playerId].push({ x1: lastX, y1: lastY, x2: x, y2: y, color, size });

  // send to server for other player
  ws.send(JSON.stringify({
    game: 'drawing',
    type: 'drawing',
    playerId,
    x1: lastX,
    y1: lastY,
    x2: x,
    y2: y,
    color,
    size
  }));

  lastX = x;
  lastY = y;
}

// redraw all strokes
function redrawCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  Object.values(strokes).forEach(playerStrokes => {
    playerStrokes.forEach(s => {
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    });
  });
}

// handle incoming WebSocket messages
function handleDrawingMessage(data) {
  // Game initialized
  if (data.type === 'init' && data.game === 'drawing') {
    waitingOverlay.style.display = 'none';
    countdownOverlay.style.display = 'flex';
    joinedDrawing = true;
  }

  // Countdown
  if (data.type === 'countdown' && data.game === 'drawing') {
    waitingOverlay.style.display = 'none';
    countdownOverlay.style.display = 'flex';
    countdownOverlay.textContent = data.message;
    if (data.message.includes('0')) {
      setTimeout(() => {
        countdownOverlay.style.display = 'none';
        joinedDrawing = true;
      }, 1000);
    }
  }

  // Stroke from other player
  if (data.type === 'drawing' && data.game === 'drawing') {
    if (!strokes[data.playerId]) strokes[data.playerId] = [];
    strokes[data.playerId].push({
      x1: data.x1, y1: data.y1,
      x2: data.x2, y2: data.y2,
      color: data.color,
      size: data.size
    });
    redrawCanvas();
  }

  // Clear only specific player’s strokes
  if (data.type === 'clearOwn' && data.game === 'drawing') {
    strokes[data.playerId] = [];
    redrawCanvas();
  }

  // Opponent left; player will be reconnected as soon as another person joins the game
  if (data.type === 'message' && data.message.includes('Waiting for another player')) {
    waitingOverlay.style.display = 'flex';
    countdownOverlay.style.display = 'none';
    strokes = {}; // clear all strokes locally
    redrawCanvas();
    joinedDrawing = false;
    canvas.onmousedown = null;
    canvas.onmousemove = null;
    canvas.onmouseup = null;
  }
}

// Connect WebSocket
//npx serve client

// npm init -y
// npm install express ws
// node server/server.js

// Automatically select ws:// or wss:// depending on environment
const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = `${protocol}://${window.location.host}`;
const ws = new WebSocket(wsUrl);

ws.onopen = () => console.log("✅ WebSocket connected!");
ws.onerror = (err) => console.error("❌ WebSocket error:", err);
ws.onclose = () => console.log("🔌 WebSocket closed");

// Chat elements
const messagesDiv = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');

// Track which game is currently active
let currentGame = null;

// When the page loads show instructions for system message
window.addEventListener('DOMContentLoaded', () => {
    addSystemMessage("Hi! Please select a game to continue...", true);
});


// chat handling 
function sendChat() {
  const msg = input.value.trim();
  if (!msg || !currentGame) return;
  ws.send(JSON.stringify({ game: currentGame, type: 'chat', message: msg }));
  input.value = '';
}

sendBtn.addEventListener('click', sendChat);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

//handling join game buttons
function joinTicTacToeGame() {
  ws.send(JSON.stringify({ type: 'join', game: 'tic-tac-toe' }));
}

function joinDrawingGame() {
  ws.send(JSON.stringify({ type: 'join', game: 'drawing' }));
}

// Show the selected game and join
function showGame(id) {
    currentGame = id;

    document.getElementById('tic-tac-toe').style.display = (id === 'tic-tac-toe') ? 'block' : 'none';
    document.getElementById('drawing-game').style.display = (id === 'drawing') ? 'block' : 'none';

    // Tell server which game we want
    ws.send(JSON.stringify({ type: 'selectGame', game: id }));

    // Send jointo server
    ws.send(JSON.stringify({ type: 'join' }));

    // Show connecting message in chat
    const div = document.createElement('div');
    div.classList.add('system');
    div.textContent = 'Connecting to another player...';
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
window.showGame = showGame;


// handle chat system messages
function addSystemMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('system');

  div.innerHTML = msg;

  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

window.showGame = showGame;

// routing websocket messages
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

 
  if (data.type === 'chat') {
    // Player chat messages
    const div = document.createElement('div');
    div.classList.add(data.player || 'system'); // 'X' or 'O'
    div.textContent = `${data.player}: ${data.message}`;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

  } else if (data.type === 'message') {
    // Handle server system messages
    addSystemMessage(data.message, true);

  } else if (data.type === 'countdown') {
    // Countdown messages
    addSystemMessage(data.message, true);

  } else if (data.type === 'error') {
    alert(data.message);
  }

  // Route game updates
  if (data.game === 'tic-tac-toe' && typeof handleTicTacToeMessage === 'function') {
    handleTicTacToeMessage(data);
  }

  if (data.game === 'drawing' && typeof handleDrawingMessage === 'function') {
    handleDrawingMessage(data);
  }
};
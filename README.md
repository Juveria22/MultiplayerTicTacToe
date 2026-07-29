<div align="center">
  <h1>Syncspace</h1>
  <p><strong>Real-Time Multiplayer Gaming Platform</strong></p>

  <p>
    <a href="#about">About</a> •
    <a href="#features">Features</a> •
    <a href="#tech-stack">Tech Stack</a> •
    <a href="#installation">Installation</a> •
    <a href="#usage">Usage</a>
  </p>
</div>

---

## About

A web-based multiplayer gaming platform featuring real-time gameplay and communication, wrapped in a neon retro-arcade interface. Built on a WebSocket backend to enable instant, synchronized gameplay between two players with integrated chat.

## Features

**Arcade Lobby**
- Neon CRT-styled cabinet lobby with animated background
- Multiple game cabinets to choose from
- Local and online play modes
- Hover sparkle effects across the background

**Gameplay**
- Real-time turn tracking
- Win and draw detection
- Game state synchronization across players

**Real-Time Communication**
- Integrated chat panel
- Instant message delivery via WebSockets

**Multiplayer Infrastructure**
- WebSocket-based real-time connections
- Low-latency gameplay
- Automatic player matching

## Tech Stack

**Frontend**
- HTML5
- CSS3
- JavaScript

**Backend**
- Node.js
- WebSocket (`ws` library)

**Deployment**
- Render (Frontend and Backend)

## Project Structure

```
neon-arcade/
├── server/
│   ├── server.js              # WebSocket server
│   ├── package.json           # Backend dependencies
│   └── package-lock.json
├── client/
│   ├── index.html             # markup shell + script includes
│   ├── css/
│   │   └── style.css          # shared styling + keyframes
│   └── js/
│       ├── main.js            # Arcade core: connection, lobby, chat, FX, registry
│       └── games/
│           ├── tic-tac-toe.js # ← reference for online wiring
│           ├── connect-four.js
│           ├── rps.js
│           ├── memory.js
│           └── sugar-rush.js
├── .gitignore
└── README.md
```

One file per game. `main.js` owns everything shared (the WebSocket
connection, the lobby, screen routing, chat, sound, and the cosmetic
effects); each game in `js/games/` is self-contained and registers
itself with the core. Adding or changing a game never touches the others.

### Adding a game

1. Create `client/js/games/my-game.js` and call `Arcade.registerGame('my-game', { … })`.
2. Add an entry to the `CATALOG` array in `main.js` (id, name, tagline, accent, badge) so a cabinet shows in the lobby.
3. Include the file in `index.html` after `main.js`.

Each module implements a small contract — `fresh()` (new state),
`render(root, api)` (build the board), and optionally `status()`,
`onServer()`, `start()`/`stop()`. The `api` object passed in provides
everything a game needs (state, colors, sound, the `send()` socket
helper, win handling) without reaching into the core. The full contract
is documented at the top of `main.js`.

### Wiring a game to online play

`tic-tac-toe.js` is the simplest reference; `connect-four.js` mirrors it.
The pattern:

- set `online: true` on the module
- in your move handler, when `api.mode === 'online'`, call
  `api.send({ game:'my-game', type:'move', … })` instead of mutating
  local state
- implement `onServer(data, api)` to apply the authoritative state the
  server broadcasts back
- add a matching handler on the server (see "Server" below)

**Every game now plays online**, each using the model that suits it:

- **Tic-Tac-Toe / Connect Four** — turn-based; the server validates each
  move and broadcasts the authoritative board.
- **RPS Duel** — both players pick simultaneously and secretly; the
  server collects both picks and broadcasts the reveal.
- **Memory** — the server owns the shuffled deck and validates every
  flip, so both players see the same layout and faces are only revealed
  as cards are turned.
- **Sugar Rush** — sequential rounds: each player plays their timed round
  and reports their score; the server compares and declares the winner.
- **Doodle** — a real-time shared drawing canvas relayed by the server.

### Server

`server/server.js` is organised so each game is a small block:

- add the game id to `GAME_IDS`
- initialise its session state in `createSession()`
- add a move handler and register it in `MOVE_HANDLERS`

The connection/queue/matchmaking, chat, countdown, and
disconnect-handling are all shared and game-agnostic.

> **Deploying:** the client points at the WebSocket URL in
> `client/js/main.js` (`SERVER_URL`). After changing `server.js`,
> redeploy the server so it speaks the new protocol — older deployments
> only handle Tic-Tac-Toe and Doodle.

## Installation

### Prerequisites

- Node.js (v14 or higher)
- npm

### Setup

```bash
# Clone the repository
git clone https://github.com/Juveria22/Syncspace.git
cd MultiplayerTicTacToe

# Install backend dependencies
cd server
npm install

# Start the server
node server.js
```

The server will start running on the configured port (default: 8080).

### Frontend Setup

Open `client/index.html` in your web browser, or serve it using a local server:

```bash
# Using Python
python -m http.server 3000

# Using Node.js http-server
npx http-server client -p 3000
```

## Usage

1. Open the application in your browser
2. Pick a game from the arcade lobby
3. Share the URL with another player
4. Wait for both players to connect
5. Start playing and use the chat panel to communicate

## How It Works

The application uses WebSocket connections to maintain real-time, bidirectional communication between the server and clients. When a player makes a move:

1. The client sends the move data to the server
2. The server validates and broadcasts the move to all connected players
3. Both clients update their game state simultaneously
4. Turn tracking ensures proper game flow

## License

This project is open source and available under the MIT License.

---

<div align="center">
  <p>Made by <a href="https://github.com/Juveria22">Juveria Amin</a></p>
  <p>If you enjoyed this project, consider giving it a ⭐</p>
</div>

<div align="center">
  <h1>2-Player Games</h1>
  <p><strong>Real-Time Multiplayer Gaming Platform</strong></p>
  
  <p>
    <a href="#features">Features</a> •
    <a href="#demo">Demo</a> •
    <a href="#tech-stack">Tech Stack</a> •
    <a href="#installation">Installation</a> •
    <a href="#usage">Usage</a>
  </p>
</div>

---

## About

A web-based multiplayer gaming platform featuring real-time gameplay and communication. Built with WebSocket technology to enable instant, synchronized gameplay between two players with integrated chat functionality.

## Features

**Tic-Tac-Toe**
- Clean, intuitive game interface
- Real-time turn tracking
- Win and draw detection
- Game state synchronization across players

**Real-Time Communication**
- Integrated chat panel
- Instant message delivery via WebSockets
- Concurrent drawing capabilities

**Multiplayer Infrastructure**
- WebSocket-based real-time connections
- Low-latency gameplay
- Automatic player matching

## Demo

**Live Application:** [Play Now](https://tictactoe-9omk.onrender.com)

**Frontend:** https://tictactoe-9omk.onrender.com  
**Backend:** https://multiplayertictactoe-xwzj.onrender.com

## Tech Stack

**Frontend**
- HTML5
- CSS3
- JavaScript (Vanilla)

**Backend**
- Node.js
- WebSocket (`ws` library)

**Deployment**
- Render (Frontend and Backend)

## Project Structure

```
2-player-games/
├── server/
│   ├── server.js          # WebSocket server
│   └── package.json       # Backend dependencies
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── script.js
└── README.md
```

## Installation

### Prerequisites

- Node.js (v14 or higher)
- npm

### Setup

```bash
# Clone the repository
git clone https://github.com/Juveria22/MultiplayerTicTacToe.git
cd MultiplayerTicTacToe

# Install backend dependencies
cd server
npm install

# Start the server
node server.js
```

The server will start running on the configured port (default: 8080).

### Frontend Setup

Open `frontend/index.html` in your web browser, or serve it using a local server:

```bash
# Using Python
python -m http.server 3000

# Using Node.js http-server
npx http-server frontend -p 3000
```

## Usage

1. Open the application in your browser
2. Share the URL with another player
3. Wait for both players to connect
4. Start playing Tic-Tac-Toe
5. Use the chat panel to communicate during gameplay

## How It Works

The application uses WebSocket connections to maintain real-time, bidirectional communication between the server and clients. When a player makes a move:

1. The client sends the move data to the server
2. The server validates and broadcasts the move to all connected players
3. Both clients update their game state simultaneously
4. Turn tracking ensures proper game flow

## Roadmap

Future enhancements planned:

- Additional game modes (Connect Four, Checkers)
- Player lobbies and game rooms
- User accounts and match history
- Spectator mode
- Mobile-responsive design improvements
- Game replay functionality
- Customizable themes

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

## License

This project is open source and available under the MIT License.

---

<div align="center">
  <p>Made by <a href="https://github.com/Juveria22">Juveria Amin</a></p>
  <p>If you enjoyed this project, consider giving it a ⭐</p>
</div>

<div align="center">
  <h1>Syncspace Arcade</h1>
  <p><strong>Real-time multiplayer game platform. 12 head-to-head games, one WebSocket engine.</strong></p>
  <p>
    <a href="#overview">Overview</a> •
    <a href="#the-games">Games</a> •
    <a href="#architecture">Architecture</a> •
    <a href="#engineering-highlights">Engineering Highlights</a> •
    <a href="#tech-stack">Tech Stack</a> •
    <a href="#running-it-locally">Run Locally</a>
  </p>
</div>

---

## Overview

Syncspace Arcade is a browser-based arcade where two people can play any of
twelve head-to-head games, either locally on one keyboard or online against
someone in another browser, matched automatically over WebSockets. Every
game shares one lobby, one chat channel, and one connection.

The hard part was not any single game. It was building one engine general
enough that twelve very different games plug into it without special-casing
the core: turn-based board games, a simultaneous-reveal game, a
hidden-information game, a real-time physics game, and a shared drawing
canvas. Adding a thirteenth game means writing one file and touching
nothing else.

No frameworks, no build step. Vanilla JavaScript, a Node WebSocket server,
and a hand-rolled retro CRT interface.

## The Games

| Game | Sync model |
|---|---|
| Tic Tac Toe, Connect 4, Checkers, Reversi, Dots & Boxes | Turn-based. Server validates each move and broadcasts the authoritative board |
| RPS Duel | Simultaneous secret picks. Server collects both, then broadcasts the reveal |
| Memory | Server owns the shuffled deck. Faces are only revealed as cards are flipped, so neither client can read the board early |
| Battleship | Hidden information. Server holds both fleets through placement and alternating shots |
| Pong | Authoritative real-time physics on the server. Clients send paddle input and render broadcast state |
| Sugar Rush | Sequential timed rounds. Each player plays, reports a score, server compares |
| Doodle | Real-time shared canvas, strokes relayed as they are drawn |
| Dress Up | Each player edits only their own character. Both figures stay synced |

### Hot-seat hidden information

Battleship is the hardest game to run on a single shared screen, because
both fleets are secret but both players are looking at the same monitor. It
uses an explicit hand-off flow. Your fleet sits under a cover you tap to
peek at and tap again to hide, and every shot pauses on a `PLAYER n —
CONTINUE` screen so the shooter sees their own result before the device
changes hands: an ✕ for a miss, smoke for a hit, and the whole ship drawn in
red when it sinks.

## Architecture

```
client/
  index.html            markup shell
  css/style.css         CRT styling, keyframes, responsive cabinet scaling
  assets/sfx/           bundled audio cues
  js/
    main.js             engine: socket, lobby, routing, chat, audio, FX, registry
    games/*.js          one self-contained module per game
server/
  server.js             matchmaking, session state, per-game move handlers
```

**Client engine (`main.js`)** owns everything shared: the WebSocket
connection and reconnect handling, the lobby and screen routing, chat,
sound, the cursor-driven starfield, and a game registry. Each game calls
`Arcade.registerGame(id, module)` and implements a small contract:
`fresh()` for new state, `render(root, api)` to build the board, and
optionally `status()`, `onServer()`, `start()`/`stop()`.

Games never reach into the engine. They receive an `api` object with
exactly what they need: current state, player colours, the `send()` socket
helper, sound cues, avatar rendering, and win handling. That inversion is
what keeps twelve games from turning into twelve special cases, and it is
why the local and online code paths in each game differ by a single branch.
Either mutate local state, or `send()` and wait for the server's answer.

**Server (`server.js`)** handles the game-agnostic connection queue,
matchmaking, countdown, chat relay, and disconnects, plus one small block
per game: an id in `GAME_IDS`, session state in `createSession()`, and a
handler in `MOVE_HANDLERS`. It stays authoritative for anything a client
should not be trusted with: move legality, Memory's deck, Battleship's
fleets, and Pong's physics loop.

## Engineering Highlights

- **One protocol, five sync models.** Turn-based validation, simultaneous
  reveal, hidden information, server-authoritative physics, and continuous
  stroke relay all ride the same message envelope.
- **Server-authoritative Pong.** Fixed 800×500 logical field with physics
  constants mirrored on both sides. Clients send input only, so the two
  browsers cannot disagree about where the ball is.
- **Anti-cheat by construction.** Memory's deck and Battleship's fleets do
  not leave the server until the rules say they should, so the information
  is not in the client to inspect.
- **Registry-driven UI.** The lobby builds itself from a catalog array.
  Cabinets, accent colours, icons, and marquee type are all data.
- **Persistent player identity.** The character built in Dress Up is saved
  to `localStorage` and rendered as the player's avatar in every other
  game's turn indicators and scoreboards, with a small event bus so all
  mount points refresh the moment a figure is saved.
- **Production hygiene.** Audio is preloaded on init so the first cue is not
  late, all assets are bundled locally with no third-party runtime
  dependencies, and animation timers and audio suspend on
  `visibilitychange` so a background tab does not burn CPU.
- **Responsive scaling.** Cabinets scale as a unit through a single CSS
  custom property, art, type and controls together, instead of stretching
  wider on large displays. The grid keeps an even number of cabinets per row
  at every breakpoint.

## Tech Stack

**Frontend.** Vanilla JavaScript (ES5-compatible, no framework, no build
step), CSS3 (grid, custom properties, clip-path, keyframe animation),
Press Start 2P and Geist Pixel type, audio via `HTMLAudioElement`, Canvas
2D for Pong, Doodle and Sugar Rush.

**Backend.** Node.js with the `ws` WebSocket library.

**Deployment.** Render, static client plus Node service.

## Running It Locally

```bash
cd server && npm install && node server.js   # WebSocket server on :8080
npx http-server client -p 3000               # client
```

Point `SERVER_URL` in `client/js/main.js` at your server, then open two
browser windows to play online, or pick LOCAL mode and hand a friend half
the keyboard.

---

<div align="center">
  <p>Built by <a href="https://github.com/Juveria22">Juveria Amin</a></p>
</div>

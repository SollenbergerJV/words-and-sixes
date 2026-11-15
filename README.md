# Words &amp; Sixes

Two-player **Sixes** — lines of colour and shape — with a computer opponent,
pass-and-play, and online play against a real person over an invite code.
**Word Squares** comes next; the app is built with a second game in mind.

Voice works everywhere. Video is for computers only: a phone gets voice and
no picture, and says so rather than opening a camera nobody wants.

## Getting it online

Same route as Gin &amp; Corners.

1. Put every file in a GitHub repository. Dragging the loose files straight
   in is fine — the app detects a flattened upload and runs from it.
2. On render.com: **New → Web Service**, point it at the repository, and
   accept what it offers. `render.yaml` sets the rest.
3. Wait for **Live**, then open the address it gives you.

Nothing to install, no database, no API keys. The first visit after a quiet
spell takes 30–60 seconds while Render wakes the free instance up.

## Checking what is live

`/version` returns the version number. `/healthz` returns `ok`.

## Video across mobile networks

Two players behind strict carrier NAT — a phone on mobile data is the usual
case — may not be able to connect a call directly. If that happens, set
`TURN_URL`, `TURN_USER` and `TURN_PASS` in Render's environment settings and
the app will route through a relay. Without them it uses STUN only, which is
enough on ordinary home wi-fi.

## The tests

    npm test               the rules
    npm run test:opponent  the computer, playing hundreds of games
    npm run test:browser   two real browsers, a real room, a real call
    npm run test:flat      the same app running from a flattened upload

The browser tests need Playwright and drive actual clicks; they are the only
honest way to answer "can a person play this".

## Layout

    shared/sixes.js      the rules — the same file runs in node and the browser
    shared/sixes-ai.js   the computer opponent
    server/index.js      static files, /version, /healthz, ICE config
    server/rooms.js      rooms, seats, and the authoritative game
    server/ws.js         a websocket implementation with no dependencies
    public/              the app itself
    start.js             finds the server whichever way the files were uploaded

The server owns the bag. Neither browser is ever sent the other player's
tiles, so cheating is removed as a category rather than discouraged as a
policy.

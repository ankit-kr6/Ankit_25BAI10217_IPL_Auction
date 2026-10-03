# IPL Mega Auction - Live Auction Platform

| | |
|---|---|
| **Participant** | Ankit <your surname> |
| **Registration No.** | 25BAI10217 |
| **Date of Submission** | 3 October 2026 |
| **Repo name** | `Ankit_25BAI10217_IPL_Auction` |
| **Demo video** | (add YouTube link later) |
| **Live demo** | (add Render link once deployed) |
Realtime auction software for an in-person room: a projector **Live Board**, phone/laptop **Team Consoles**, and an **Auctioneer Desk**.

## Stack
Node.js 18+ · Express · Socket.IO (WebSockets) · plain HTML/CSS/JS · JSON-file snapshot for crash recovery. No build step, no database.

## Run it
```bash
npm install
cp .env.example .env        # then edit ADMIN_PASSWORD
node --env-file=.env server/index.js     # Node 20+   (or: ADMIN_PASSWORD=secret npm start)
npm test                    # rules-engine tests
```
Open `http://localhost:3000`:

| Screen | URL | Who |
|---|---|---|
| Live Board | `/board.html` | Projector |
| Team Console | `/team.html` | Each franchise (passcode in `server/data/teams.json`) |
| Auctioneer Desk | `/admin.html` | Auctioneer (`ADMIN_PASSWORD`) |

To use from other devices on the same Wi-Fi, open `http://<laptop-ip>:3000`.

**Env vars:** `PORT` (default 3000), `ADMIN_PASSWORD` (default `admin123`, change it).

## Architecture
```
 Team phones ──┐                      ┌── Live Board (read-only)
 Team phones ──┼── Socket.IO ── Server ┤
 Admin desk  ──┘   (events)    │      └── broadcasts full public state on every change
                               ▼
                     auction.js  (ALL rules, synchronous)
                     state.js    (shape + JSON snapshot)
```
- **Server-authoritative.** Clients only *ask* (`bid`, `admin:sold`...). The server validates and then broadcasts one `state:update` to everyone.
- **Single-threaded atomicity.** Every rule function is synchronous, so two simultaneous bids are processed one after the other. The second sees the updated leader/amount and is validated against it.
- **Timer = a timestamp.** The server stores `endsAt`; clients draw `endsAt - serverNow`, correcting for clock offset. A valid bid resets `endsAt`. At zero the lot becomes `ended` and the auctioneer hammers Sold/Unsold.
- **Identity on the socket.** After login the server remembers `socket.data.teamId`; the client never sends its own team id with a bid.
- **Reconnect = catch-up.** A new/reconnected socket immediately receives the full state; team pages auto re-login.

## Rules implemented
- Up to 15 franchises (10 shipped, add more in `teams.json`); purse **12500 lakhs = Rs 125 Cr**, all money as **integer lakhs**.
- Increments: **+10 below 100L, +20 below 500L, else +50**. First bid on a lot = base price.
- Bid rejected if: no live lot / timer over / paused / bidder already leads / purse too low / squad full.
- Sold is atomic (purse, squad, player status and lot reset change in one function). Sold with zero bids is refused.
- Squad rules (configurable in `state.js` / admin): min 7 players, ≥1 WK, ≥3 bowlers (role `BOWL`). Boards show a squad-ok badge.
- Admin: start lot / next in queue, pause/resume, Sold/Unsold, re-queue unsold, break mode, timer setting, reset, CSV export, activity log.

## Project structure
```
server/index.js      Express + Socket.IO wiring, auth, admin guards, CSV route
server/auction.js    rules engine (bids, timer, sold/unsold, squad status)
server/state.js      state shape, defaults, save/load
server/data/*.json   teams (+passcodes) and player pool
public/              board.html, team.html, admin.html, index.html, common.js, style.css
test/auction.test.js rules tests
VIVA_NOTES.md        Q&A cheat sheet
```

## Known limits
Single server process (state in memory, snapshot to disk); passcodes are plain text in a JSON file (fine for a closed event).

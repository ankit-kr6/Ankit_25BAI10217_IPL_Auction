# Viva cheat sheet (Q&A)

**Q: Why is the server authoritative?**
Clients can be tampered with. If the browser decided "I can afford this", anyone could cheat from the dev console. The server owns purse, bid and leader; clients only request.

**Q: Two teams bid at the same millisecond - what happens?**
Node runs JS on one thread and `placeBid` is fully synchronous. Events are handled one at a time. The first sets leader+amount; the second is validated against the new state (it just bids the next increment, or is rejected if it's the leader / can't afford it). My e2e test fires two bids with `Promise.all`: results were 200 then 220.

**Q: How does the timer stay accurate on every device?**
The server stores `endsAt` (a timestamp), not a countdown. Each client computes `endsAt - (Date.now() + offset)` where `offset = serverNow - Date.now()` from the last update, so a wrong laptop clock doesn't matter. A server `setTimeout` flips the lot to `ended`.

**Q: What resets the timer?**
Every accepted bid sets `endsAt = now + lotSeconds`.

**Q: Why integer lakhs?**
Floats can't represent money exactly (0.1 + 0.2 != 0.3). Integers add and compare exactly. 12500 lakhs = Rs 125 Cr; display converts only at the UI.

**Q: How is Sold atomic?**
One synchronous function changes purse, squad, player status, lastResult and lot together. Nothing else can run in between, so you can't get "purse deducted but player not added".

**Q: How does auth work?**
Team passcode -> server finds the team -> stores `teamId` on that socket. Bids carry no team id; the server uses its own copy. Admin events check `socket.data.admin`. Passcodes are never sent in `state:update`.

**Q: What if a client disconnects mid-lot?**
Socket.IO reconnects automatically; the server sends the full state on connect, and the team page re-logs in with the passcode kept in sessionStorage. The lot keeps running without them.

**Q: What if the server crashes or restarts?**
State is saved to `state.json` after every change. On boot a "live" lot is loaded as *paused* (its timer is gone), so the auctioneer presses Resume.

**Q: Failure modes / limits?**
One process only (no horizontal scaling without a shared store like Redis); plain-text passcodes; if the server's machine dies mid-lot the snapshot is the recovery path.

**Q: Why send the whole state each time instead of small diffs?**
The data is tiny (~10 teams, 30 players), so full state = simplest code, no way for clients to drift out of sync.

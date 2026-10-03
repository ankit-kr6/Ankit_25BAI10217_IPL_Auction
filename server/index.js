const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { load, save } = require('./state');
const { Auction } = require('./auction');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// One broadcast function: any state change -> save to disk -> push to EVERY client.
const auction = new Auction(load(), state => {
  save(state);
  io.emit('state:update', auction.publicState());
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/export/squads.csv', (req, res) => {
  if (req.query.key !== ADMIN_PASSWORD) return res.status(401).send('Unauthorized');
  res.type('text/csv').attachment('final_squads.csv').send(auction.exportCsv());
});

io.on('connection', socket => {
  socket.emit('state:update', auction.publicState()); // late joiners / reconnects catch up instantly

  // --- auth: identity lives on the SERVER-side socket, never trusted from the client ---
  socket.on('team:login', ({ passcode } = {}, ack) => {
    const team = auction.teamByPasscode(passcode);
    if (!team) return ack?.({ ok: false, error: 'Wrong passcode' });
    socket.data.teamId = team.id;
    ack?.({ ok: true, teamId: team.id, name: team.name });
  });
  socket.on('admin:login', ({ password } = {}, ack) => {
    if (password !== ADMIN_PASSWORD) return ack?.({ ok: false, error: 'Wrong password' });
    socket.data.admin = true;
    ack?.({ ok: true });
  });

  socket.on('bid', (_, ack) => {
    if (!socket.data.teamId) return ack?.({ ok: false, error: 'Not logged in' });
    ack?.(auction.placeBid(socket.data.teamId));
  });

  const admin = (event, fn) =>
    socket.on(event, (data, ack) => {
      if (!socket.data.admin) return ack?.({ ok: false, error: 'Admin only' });
      ack?.(fn(data || {}));
    });
  admin('admin:startLot', d => auction.startLot(Number(d.playerId)));
  admin('admin:pause', () => auction.pause());
  admin('admin:resume', () => auction.resume());
  admin('admin:sold', () => auction.sold());
  admin('admin:unsold', () => auction.unsold());
  admin('admin:requeue', d => auction.requeue(Number(d.playerId)));
  admin('admin:break', d => auction.setBreak(!!d.on, d.message));
  admin('admin:config', d => auction.setConfig(d));
  admin('admin:reset', () => auction.reset());
});

server.listen(PORT, () => {
  console.log(`Auction running:  http://localhost:${PORT}`);
  console.log(`  Board  /board.html   Admin /admin.html   Team /team.html`);
  console.log('Team passcodes are in server/data/teams.json');
});

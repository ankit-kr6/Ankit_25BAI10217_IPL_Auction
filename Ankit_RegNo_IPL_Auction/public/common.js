// Shared by all three screens: one socket, one copy of the server state, a few helpers.
const socket = io();
let S = null;          // latest public state from the server
let offset = 0;        // server clock minus this device's clock

socket.on('state:update', s => {
  S = s;
  offset = s.serverNow - Date.now();   // keeps timers right even if a laptop clock is off
  if (window.render) render();
});
socket.on('connect', () => document.body.classList.remove('offline'));
socket.on('disconnect', () => document.body.classList.add('offline'));

const fmt = l => (l >= 100 ? `₹${+(l / 100).toFixed(2)} Cr` : `₹${l} L`); // lakhs -> display
const ROLE = { BAT: 'Batter', BOWL: 'Bowler', WK: 'Wicket-keeper', AR: 'All-rounder' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function msLeft() {
  const l = S && S.lot;
  if (!l) return 0;
  if (l.status === 'live') return Math.max(0, l.endsAt - (Date.now() + offset));
  if (l.status === 'paused') return l.remainingMs;
  return 0;
}
const clock = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function toast(msg, good) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = 'toast show' + (good ? ' good' : '');
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = 'toast'), 2200);
}

setInterval(() => window.tick && S && tick(), 100); // only the clock redraws 10x/sec
document.body.insertAdjacentHTML('afterbegin', '<div class="offline-banner">Connection lost - reconnecting…</div>');

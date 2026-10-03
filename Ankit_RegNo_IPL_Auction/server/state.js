// State shape + save/load. No rules here - rules live in auction.js.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'state.json');
const teams = require('./data/teams.json');
const players = require('./data/players.json');

// All money is INTEGER LAKHS (12500 lakhs = Rs 125 Cr). No floats, no rounding bugs.
const DEFAULT_CONFIG = {
  startPurse: 12500,
  minSquad: 7,
  maxSquad: 25,
  minWK: 1,
  minBowlers: 3,
  lotSeconds: 20
};

function fresh() {
  return {
    config: { ...DEFAULT_CONFIG },
    mode: 'auction', // 'auction' | 'break'
    breakMessage: '',
    teams: Object.fromEntries(
      teams.map(t => [t.id, { ...t, purse: DEFAULT_CONFIG.startPurse, squad: [] }])
    ),
    players: players.map(p => ({ ...p, status: 'pending' })), // pending | live | sold | unsold
    lot: { status: 'idle', playerId: null, currentBid: 0, leaderId: null, endsAt: 0, remainingMs: 0 },
    lastResult: null,
    log: []
  };
}

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    // After a server restart a "live" lot has no running timer -> park it as paused.
    if (s.lot.status === 'live') {
      s.lot.remainingMs = Math.max(0, s.lot.endsAt - Date.now());
      s.lot.status = 'paused';
    }
    return s;
  } catch {
    return fresh();
  }
}

function save(state) {
  try { fs.writeFileSync(FILE, JSON.stringify(state)); } catch (e) { console.error('save failed', e.message); }
}

module.exports = { fresh, load, save };

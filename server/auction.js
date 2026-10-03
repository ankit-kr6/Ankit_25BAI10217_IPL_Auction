// The rules engine. Every method is SYNCHRONOUS, so Node's single thread
// processes one action at a time -> two simultaneous bids can never interleave.
const { fresh } = require('./state');

const ok = (extra = {}) => ({ ok: true, ...extra });
const err = error => ({ ok: false, error });

// Tiered increments (in lakhs): +10 below 100L, +20 below 500L, else +50
const increment = bid => (bid < 100 ? 10 : bid < 500 ? 20 : 50);

class Auction {
  constructor(state, onChange = () => {}) {
    this.s = state;
    this.onChange = onChange;
    this.timer = null;
    this.arm();
  }

  // ---------- helpers ----------
  player(id) { return this.s.players.find(p => p.id === id); }
  teamByPasscode(code) {
    return Object.values(this.s.teams).find(t => t.passcode === String(code || '').trim().toUpperCase());
  }
  log(msg) {
    this.s.log.unshift({ t: Date.now(), msg });
    if (this.s.log.length > 100) this.s.log.length = 100;
  }
  emit() { this.onChange(this.s); }

  nextBid() {
    const { lot } = this.s;
    const p = this.player(lot.playerId);
    if (!p) return 0;
    return lot.leaderId === null ? p.basePrice : lot.currentBid + increment(lot.currentBid);
  }

  squadStatus(t) {
    const c = this.s.config;
    const wk = t.squad.filter(p => p.role === 'WK').length;
    const bowl = t.squad.filter(p => p.role === 'BOWL').length;
    return {
      count: t.squad.length, wk, bowl,
      ok: t.squad.length >= c.minSquad && wk >= c.minWK && bowl >= c.minBowlers
    };
  }

  // ---------- timer ----------
  // The SERVER stores endsAt (a timestamp). Clients just draw endsAt - now.
  arm() {
    clearTimeout(this.timer);
    const { lot } = this.s;
    if (lot.status !== 'live') return;
    this.timer = setTimeout(() => this.expire(), Math.max(0, lot.endsAt - Date.now()) + 20);
  }
  expire() {
    const { lot } = this.s;
    if (lot.status !== 'live' || Date.now() < lot.endsAt) return;
    lot.status = 'ended'; // bidding closed, waiting for the auctioneer's gavel
    this.log('Time up - waiting for the auctioneer');
    this.emit();
  }

  // ---------- team action ----------
  placeBid(teamId) {
    const { lot, config } = this.s;
    const team = this.s.teams[teamId];
    if (!team) return err('Unknown team');
    if (lot.status !== 'live' || Date.now() >= lot.endsAt) return err('Bidding is not open');
    if (lot.leaderId === teamId) return err('You already lead this lot');
    if (team.squad.length >= config.maxSquad) return err('Squad is full');
    const amount = this.nextBid();
    if (team.purse < amount) return err('Not enough purse');

    lot.currentBid = amount;
    lot.leaderId = teamId;
    lot.endsAt = Date.now() + config.lotSeconds * 1000; // bid resets the clock
    this.log(`${team.name} bid ${amount}L on ${this.player(lot.playerId).name}`);
    this.arm();
    this.emit();
    return ok({ amount });
  }

  // ---------- admin actions ----------
  startLot(playerId) {
    const { lot } = this.s;
    if (this.s.mode !== 'auction') return err('Auction is on a break');
    if (lot.status !== 'idle') return err('Finish the current lot first');
    const p = this.player(playerId);
    if (!p || p.status !== 'pending') return err('Player is not available');
    p.status = 'live';
    Object.assign(lot, {
      status: 'live', playerId: p.id, currentBid: p.basePrice, leaderId: null,
      endsAt: Date.now() + this.s.config.lotSeconds * 1000, remainingMs: 0
    });
    this.s.lastResult = null;
    this.log(`Lot started: ${p.name} (base ${p.basePrice}L)`);
    this.arm();
    this.emit();
    return ok();
  }

  pause() {
    const { lot } = this.s;
    if (lot.status !== 'live') return err('No live lot to pause');
    lot.remainingMs = Math.max(0, lot.endsAt - Date.now());
    lot.status = 'paused';
    clearTimeout(this.timer);
    this.log('Lot paused');
    this.emit();
    return ok();
  }

  resume() {
    const { lot } = this.s;
    if (lot.status !== 'paused') return err('Lot is not paused');
    lot.endsAt = Date.now() + lot.remainingMs;
    lot.status = 'live';
    this.arm();
    this.log('Lot resumed');
    this.emit();
    return ok();
  }

  // Atomic: purse, squad, player status and lot reset all change in this one function.
  sold() {
    const { lot } = this.s;
    if (lot.status === 'idle') return err('No lot to close');
    if (lot.leaderId === null) return err('No bids yet - mark Unsold instead');
    const team = this.s.teams[lot.leaderId];
    const p = this.player(lot.playerId);
    if (team.purse < lot.currentBid) return err('Leader cannot afford this (should never happen)');

    team.purse -= lot.currentBid;
    team.squad.push({ id: p.id, name: p.name, role: p.role, price: lot.currentBid });
    p.status = 'sold';
    this.s.lastResult = { type: 'sold', playerName: p.name, teamName: team.name, teamColor: team.color, price: lot.currentBid };
    this.log(`SOLD: ${p.name} to ${team.name} for ${lot.currentBid}L`);
    this.closeLot();
    return ok();
  }

  unsold() {
    const { lot } = this.s;
    if (lot.status === 'idle') return err('No lot to close');
    const p = this.player(lot.playerId);
    p.status = 'unsold';
    this.s.lastResult = { type: 'unsold', playerName: p.name };
    this.log(`UNSOLD: ${p.name}`);
    this.closeLot();
    return ok();
  }

  closeLot() {
    clearTimeout(this.timer);
    Object.assign(this.s.lot, { status: 'idle', playerId: null, currentBid: 0, leaderId: null, endsAt: 0, remainingMs: 0 });
    this.emit();
  }

  requeue(playerId) {
    const p = this.player(playerId);
    if (!p || p.status !== 'unsold') return err('Only unsold players can be re-queued');
    p.status = 'pending';
    this.log(`${p.name} re-queued`);
    this.emit();
    return ok();
  }

  setBreak(on, message = '') {
    if (this.s.lot.status !== 'idle') return err('Close the current lot first');
    this.s.mode = on ? 'break' : 'auction';
    this.s.breakMessage = on ? String(message).slice(0, 80) || 'Short break' : '';
    this.log(on ? `Break: ${this.s.breakMessage}` : 'Auction resumed');
    this.emit();
    return ok();
  }

  setConfig(patch) {
    const c = this.s.config;
    for (const k of ['lotSeconds', 'minSquad', 'maxSquad', 'minWK', 'minBowlers']) {
      if (patch[k] === undefined) continue;
      const v = Math.floor(Number(patch[k]));
      if (!Number.isFinite(v) || v < 1 || v > 3600) return err(`Invalid value for ${k}`);
      c[k] = v;
    }
    this.log('Settings updated');
    this.emit();
    return ok();
  }

  reset() {
    clearTimeout(this.timer);
    Object.assign(this.s, fresh()); // same object reference, brand-new contents
    this.log('Auction reset');
    this.emit();
    return ok();
  }

  // ---------- what clients are allowed to see (never passcodes) ----------
  publicState() {
    const s = this.s;
    const p = this.player(s.lot.playerId);
    const leader = s.teams[s.lot.leaderId];
    return {
      serverNow: Date.now(),
      config: s.config, mode: s.mode, breakMessage: s.breakMessage,
      teams: Object.values(s.teams).map(t => ({
        id: t.id, name: t.name, color: t.color, purse: t.purse, squad: t.squad, status: this.squadStatus(t)
      })),
      players: s.players,
      lot: { ...s.lot, player: p || null, nextBid: this.nextBid(), leaderName: leader ? leader.name : null, leaderColor: leader ? leader.color : null },
      lastResult: s.lastResult,
      log: s.log.slice(0, 30)
    };
  }

  exportCsv() {
    const rows = ['Team,Player,Role,Price (lakhs)'];
    for (const t of Object.values(this.s.teams))
      for (const p of t.squad) rows.push(`"${t.name}","${p.name}",${p.role},${p.price}`);
    return rows.join('\n');
  }
}

module.exports = { Auction, increment };

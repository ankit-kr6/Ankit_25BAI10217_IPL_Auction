// Run: npm test   (tests the rules engine directly, no server needed)
const assert = require('assert');
const { fresh } = require('../server/state');
const { Auction, increment } = require('../server/auction');

const a = new Auction(fresh());
const t = (name, fn) => { fn(); console.log('ok -', name); };

t('increment tiers', () => {
  assert.strictEqual(increment(50), 10);
  assert.strictEqual(increment(100), 20);
  assert.strictEqual(increment(499), 20);
  assert.strictEqual(increment(500), 50);
});

t('cannot bid with no live lot', () => assert.strictEqual(a.placeBid('MI').ok, false));

t('first bid = base price, leader cannot re-bid', () => {
  assert.ok(a.startLot(1).ok); // Kohli, base 200
  assert.strictEqual(a.placeBid('MI').amount, 200);
  assert.strictEqual(a.placeBid('MI').ok, false);
});

t('next bid uses tier (200 -> 220)', () => assert.strictEqual(a.placeBid('CSK').amount, 220));

t('purse check blocks unaffordable bid', () => {
  a.s.teams.RCB.purse = 100;
  assert.strictEqual(a.placeBid('RCB').ok, false);
});

t('sold is atomic: purse, squad, status, lot reset', () => {
  assert.ok(a.sold().ok);
  assert.strictEqual(a.s.teams.CSK.purse, 12500 - 220);
  assert.strictEqual(a.s.teams.CSK.squad.length, 1);
  assert.strictEqual(a.player(1).status, 'sold');
  assert.strictEqual(a.s.lot.status, 'idle');
});

t('sold with no bids is rejected; unsold works and can be re-queued', () => {
  a.startLot(2);
  assert.strictEqual(a.sold().ok, false);
  assert.ok(a.unsold().ok);
  assert.ok(a.requeue(2).ok);
  assert.strictEqual(a.player(2).status, 'pending');
});

t('pause freezes, resume continues', () => {
  a.startLot(3);
  assert.ok(a.pause().ok);
  assert.strictEqual(a.placeBid('MI').ok, false); // paused = no bids
  assert.ok(a.resume().ok);
  assert.ok(a.placeBid('MI').ok);
  a.unsold();
});

console.log('all tests passed');
process.exit(0);

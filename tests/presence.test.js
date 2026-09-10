const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Presence } = require('../desktop/presence');
const phone = now => ({ receivedAt: now, wifi: 'home', bluetooth: true, serviceRunning: true });
const create = () => new Presence({ calibrated: true, near: -60, far: -72, dwellMs: 5000 });

test('near signal requires dwell and tolerates the hysteresis band', () => {
  const p = create();
  for (let now = 1000; now <= 7000; now += 1000) { p.observe(-50, now); p.update(phone(now), true, now); }
  assert.equal(p.state, 'available');
  for (let now = 8000; now <= 20000; now += 1000) { p.observe(-65, now); p.update(phone(now), true, now); }
  assert.equal(p.state, 'available');
});
test('home Wi-Fi separates brief absence from leaving home', () => {
  const p = create();
  for (let now = 1000; now <= 7000; now += 1000) { p.observe(-85, now); p.update(phone(now), true, now); }
  assert.equal(p.state, 'brief');
  for (let now = 8000; now <= 14000; now += 1000) p.update({ ...phone(now), wifi: 'away' }, true, now);
  assert.equal(p.state, 'away');
});
test('missing sensor health is unknown, never absence', () => {
  for (const overrides of [{ bluetooth: false }, { wifi: 'unknown' }, { serviceRunning: false }, { receivedAt: 0 }]) {
    const p = create(); assert.equal(p.update({ ...phone(20000), ...overrides }, true, 20000), 'unknown');
  }
  assert.equal(create().update(phone(1000), false, 1000), 'unknown');
  assert.equal(new Presence().update(phone(1000), true, 1000), 'unknown');
});
test('healthy missing BLE means brief or away; an outage remains unknown', () => {
  const p = create();
  for (let now = 0; now <= 6000; now += 1000) { p.observe(-50, now); p.update(phone(now), true, now); }
  assert.equal(p.state, 'available');
  for (let now = 7000; now <= 16000; now += 1000) p.update(phone(now), true, now);
  assert.equal(p.state, 'brief');
  for (let now = 17000; now <= 23000; now += 1000) p.update({ ...phone(now), wifi: 'away' }, true, now);
  assert.equal(p.state, 'away');
  assert.equal(p.update(null, true, 24000), 'unknown');
  assert.equal(p.update(phone(24000), false, 24000), 'unknown');
  p.observe(0, 25000); assert.equal(p.samples.length, 0);
});

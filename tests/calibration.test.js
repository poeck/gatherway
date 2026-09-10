const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Calibration, calibrationIssue } = require('../desktop/calibration');

function record(c, group, signal, base = 0) {
  c.start(group, base); c.tick(base + 20000, null);
  for (let i = 1; i <= 120; i++) {
    const now = base + 20000 + i * 1000;
    const value = signal(i);
    if (value !== null) c.observe(value, now, null);
    c.tick(now, null);
  }
}

test('two healthy timed groups accept sparse or completely absent far-room BLE', () => {
  for (const signal of [() => null, i => i % 12 === 0 ? -99 : null]) {
    const c = new Calibration();
    record(c, 'near', () => -65); record(c, 'far', signal, 200000);
    assert.equal(c.active, null);
    assert.equal(c.state(400000).groups.far.complete, true);
    assert.ok(c.state(400000).groups.far.samples < 15);
    assert.ok(c.state(400000).groups.far.noSignalSeconds > 60);
    assert.deepEqual(c.calculate(), { near: -65, far: -71, dwellMs: 5000, calibrated: true, calibrationVersion: 2 });
  }
});
test('a burst of samples cannot replace elapsed time or reliable in-room reception', () => {
  const c = new Calibration(); c.start('near', 0); c.tick(20000, null);
  for (let i = 0; i < 1000; i++) c.observe(-60, 21000, null);
  c.tick(21000, null); c.stop();
  assert.throws(() => c.calculate(), /two minutes/);
  c.reset(); record(c, 'near', i => i === 1 ? -60 : null); record(c, 'far', () => null, 200000);
  assert.throws(() => c.calculate(), /too irregular/);
});
test('strong far-room observations cannot be hidden by many missing packets', () => {
  const c = new Calibration(); record(c, 'near', () => -65);
  record(c, 'far', i => i === 40 ? -67 : null, 200000);
  assert.throws(() => c.calculate(), /overlap/);
  assert.deepEqual(c.state(400000).comparison, { complete: true, nearWeak: -65, farStrong: -67, margin: 2, requiredMargin: 6 });
  assert.throws(() => c.calculate(), /margin 2 dB, required 6 dB/);
});
test('diagnostics distinguish a weak baseline from overlap and absent far-room reception', () => {
  const c = new Calibration(); record(c, 'near', () => -125); record(c, 'far', () => null, 200000);
  assert.equal(c.comparison().farStrong, null); assert.equal(c.comparison().margin, null);
  assert.throws(() => c.calculate(), /too weak \(-125 dBm\)/);
});
test('countdown, unhealthy monitoring and stalled clocks never count as absence evidence', () => {
  const c = new Calibration(); c.start('far', 0);
  c.observe(-50, 5000, null); c.tick(10000, null);
  assert.equal(c.state(10000).countdownSeconds, 10);
  assert.equal(c.groups.far.samples, 0);
  for (let now = 20000; now <= 160000; now += 1000) c.tick(now, 'No fresh phone');
  assert.equal(c.groups.far.validMs, 0);
  c.tick(161000, null); c.tick(200000, null);
  assert.equal(c.groups.far.validMs, 0);
  c.tick(201000, null); assert.equal(c.groups.far.validMs, 1000);
  c.tick(200000, null); assert.equal(c.groups.far.validMs, 1000);
});
test('stopping preserves progress; resuming excludes time spent stopped; reset is per group', () => {
  const c = new Calibration(); record(c, 'near', () => -60);
  c.start('far', 200000); c.tick(220000, null);
  c.tick(221000, null); c.stop();
  c.tick(900000, null); assert.equal(c.groups.far.validMs, 1000);
  c.start('far', 1000000); c.tick(1020000, null); c.tick(1021000, null);
  assert.equal(c.groups.far.validMs, 2000);
  assert.throws(() => c.resetGroup('far'), /Stop collecting/);
  c.stop(); c.resetGroup('far');
  assert.equal(c.groups.far.validMs, 0); assert.equal(c.groups.near.validMs, 120000);
});
test('phone, Wi-Fi and scan readiness are required for calibration even with no RSSI', () => {
  const phone = { receivedAt: 1000, wifi: 'home', bluetooth: true, serviceRunning: true };
  assert.equal(calibrationIssue(phone, true, 2000), null);
  for (const change of [{ wifi: 'away' }, { wifi: 'unknown' }, { bluetooth: false }, { serviceRunning: false }, { receivedAt: -20000 }, { receivedAt: 3000 }]) {
    assert.ok(calibrationIssue({ ...phone, ...change }, true, 2000));
  }
  assert.ok(calibrationIssue(null, true, 2000));
  assert.ok(calibrationIssue(phone, false, 2000));
});
test('short invalid intervals break continuity and do not reuse old RSSI', () => {
  const c = new Calibration(); c.start('far', 0); c.tick(20000, null);
  c.observe(-70, 21000, null); c.tick(21000, null);
  c.invalidate('Bluetooth stopped'); c.tick(22000, null); c.tick(23000, null);
  assert.equal(c.groups.far.validMs, 2000);
  assert.equal(c.groups.far.signalMs, 1000);
  assert.equal(c.groups.far.frames.at(-1).rssi, null);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PresenceProfiles, profileWifi } = require('../desktop/presence-profiles');
const { Calibration } = require('../desktop/calibration');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gatherway-profiles-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, open: () => new PresenceProfiles(directory, 'test-device', { calibrated: false }) };
}
function record(c, group, signal, base = 0) {
  c.start(group, base); c.tick(base + 20000, null);
  for (let i = 1; i <= 120; i++) {
    const now = base + 20000 + i * 1000;
    if (signal !== null) c.observe(signal, now, null);
    c.tick(now, null);
  }
}
test('profiles restore separate measurements, thresholds, home networks and selection', t => {
  const f = fixture(t); const p = f.open(); p.edit('Apartment', 'Apartment Wi-Fi');
  const apartment = p.activeId;
  record(p.active.calibration, 'near', -60); record(p.active.calibration, 'far', null, 200000);
  p.active.presence = p.active.calibration.calculate(); p.save();
  p.create('Parents', 'Parents Wi-Fi'); const parents = p.activeId;
  p.active.calibration.start('near', 0); p.active.calibration.tick(20000, null);
  p.active.calibration.observe(-70, 21000, null); p.active.calibration.tick(21000, null); p.checkpoint();
  const restored = f.open();
  assert.equal(restored.activeId, parents); assert.equal(restored.active.homeWifi, 'Parents Wi-Fi');
  assert.equal(restored.active.calibration.active, null);
  assert.equal(restored.active.calibration.groups.near.validMs, 1000);
  assert.equal(restored.active.calibration.recent.length, 0);
  restored.active.calibration.tick(999999, null); assert.equal(restored.active.calibration.groups.near.validMs, 1000);
  restored.select(apartment);
  assert.equal(restored.active.presence.near, -60);
  assert.deepEqual(restored.active.calibration.calculate(), restored.active.presence);
  assert.equal(restored.active.calibration.groups.far.validMs, 120000);
  assert.equal(fs.statSync(path.join(f.directory, 'presence-profiles.json')).mode & 0o777, 0o600);
  const raw = fs.readFileSync(path.join(f.directory, 'presence-profiles.json'), 'utf8');
  assert.ok(!raw.includes('test-device')); assert.ok(!raw.includes('fcmToken'));
});
test('renaming and switching keep both groups; reset affects only the selected profile', t => {
  const f = fixture(t); const p = f.open(); const first = p.activeId;
  record(p.active.calibration, 'near', -65); p.edit('Apartment', 'Wi-Fi');
  assert.equal(p.active.calibration.groups.near.validMs, 120000);
  p.create('Parents', 'Other'); const second = p.activeId;
  record(p.active.calibration, 'near', -75); p.select(first);
  p.active.calibration.resetGroup('near'); p.save();
  const restored = f.open(); assert.equal(restored.active.calibration.groups.near.validMs, 0);
  restored.select(second); assert.equal(restored.active.calibration.groups.near.validMs, 120000);
});
test('truncated or incompatible saved files are preserved and never treated as completed trials', t => {
  const f = fixture(t); const file = path.join(f.directory, 'presence-profiles.json');
  fs.writeFileSync(file, '{incomplete');
  const p = f.open(); assert.equal(p.blocked, true); p.checkpoint();
  assert.equal(fs.readFileSync(file, 'utf8'), '{incomplete');
  assert.throws(() => p.active.calibration.calculate(), /two minutes/);
  assert.throws(() => Calibration.restore({ near: { frames: [] } }), /Invalid/);
});
test('failed atomic replacement retains the previously saved profiles and reports failure', t => {
  const f = fixture(t); const p = f.open(); const before = fs.readFileSync(p.file, 'utf8');
  const rename = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error('Disk failure'); };
    assert.throws(() => p.edit('Unsaved name', ''), /Could not save/);
    assert.equal(fs.readFileSync(p.file, 'utf8'), before);
    assert.equal(fs.readdirSync(f.directory).length, 1);
  } finally { fs.renameSync = rename; }
  p.checkpoint(); assert.equal(f.open().active.name, 'Unsaved name');
});
test('home classification follows the selected SSID and never trusts legacy or missing Wi-Fi data', () => {
  const body = { wifiTelemetryVersion: 1, wifi: 'home', wifiSsid: 'Apartment' };
  assert.equal(profileWifi(body, 'Apartment'), 'home');
  assert.equal(profileWifi(body, 'Parents'), 'away');
  assert.equal(profileWifi({ ...body, wifi: 'unknown', wifiSsid: null }, 'Apartment'), 'unknown');
  assert.equal(profileWifi({ ...body, wifi: 'away', wifiSsid: null }, 'Apartment'), 'away');
  assert.equal(profileWifi({ wifi: 'home' }, 'Apartment'), 'unknown');
  assert.equal(profileWifi(body, ''), 'unknown');
});
test('restoration rejects inconsistent durations and invalid RSSI instead of inventing valid monitoring', () => {
  const c = new Calibration(); record(c, 'near', -65);
  for (const mutate of [g => { g.near.validMs++; }, g => { g.near.frames[0].rssi = 0; }, g => { g.near.signalMs = 0; }, g => { g.near.frames[0].durationMs = 90000; }]) {
    const saved = c.export(); mutate(saved); assert.throws(() => Calibration.restore(saved), /Invalid/);
  }
});

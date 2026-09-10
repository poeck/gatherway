const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { parseHTML } = require('linkedom');
const { Calibration } = require('../desktop/calibration');
const { PresenceProfiles } = require('../desktop/presence-profiles');
const os = require('node:os');

test('settings show time, gaps and countdown, and distinguish resume from reset', () => {
  const document = parseHTML(fs.readFileSync(path.join(__dirname, '../desktop/settings.html'), 'utf8')).document;
  const context = { document, window: { gatherway: { command: async () => ({}) } }, setInterval() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../desktop/settings.js'), 'utf8') + '\nglobalThis.draw = render;', context);
  const group = { samples: 0, validSeconds: 0, signalPercent: 0, noSignalSeconds: 0, complete: false };
  const state = {
    config: { paused: false, presence: { calibrated: false } }, phone: null, snapshot: {}, lastRssi: null,
    calibration: { active: null, message: 'Stopped', countdownSeconds: 0, requiredSeconds: 120, groups: { near: { ...group, validSeconds: 120, complete: true }, far: { ...group, validSeconds: 30, noSignalSeconds: 30 } } },
  };
  context.draw(state);
  assert.equal(document.getElementById('collectNear').disabled, true);
  assert.equal(document.getElementById('collectFar').textContent, 'Resume other rooms');
  assert.equal(document.getElementById('calibrate').disabled, true);
  assert.match(document.getElementById('samples').textContent, /30\/120s valid.*No signal 30s/);
  state.calibration.active = 'far'; state.calibration.countdownSeconds = 20;
  context.draw(state);
  assert.equal(document.getElementById('resetFar').disabled, true);
  assert.equal(document.getElementById('stopCollect').disabled, false);
  assert.match(document.getElementById('samples').textContent, /starts in 20s/);
  state.calibration.active = null; state.calibration.groups.far.complete = true;
  state.calibration.comparison = { complete: true, nearWeak: -65, farStrong: -67, margin: 2, requiredMargin: 6 };
  context.draw(state); assert.equal(document.getElementById('calibrate').disabled, false);
  assert.match(document.getElementById('samples').textContent, /weaker in-room -65 dBm/);
  assert.match(document.getElementById('samples').textContent, /Separation: 2 dB.*Required: 6 dB/);
  state.presenceProfiles = { activeId: 'apartment', status: 'Measurements saved locally', profiles: [{ id: 'apartment', name: 'Apartment', homeWifi: 'Wi-Fi A' }, { id: 'parents', name: 'Parents', homeWifi: 'Wi-Fi B' }] };
  context.draw(state);
  assert.equal(document.getElementById('presenceProfileName').value, 'Apartment');
  document.getElementById('presenceProfileName').value = 'Typing a new name';
  context.draw(state); assert.equal(document.getElementById('presenceProfileName').value, 'Typing a new name');
  state.presenceProfiles.activeId = 'parents'; context.draw(state);
  assert.equal(document.getElementById('presenceProfileWifi').value, 'Wi-Fi B');
  assert.match(document.getElementById('profileStorage').textContent, /saved locally/);
});

test('controller preserves stopped trials and keeps movement disabled during calibration', async () => {
  const filename = path.join(__dirname, '../desktop/controller.js');
  const localRequire = createRequire(filename);
  const context = { module: { exports: {} }, require: name => name === 'electron' ? {} : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  const Controller = context.module.exports.Controller;
  let saves = 0;
  const controller = Object.assign(Object.create(Controller.prototype), {
    calibration: new Calibration(), config: { paused: false, movementVerified: true, presence: { calibrated: false } },
    store: { save() { saves++; } }, state() { return {}; },
  });
  await controller.command('collect', 'near');
  assert.equal(controller.collecting, 'near'); assert.equal(controller.config.movementVerified, false);
  const start = controller.calibration.readyAt;
  controller.calibration.tick(start, null); controller.calibration.observe(-60, start + 1000, null); controller.calibration.tick(start + 1000, null);
  await controller.command('collect', null);
  assert.equal(controller.calibration.groups.near.validMs, 1000);
  await assert.rejects(controller.command('calibrate'), /two minutes/);
  assert.equal(controller.config.presence.calibrated, false);
  await controller.command('collect', 'near');
  assert.equal(controller.calibration.groups.near.validMs, 1000);
  await controller.command('collect', null); await controller.command('reset-calibration', 'near');
  assert.equal(controller.calibration.groups.near.validMs, 0);
  controller.config.paused = true;
  await assert.rejects(controller.command('collect', 'far'), /Resume desktop/);
  assert.equal(saves, 2);
});

test('switching presence profiles clears old phone state, overrides and movement verification', async t => {
  const filename = path.join(__dirname, '../desktop/controller.js'); const localRequire = createRequire(filename);
  const context = { module: { exports: {} }, require: name => name === 'electron' ? {} : localRequire(name), Set };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gatherway-switch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const profiles = new PresenceProfiles(directory, 'test-phone', { calibrated: false });
  profiles.edit('Apartment', 'A'); const first = profiles.activeId;
  profiles.create('Parents', 'B'); const second = profiles.activeId; profiles.select(first);
  const controller = Object.assign(Object.create(context.module.exports.Controller.prototype), {
    presenceProfiles: profiles, calibration: profiles.active.calibration,
    config: { presence: { calibrated: true }, movementVerified: true }, phone: { wifi: 'home' }, override: 'available', ble: { healthy: true },
    testedDestinations: new Set(['desk']), store: { save() {} }, state() { return {}; },
    disconnect() { this.calibration.stop(); this.phone = null; this.availability = 'unknown'; },
  });
  await controller.command('select-presence-profile', second);
  assert.equal(controller.calibration, profiles.active.calibration);
  assert.equal(controller.config.presence.calibrated, false);
  assert.equal(controller.config.movementVerified, false); assert.equal(controller.phone, null);
  assert.equal(controller.override, null); assert.equal(controller.testedDestinations.size, 0);
  assert.equal(controller.calibrationIssue(1000), 'Waiting for fresh phone telemetry');
});

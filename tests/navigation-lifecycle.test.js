const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { resetsGatherDocument, movementInterruption } = require('../desktop/navigation-lifecycle');

test('modern and legacy in-page navigation retain the Gather document', () => {
  assert.equal(resetsGatherDocument({ url: 'https://app.v2.gather.town/office#desk', isSameDocument: true, isMainFrame: true }), false);
  assert.equal(resetsGatherDocument({}, 'https://app.v2.gather.town/office?desk=me', true, true), false);
});
test('reload, changed origin and unknown main-frame navigation still reset', () => {
  assert.equal(resetsGatherDocument({ url: 'https://app.v2.gather.town/office', isSameDocument: false, isMainFrame: true }), true);
  assert.equal(resetsGatherDocument({}, 'https://app.v2.gather.town/office', false, true), true);
  assert.equal(resetsGatherDocument({}, 'https://example.com', true, true), true);
  assert.equal(resetsGatherDocument({}, undefined, true, true), true);
  assert.equal(resetsGatherDocument({ isMainFrame: false }), false);
});
test('ordinary keys and scrolling acknowledge without interrupting a walk', () => {
  for (const kind of ['keydown', 'wheel', 'pointerdown']) assert.equal(movementInterruption({ kind, movement: false }, true), null);
  assert.match(movementInterruption({ kind: 'keydown', movement: true }, true), /Movement key/);
  assert.match(movementInterruption({ kind: 'dblclick', movement: true }, true), /Map movement/);
  assert.equal(movementInterruption({ kind: 'pointerdown', movement: false }, false), null);
});
test('preload forwards trusted input categories but ignores generated clicks and typing as movement', () => {
  const handlers = {}, messages = [];
  class Element { closest(selector) { return selector === 'canvas' ? this.canvas : this.editable; } }
  const window = { addEventListener(name, fn) { handlers[name] = fn; } }; window.top = window;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../desktop/gather-preload.js'), 'utf8'), { window, Element, require: () => ({ ipcRenderer: { send: (_, data) => messages.push(data) } }) });
  handlers.pointerdown({ isTrusted: false }); assert.equal(messages.length, 0);
  handlers.wheel({ isTrusted: true }); assert.equal(messages[0].kind, 'wheel'); assert.equal(messages[0].movement, false);
  const target = new Element(); target.editable = true;
  handlers.keydown({ isTrusted: true, key: 'w', target }); assert.equal(messages[1].movement, false);
  target.editable = false;
  handlers.keydown({ isTrusted: true, key: 'w', target }); assert.equal(messages[2].movement, true);
  handlers.dblclick({ isTrusted: true, target }); assert.equal(messages[3].movement, false);
  target.canvas = true;
  handlers.dblclick({ isTrusted: true, target }); assert.equal(messages[4].movement, true);
  assert.equal(messages[4].kind, 'dblclick');
});

test('controller keeps pending verification on in-page navigation and cancels real document replacement', () => {
  const filename = path.join(__dirname, '../desktop/controller.js'), localRequire = createRequire(filename);
  const handlers = {}, ipc = {};
  const config = { presence: {}, locations: {}, spaceId: 'space', selfId: 'self' };
  const calibration = { stop() {}, invalidate() {} };
  const adapter = { generation: 0, pending: true, validOrigin: () => true, invalidate(reason) { this.reason = reason; this.generation++; }, disconnect(reason) { this.invalidate(reason); } };
  const overrides = {
    electron: { ipcMain: { on: (name, fn) => { ipc[name] = fn; }, handle() {} } },
    './store': { Store: class { constructor() { this.config = config; this.directory = '/tmp'; } } },
    './presence-profiles': { PresenceProfiles: class { constructor() { this.active = { presence: {}, calibration }; } checkpoint() {} } },
    './ble': { BleScanner: class { start() {} } },
    './fcm': { Fcm: class {} },
    './adapter': { GatherAdapter: class { constructor() { return adapter; } } },
    './transport': { Transport: class { start() {} } },
  };
  const context = { module: { exports: {} }, require: name => overrides[name] || localRequire(name), setInterval() {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  const webContents = { mainFrame: {}, on: (name, fn) => { handlers[name] = fn; } };
  const c = new context.module.exports.Controller({ getPath: () => '/tmp' }, { webContents });
  let acknowledgements = 0; c.engine.interact = () => { acknowledgements++; return []; };
  const sender = { sender: webContents, senderFrame: webContents.mainFrame };
  ipc['gatherway:interaction'](sender, { kind: 'wheel', movement: false });
  ipc['gatherway:interaction'](sender, { kind: 'pointerdown', movement: false });
  assert.equal(acknowledgements, 2); assert.equal(adapter.generation, 0);
  handlers['did-start-navigation']({ isMainFrame: true, isSameDocument: true, url: 'https://app.v2.gather.town/office#desk' });
  assert.equal(adapter.generation, 0);
  ipc['gatherway:interaction'](sender, { kind: 'keydown', movement: true });
  assert.equal(adapter.generation, 1); assert.match(adapter.reason, /Movement key/);
  handlers['did-start-navigation']({ isMainFrame: true, isSameDocument: false, url: 'https://app.v2.gather.town/office' });
  assert.equal(adapter.generation, 2); assert.match(adapter.reason, /document navigation/);
});

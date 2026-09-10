const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const { inspectGather } = require('../desktop/adapter-dom');
const { GatherAdapter } = require('../desktop/adapter');
const profile = require('./fixtures/synthetic-profile.json');
const expected = { spaceId: 'office', selfId: 'me' };
const fixture = () => parseHTML(fs.readFileSync(path.join(__dirname, 'fixtures/synthetic-office.html'), 'utf8')).document;

test('synthetic contract reads identity, empty participants, media and destinations', () => {
  const snapshot = inspectGather(fixture(), profile, expected);
  assert.equal(snapshot.connected, true); assert.equal(snapshot.location, 'desk'); assert.deepEqual(snapshot.participants, []);
  assert.equal(snapshot.mic, false); assert.equal(snapshot.camera, false); assert.equal(snapshot.canMove, true); assert.deepEqual(snapshot.errors, []);
});
test('missing containers are unknown rather than empty conversations', () => {
  const document = fixture(); document.querySelector('[aria-label="Conversation participants"]').remove();
  const snapshot = inspectGather(document, profile, expected);
  assert.equal(snapshot.participants, null); assert.ok(snapshot.errors.includes('participants unavailable'));
});
test('duplicate identity selectors disconnect and ambiguous media does not toggle', () => {
  const document = fixture(); document.body.append(document.querySelector('main').cloneNode(true));
  const snapshot = inspectGather(document, profile, expected);
  assert.equal(snapshot.connected, false); assert.equal(snapshot.mic, null); assert.equal(snapshot.canMove, false);
});
test('only waves addressed to the configured identity are emitted', () => {
  const document = fixture(); document.querySelector('[aria-label="Directed waves"]').innerHTML = '<div data-wave="one" data-from="alice" data-to="me"></div><div data-wave="two" data-from="alice" data-to="bob"></div>';
  assert.deepEqual(inspectGather(document, profile, expected).waves, [{ id: 'one', fromId: 'alice' }]);
});
test('adapter without a profile is explicitly unavailable', () => {
  const result = inspectGather(fixture(), null, expected); assert.equal(result.connected, false); assert.equal(result.participants, null);
});
test('media action rechecks current state before clicking and confirms result', async () => {
  const document = fixture(); const button = document.querySelector('[aria-label="Microphone"]'); let clicks = 0;
  button.setAttribute('aria-pressed', 'true'); button.click = () => { clicks++; button.setAttribute('aria-pressed', 'false'); };
  const adapter = new GatherAdapter(null, { profile, selfId: 'me' }); adapter.evaluate = async (fn, ...args) => fn(document, ...args); adapter.snapshot = async () => inspectGather(document, profile, expected);
  await adapter.disableMedia({ mic: true, camera: true }); assert.equal(clicks, 1);
  await adapter.disableMedia({ mic: true }); assert.equal(clicks, 1);
});
test('media action reports a control that failed to disable', async () => {
  const document = fixture(); const button = document.querySelector('[aria-label="Microphone"]'); button.setAttribute('aria-pressed', 'true'); button.click = () => {};
  const adapter = new GatherAdapter(null, { profile, selfId: 'me' }); adapter.evaluate = async (fn, ...args) => fn(document, ...args); adapter.snapshot = async () => inspectGather(document, profile, expected);
  await assert.rejects(adapter.disableMedia({ mic: true }), /not confirmed/);
});
test('movement confirms the actual destination and handles missing controls', async () => {
  const document = fixture(); const button = document.querySelector('[data-destination="break"]'); button.getClientRects = () => [{}]; button.click = () => document.querySelector('main').setAttribute('data-location', 'break');
  const adapter = new GatherAdapter(null, { profile }); adapter.evaluate = async (fn, ...args) => fn(document, ...args); adapter.snapshot = async () => inspectGather(document, profile, expected);
  assert.equal(await adapter.move('break'), true); button.remove(); assert.equal(await adapter.move('break'), false); assert.equal(await adapter.move('missing'), false);
});

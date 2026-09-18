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
  button.getClientRects = () => [{}]; button.setAttribute('aria-pressed', 'true'); button.click = () => { clicks++; button.setAttribute('aria-pressed', 'false'); };
  const adapter = new GatherAdapter(null, { profile, selfId: 'me' }); adapter.evaluate = async (fn, ...args) => fn(document, ...args); adapter.snapshot = async () => inspectGather(document, profile, expected);
  await adapter.disableMedia({ mic: true, camera: true }); assert.equal(clicks, 1);
  await adapter.disableMedia({ mic: true }); assert.equal(clicks, 1);
});
test('media action reports a control that failed to disable', async () => {
  const document = fixture(); const button = document.querySelector('[aria-label="Microphone"]'); button.getClientRects = () => [{}]; button.setAttribute('aria-pressed', 'true'); button.click = () => {};
  const adapter = new GatherAdapter(null, { profile, selfId: 'me' }); adapter.evaluate = async (fn, ...args) => fn(document, ...args); adapter.snapshot = async () => inspectGather(document, profile, expected);
  await assert.rejects(adapter.disableMedia({ mic: true }), /not confirmed/);
});
test('movement confirms the actual destination and handles missing controls', async () => {
  const document = fixture(); const button = document.querySelector('[data-destination="break"]'); button.getClientRects = () => [{}]; button.click = () => document.querySelector('main').setAttribute('data-location', 'break');
  const adapter = new GatherAdapter(null, { profile, ...expected }); adapter.evaluate = async (fn, ...args) => fn(document, ...args); adapter.snapshot = async () => inspectGather(document, profile, expected);
  assert.equal(await adapter.move('break'), true); button.remove(); assert.equal(await adapter.move('break'), false); assert.equal(await adapter.move('missing'), false);
});

// Only media identifiers come from the real client; surrounding office state is synthetic.
const mediaProfile = { ...profile, ...require('../desktop/profiles/gather-v2-media.json') };
test('structured waves remain diagnostic without an explicit profile source', async () => {
  const adapter = new GatherAdapter(null, { profile, ...expected });
  adapter.evaluate = async () => inspectGather(fixture(), profile, expected);
  adapter.readWaves = async () => ({ status: 'Listening', ...expected, waves: [{ id: 'one', fromId: 'alice', createdAt: 1000 }] });
  const result = await adapter.snapshot();
  assert.equal(result.waveIntegration.waves.length, 1); assert.deepEqual(result.waves, []);
});
test('structured wave source requires matching identity and a fresh baseline', async () => {
  const structuredProfile = { ...profile, waves: { source: 'gather-events' } };
  const adapter = new GatherAdapter(null, { profile: structuredProfile, ...expected });
  adapter.evaluate = async () => inspectGather(fixture(), structuredProfile, expected);
  let source = { status: 'Listening', ...expected, baseline: true, waves: [] };
  adapter.readWaves = async () => source;
  assert.equal((await adapter.snapshot()).waves, null);
  source = { ...source, baseline: false, waves: [{ id: 'one', fromId: 'alice', createdAt: 1000 }] };
  assert.deepEqual((await adapter.snapshot()).waves, source.waves);
  source.selfId = 'other';
  assert.equal((await adapter.snapshot()).waves, null);
});
test('disconnect invalidates in-flight snapshots and scopes observer cleanup', async () => {
  const adapter = new GatherAdapter(null, { profile, ...expected });
  adapter.evaluate = async () => inspectGather(fixture(), profile, expected);
  let resolve, stoppedToken;
  const token = adapter.waveToken;
  adapter.readWaves = (currentToken, command) => command === 'stop'
    ? (stoppedToken = currentToken, Promise.resolve())
    : new Promise(done => { resolve = done; });
  const pending = adapter.snapshot(); await Promise.resolve();
  adapter.disconnect(); resolve({ status: 'Listening', ...expected, waves: [] });
  await assert.rejects(pending, /session changed/);
  assert.equal(stoppedToken, token); assert.notEqual(adapter.waveToken, token);
});
for (const [kind, label] of [['mic', 'Microphone'], ['camera', 'Camera']]) {
  test(`${kind}: observed action identifiers map to media state and never enable media`, async () => {
    const document = fixture(); const button = document.querySelector(`[aria-label="${label}"]`);
    const spec = mediaProfile[kind]; let clicks = 0;
    button.setAttribute('data-testid', spec.off); button.getClientRects = () => [{}];
    button.click = () => { clicks++; button.setAttribute('data-testid', spec.off); };
    const adapter = new GatherAdapter(null, { profile: mediaProfile, selfId: 'me' });
    adapter.evaluate = async (fn, ...args) => fn(document, ...args);
    adapter.snapshot = async () => inspectGather(document, mediaProfile, expected);
    assert.equal((await adapter.snapshot())[kind], false);
    await adapter.disableMedia({ [kind]: true }); assert.equal(clicks, 0);
    button.setAttribute('data-testid', spec.on);
    assert.equal((await adapter.snapshot())[kind], true);
    await adapter.disableMedia({ [kind]: true }); assert.equal(clicks, 1);
    assert.equal((await adapter.snapshot())[kind], false);
  });
  test(`${kind}: missing, ambiguous, hidden and disabled controls cannot trigger clicks`, async () => {
    const document = fixture(); const button = document.querySelector(`[aria-label="${label}"]`);
    const spec = mediaProfile[kind]; let clicks = 0;
    const adapter = new GatherAdapter(null, { profile: mediaProfile, selfId: 'me' });
    adapter.evaluate = async (fn, ...args) => fn(document, ...args);
    adapter.snapshot = async () => inspectGather(document, mediaProfile, expected);
    button.click = () => { clicks++; };
    assert.equal((await adapter.snapshot())[kind], null);
    await assert.rejects(adapter.disableMedia({ [kind]: true }), /unavailable/);
    button.setAttribute('data-testid', spec.on); button.getClientRects = () => [];
    await assert.rejects(adapter.disableMedia({ [kind]: true }), /unavailable/);
    button.getClientRects = () => [{}]; button.setAttribute('aria-disabled', 'true');
    await assert.rejects(adapter.disableMedia({ [kind]: true }), /unavailable/);
    button.removeAttribute('aria-disabled');
    const duplicate = button.cloneNode(true); duplicate.setAttribute('data-testid', spec.off); document.body.append(duplicate);
    assert.equal((await adapter.snapshot())[kind], null);
    await assert.rejects(adapter.disableMedia({ [kind]: true }), /unavailable/);
    assert.equal(clicks, 0);
  });
}

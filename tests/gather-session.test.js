const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { inspectGatherSession, disableGatherMedia } = require('../desktop/gather-session');
const { GatherAdapter } = require('../desktop/adapter');
const { inspectGather } = require('../desktop/adapter-dom');
const media = require('../desktop/profiles/gather-v2-media.json');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const expected = { spaceId: id(1), selfId: id(2) };
const profile = { ...media, session: { source: 'gather-repos' }, waves: { source: 'gather-events' } };
function fixture() {
  const repos = {
    gameSpace: { wsConnected: true, currentSpaceOrUndefined: { id: expected.spaceId }, currentSpaceUserOrUndefined: { id: expected.selfId } },
    avConnections: { stronglyConnectedSpaceUserIds: [], ambientlyConnectedSpaceUserIds: [id(3)] },
    localMediaSelfInfo: { ownAudioEnabled: false, ownVideoEnabled: false },
  };
  const page = { gatherDev: { Repos: repos } };
  const { document } = parseHTML(`<html><body><button data-testid="${media.mic.off}"></button><button data-testid="${media.camera.off}"></button></body></html>`);
  const clicks = [];
  for (const [kind, property] of [['mic', 'ownAudioEnabled'], ['camera', 'ownVideoEnabled']]) {
    const node = document.querySelector(media[kind].selector);
    node.getClientRects = () => [{}];
    node.click = () => { clicks.push(kind); repos.localMediaSelfInfo[property] = false; node.setAttribute('data-testid', media[kind].off); };
  }
  const setOn = kind => {
    repos.localMediaSelfInfo[kind === 'mic' ? 'ownAudioEnabled' : 'ownVideoEnabled'] = true;
    document.querySelector(media[kind].selector).setAttribute('data-testid', media[kind].on);
  };
  const adapter = new GatherAdapter(null, { ...expected, profile });
  adapter.evaluate = async (fn, ...args) => fn(document, ...args);
  adapter.readSession = async () => inspectGatherSession(page);
  adapter.readWaves = async () => ({ ...expected, status: 'Listening', baseline: false, waves: [] });
  adapter.disableSessionMedia = async (kind, spec) => disableGatherMedia(page, document, inspectGatherSession, expected, kind, spec);
  return { page, repos, document, clicks, setOn, adapter };
}

// Anonymized shapes returned by Paul's locked, unlocked and alone probes.
for (const [state, participants, nearby] of [
  ['locked', [id(3)], []], ['unlocked', [id(3)], [id(4), id(5), id(6)]], ['alone', [], [id(3), id(4), id(5), id(6)]],
]) test(`observed ${state} shape distinguishes participants from nearby listeners while muted`, () => {
  const { page, repos } = fixture();
  repos.avConnections.stronglyConnectedSpaceUserIds = participants;
  repos.avConnections.ambientlyConnectedSpaceUserIds = nearby;
  const result = inspectGatherSession(page);
  assert.equal(result.connected, true); assert.deepEqual(result.participants, participants);
  assert.deepEqual(result.nearbyListeners, nearby); assert.equal(result.mic, false); assert.equal(result.camera, false);
});

test('missing, malformed, duplicate or self participants remain unknown', () => {
  const { page, repos } = fixture();
  for (const value of [undefined, null, {}, ['bad'], [id(3), id(3)], [expected.selfId]]) {
    repos.avConnections.stronglyConnectedSpaceUserIds = value;
    assert.equal(inspectGatherSession(page).participants, null);
  }
  Object.defineProperty(repos.avConnections, 'stronglyConnectedSpaceUserIds', { get() { throw new Error('unavailable'); } });
  assert.equal(inspectGatherSession(page).participants, null);
});

test('connection or identity loss cannot report an empty conversation', () => {
  const { page, repos } = fixture();
  repos.gameSpace.wsConnected = false;
  let result = inspectGatherSession(page);
  assert.equal(result.connected, false); assert.equal(result.participants, null);
  repos.gameSpace.wsConnected = true; repos.gameSpace.currentSpaceUserOrUndefined = undefined;
  result = inspectGatherSession(page);
  assert.equal(result.connected, false); assert.equal(result.participants, null);
});

test('unavailable ambient information does not erase verified conversation participants', () => {
  const { page, repos } = fixture();
  delete repos.avConnections.ambientlyConnectedSpaceUserIds;
  assert.deepEqual(inspectGatherSession(page).participants, []);
  assert.equal(inspectGatherSession(page).nearbyListeners, null);
});

test('session diagnostics do not implicitly activate a missing profile', async () => {
  const { adapter } = fixture(); adapter.config.profile = null;
  const result = await adapter.snapshot();
  assert.equal(result.connected, false); assert.equal(result.participants, null);
  assert.equal(result.sessionIntegration.connected, true);
  assert.deepEqual(result.sessionIntegration.participants, []);
  assert.ok(result.errors.includes('No verified Gather profile'));
});

test('explicit session source requires matching identity and agreement with media controls', async () => {
  const { adapter, repos } = fixture();
  let result = await adapter.snapshot();
  assert.equal(result.connected, true); assert.deepEqual(result.participants, []); assert.equal(result.mic, false);
  assert.equal(result.location, null); assert.equal(result.canMove, false);
  repos.localMediaSelfInfo.ownAudioEnabled = true;
  assert.equal((await adapter.snapshot()).mic, null);
  adapter.config.selfId = id(8);
  result = await adapter.snapshot();
  assert.equal(result.connected, false); assert.equal(result.participants, null); assert.equal(result.camera, null);
});

test('session changes while awaiting a page read invalidate the snapshot', async () => {
  const { adapter } = fixture();
  adapter.readSession = async () => { adapter.invalidate(); return { connected: true, ...expected, participants: [] }; };
  await assert.rejects(adapter.snapshot(), /session changed/);
});

test('media disable uses fresh strong participants, ignoring ambient listeners', async () => {
  const { adapter, setOn, clicks } = fixture();
  setOn('mic'); setOn('camera');
  await adapter.disableMedia({ mic: true, camera: true });
  assert.deepEqual(clicks, ['mic', 'camera']);
  await adapter.disableMedia({ mic: true, camera: true });
  assert.deepEqual(clicks, ['mic', 'camera']);
});

test('a participant joining between microphone and camera actions prevents the second click', async () => {
  const { adapter, setOn, document, repos, clicks } = fixture();
  setOn('mic'); setOn('camera');
  const mic = document.querySelector(media.mic.selector), click = mic.click;
  mic.click = () => { click(); repos.avConnections.stronglyConnectedSpaceUserIds = [id(3)]; };
  await assert.rejects(adapter.disableMedia({ mic: true, camera: true }), /participant joined/);
  assert.deepEqual(clicks, ['mic']); assert.equal(repos.localMediaSelfInfo.ownVideoEnabled, true);
});

test('missing media state, contradictory controls and hidden controls never toggle', async () => {
  const { adapter, setOn, document, repos, clicks } = fixture();
  setOn('mic'); repos.localMediaSelfInfo.ownAudioEnabled = undefined;
  await assert.rejects(adapter.disableMedia({ mic: true }), /state unavailable/);
  repos.localMediaSelfInfo.ownAudioEnabled = false;
  await assert.rejects(adapter.disableMedia({ mic: true }), /contradictory/);
  repos.localMediaSelfInfo.ownAudioEnabled = true;
  document.querySelector(media.mic.selector).getClientRects = () => [];
  await assert.rejects(adapter.disableMedia({ mic: true }), /control unavailable/);
  assert.deepEqual(clicks, []);
});

test('changed identity, disconnected state or unknown participants prevent a media action', async () => {
  for (const change of [
    repos => { repos.gameSpace.currentSpaceOrUndefined.id = id(9); },
    repos => { repos.gameSpace.wsConnected = false; },
    repos => { repos.avConnections.stronglyConnectedSpaceUserIds = null; },
  ]) {
    const { adapter, setOn, repos, clicks } = fixture(); setOn('mic'); change(repos);
    await assert.rejects(adapter.disableMedia({ mic: true }), /Participants unavailable/);
    assert.deepEqual(clicks, []);
  }
});

test('media action reports an unconfirmed disable', async () => {
  const { adapter, setOn, document } = fixture(); setOn('mic');
  document.querySelector(media.mic.selector).click = () => {};
  await assert.rejects(adapter.disableMedia({ mic: true }), /not confirmed/);
});

test('serialized session reader and action run without Node dependencies', async () => {
  const { page, document, setOn, clicks } = fixture(); setOn('mic');
  const context = vm.createContext({ ...page, document });
  const win = { isDestroyed: () => false, webContents: {
    getURL: () => 'https://app.v2.gather.town/office',
    executeJavaScript: async code => vm.runInContext(code, context),
  } };
  const adapter = new GatherAdapter(win, { ...expected, profile });
  assert.equal((await adapter.readSession()).connected, true);
  await adapter.disableSessionMedia('mic', media.mic);
  assert.deepEqual(clicks, ['mic']);
  assert.equal(inspectGather(document, profile, expected).mic, false);
});

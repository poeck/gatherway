const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { deskNavigation, deskButton, installObservedDeskAction } = require('../desktop/gather-navigation');
const { GatherAdapter } = require('../desktop/adapter');
const observed = require('../desktop/profiles/otark-paul-observed.json');
function fixture() {
  const config = { ...observed.location.scope, profile: structuredClone(observed), locations: {} };
  installObservedDeskAction(config);
  const spec = deskNavigation(config);
  const { document } = parseHTML('<button data-testid="leave-meeting-button"></button>');
  const button = document.querySelector('button'); button.getClientRects = () => [{}];
  const user = { id: config.selfId, deskId: spec.deskId, floorId: spec.target.floorId, position: { x: 37, y: 59 }, isAtOwnDesk: false,
    desk: { stableId_USE_THIS_INSTEAD_OF_ID: spec.deskId, deskOwner: { id: config.selfId }, mapOrUndefined: {}, isFullyAVConnected: true, spaceUsers: [] } };
  const repos = { gameSpace: { wsConnected: true, currentSpaceOrUndefined: { id: config.spaceId }, currentSpaceUserOrUndefined: user },
    avConnections: { stronglyConnectedSpaceUserIds: [], ambientlyConnectedSpaceUserIds: [] }, localMediaSelfInfo: { ownAudioEnabled: false, ownVideoEnabled: false } };
  const context = vm.createContext({ document, gatherDev: { Repos: repos } });
  let clicks = 0;
  button.click = () => { clicks++; user.position = { x: spec.target.x, y: spec.target.y }; };
  const win = { isDestroyed: () => false, webContents: { getURL: () => 'https://app.v2.gather.town/office', executeJavaScript: async code => vm.runInContext(code, context) } };
  const adapter = new GatherAdapter(win, config);
  adapter.snapshot = async () => ({ connected: true, spaceId: config.spaceId, selfId: config.selfId, location: `gather:${config.spaceId}:${user.floorId}:${user.position.x}:${user.position.y}` });
  return { config, spec, document, button, user, repos, adapter, clicks: () => clicks };
}

test('observed setup matches identity and desk without enabling automatic movement', () => {
  const { config, spec } = fixture(); assert.equal(config.locations.available, spec.destination); assert.equal(config.movementVerified, false);
  config.selfId = 'different'; assert.throws(() => installObservedDeskAction(config), /does not match/); assert.equal(deskNavigation(config), null);
});
test('desk control requires one visible enabled button', () => {
  const { document, button, clicks } = fixture();
  assert.equal(deskButton(document), true); assert.equal(clicks(), 0);
  button.setAttribute('aria-disabled', 'true'); assert.equal(deskButton(document, true), false);
  button.removeAttribute('aria-disabled'); button.getClientRects = () => []; assert.equal(deskButton(document), false);
  button.getClientRects = () => [{}]; document.appendChild(button.cloneNode()); assert.equal(deskButton(document), false);
});
test('serialized desk action clicks the observed control and confirms actual arrival', async () => {
  const { adapter, spec, clicks } = fixture();
  assert.equal(await adapter.move(spec.destination), true); assert.equal(clicks(), 1);
  assert.equal(adapter.lastMovement.status, 'confirmed'); assert.equal(adapter.lastMovement.observedLocation, spec.destination);
  assert.equal(await adapter.move(spec.destination), true); assert.equal(clicks(), 1);
  assert.equal(await adapter.move('unverified-break'), false);
});
test('a conversation joining just before dispatch blocks the desk action', async () => {
  const { adapter, spec, repos, clicks } = fixture(); repos.avConnections.stronglyConnectedSpaceUserIds = ['00000000-0000-4000-8000-000000000001'];
  assert.equal(await adapter.move(spec.destination), false); assert.equal(clicks(), 0);
});
test('missing participants, reassigned desk and wrong origin block the action', async () => {
  for (const change of [f => { f.repos.avConnections.stronglyConnectedSpaceUserIds = null; }, f => { f.user.desk.deskOwner.id = 'different'; }, f => { f.adapter.win.webContents.getURL = () => 'https://example.com'; }]) {
    const f = fixture(); change(f); assert.equal(await f.adapter.move(f.spec.destination), false); assert.equal(f.clicks(), 0);
  }
});
test('interruption while confirming arrival cannot report success', async () => {
  const { adapter, spec } = fixture();
  const read = adapter.readLocation.bind(adapter);
  adapter.readLocation = async () => { adapter.invalidate(); return read(); };
  assert.equal(await adapter.move(spec.destination), false); assert.equal(adapter.pending, false);
  assert.equal(adapter.lastMovement.status, 'interrupted'); assert.match(adapter.lastMovement.reason, /interrupted/);
});


test('walking animation and transient unreadable position do not fail arrival confirmation', async () => {
  const { adapter, spec, button, user } = fixture();
  let clicks = 0, reads = 0;
  button.click = () => { clicks++; };
  const read = adapter.readLocation.bind(adapter);
  adapter.readLocation = async () => {
    reads++;
    if (reads === 1) throw new Error('Temporary unavailable state');
    if (reads === 2) return { connected: false, spaceId: null, selfId: null, position: null };
    if (reads === 3) return read();
    user.position = { x: spec.target.x, y: spec.target.y };
    return read();
  };
  adapter.snapshot = async () => { throw new Error('Full UI snapshot must not gate desk arrival'); };
  assert.equal(await adapter.move(spec.destination), true);
  assert.equal(clicks, 1); assert.equal(reads, 4);
  assert.equal(adapter.lastMovement.observedLocation, spec.destination);
});

test('wrong identity during walking fails instead of accepting matching coordinates', async () => {
  const { adapter, spec } = fixture();
  const read = adapter.readLocation.bind(adapter);
  adapter.readLocation = async () => ({ ...await read(), selfId: 'different' });
  assert.equal(await adapter.move(spec.destination), false);
  assert.match(adapter.lastMovement.reason, /identity changed/);
});

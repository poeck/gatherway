const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { coordinateNavigation, coordinateAction, installObservedCoordinateActions, observedManualAction } = require('../desktop/gather-navigation');
const { GatherAdapter } = require('../desktop/adapter');
const { MobileDashboard, moveIssue } = require('../desktop/mobile-dashboard');
const observed = require('../desktop/profiles/otark-paul-observed.json');
const { randomUUID } = require('node:crypto');

function fixture() {
  class Position {
    constructor(x, y) { this.x = x; this.y = y; }
    hash() { return `${this.x}/${this.y}`; }
    updatedCopy(x, y) { return new Position(x, y); }
  }
  const config = { ...observed.location.scope, profile: structuredClone(observed), locations: {}, adapterVerified: true, presence: {} };
  installObservedCoordinateActions(config);
  const spec = coordinateNavigation(config, 'brief');
  const user = { id: config.selfId, floorId: spec.target.floorId, position: new Position(37, 61) };
  const game = { wsConnected: true, currentSpaceOrUndefined: { id: config.spaceId }, currentSpaceUserOrUndefined: user };
  const calls = [];
  const controller = { isMovementInterruptible: true, moveSpaceUserToTile(position, floor) {
    assert.ok(position instanceof Position); calls.push({ position, floor }); user.position = position;
  } };
  const page = { gatherDev: { Repos: { gameSpace: game, avConnections: { stronglyConnectedSpaceUserIds: [] } }, MoveController: controller } };
  const context = vm.createContext(page);
  const win = { isDestroyed: () => false, webContents: { getURL: () => 'https://app.v2.gather.town/office', executeJavaScript: async code => vm.runInContext(code, context) } };
  const adapter = new GatherAdapter(win, config);
  return { config, spec, user, game, calls, controller, page, adapter, Position };
}

test('observed coordinate setup saves only the checked destinations and keeps automation off', () => {
  const { config } = fixture(); assert.equal(config.movementVerified, false);
  assert.ok(config.locations.brief.endsWith(':37:59')); assert.ok(config.locations.away.endsWith(':27:51'));
  assert.equal(observedManualAction(config, 'brief'), true);
  config.locations.brief = 'different'; assert.equal(coordinateNavigation(config, 'brief'), null);
  assert.throws(() => installObservedCoordinateActions(config), /does not match/);
});
test('unrelated identities cannot inherit the observed manual verification', () => {
  const { config } = fixture(); config.selfId = 'someone-else';
  assert.equal(observedManualAction(config, 'away'), false);
  assert.throws(() => installObservedCoordinateActions(config), /does not match/);
});
test('readiness checks never construct a Position or start moving', () => {
  const { page, spec, user, calls } = fixture();
  user.position.updatedCopy = () => { throw new Error('Must not construct during polling'); };
  assert.equal(coordinateAction(page, spec, false), null); assert.equal(calls.length, 0);
});
test('serialized action constructs an independent native Position and preserves original coordinates', async () => {
  const { adapter, spec, user, calls } = fixture(); const original = user.position;
  assert.equal(await adapter.move(spec.destination), true);
  assert.equal(calls.length, 1); assert.notEqual(calls[0].position, original);
  assert.deepEqual({ x: original.x, y: original.y }, { x: 37, y: 61 });
  assert.equal(calls[0].position.hash(), '37/59'); assert.equal(calls[0].floor, spec.target.floorId);
  assert.equal(adapter.lastMovement.status, 'confirmed');
});
test('break-room action confirms its own target and already-there requests do not move again', async () => {
  const { config, adapter, calls } = fixture(); const spec = coordinateNavigation(config, 'away');
  assert.equal(await adapter.move(spec.destination), true); assert.equal(calls[0].position.hash(), '27/51');
  assert.equal(await adapter.move(spec.destination), true); assert.equal(calls.length, 1);
});
test('missing methods, noninterruptible movement, conversation and different floor are unavailable', () => {
  for (const change of [f => { f.user.position.updatedCopy = undefined; }, f => { f.controller.moveSpaceUserToTile = undefined; },
    f => { f.controller.isMovementInterruptible = false; }, f => { f.page.gatherDev.Repos.avConnections.stronglyConnectedSpaceUserIds = ['other']; },
    f => { f.user.floorId = 'another-floor'; }, f => { f.game.wsConnected = false; }]) {
    const f = fixture(); change(f); assert.equal(typeof coordinateAction(f.page, f.spec, true), 'string'); assert.equal(f.calls.length, 0);
  }
});
test('plain-object copies, aliasing and state changes while copying never dispatch movement', () => {
  for (const change of [f => { f.user.position.updatedCopy = (x, y) => ({ x, y }); }, f => { f.user.position.updatedCopy = () => f.user.position; },
    f => { f.user.position.updatedCopy = (x, y) => { f.game.wsConnected = false; return new f.Position(x, y); }; },
    f => { f.user.position.updatedCopy = (x, y) => { f.page.gatherDev.Repos.avConnections.stronglyConnectedSpaceUserIds = ['other']; return new f.Position(x, y); }; }]) {
    const f = fixture(); change(f); assert.equal(typeof coordinateAction(f.page, f.spec, true), 'string'); assert.equal(f.calls.length, 0);
  }
});
test('confirmed phone movement records a destination check without enabling automation', async () => {
  const { config, spec, adapter } = fixture();
  const c = { config, adapter, snapshotAt: Date.now(), snapshot: { connected: true, ...observed.location.scope, location: 'desk', canMove: true, movementCapabilities: { brief: true } },
    engine: { manualMovement() {} }, testedDestinations: new Set() };
  assert.equal(moveIssue(c, 'brief', Date.now()), null);
  const dashboard = new MobileDashboard(c);
  dashboard.accept({ id: randomUUID(), session: dashboard.session, destination: 'brief', createdAt: Date.now() });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dashboard.result.status, 'complete'); assert.equal(c.testedDestinations.has(spec.destination), true);
  assert.equal(config.movementVerified, false);
});
test('no-op phone requests do not count as a successful movement trial', async () => {
  const { config, spec, adapter, user, Position } = fixture(); user.position = new Position(37, 59);
  const c = { config, adapter, snapshotAt: Date.now(), snapshot: { connected: true, ...observed.location.scope, location: spec.destination, canMove: true, movementCapabilities: { brief: true } },
    engine: { manualMovement() {} }, testedDestinations: new Set() };
  const dashboard = new MobileDashboard(c);
  dashboard.accept({ id: randomUUID(), session: dashboard.session, destination: 'brief', createdAt: Date.now() });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dashboard.result.status, 'complete'); assert.equal(c.testedDestinations.size, 0);
});

test('adapter exposes per-destination readiness without moving and closes it during conversations', async () => {
  const { adapter, page, calls } = fixture();
  page.gatherDev.Repos.localMediaSelfInfo = { ownAudioEnabled: false, ownVideoEnabled: false };
  adapter.evaluate = async () => ({ connected: false, errors: [], mic: false, camera: false });
  let snapshot = await adapter.snapshot();
  assert.equal(snapshot.movementCapabilities.brief, true); assert.equal(snapshot.movementCapabilities.away, true);
  assert.equal(snapshot.canMove, true); assert.equal(calls.length, 0);
  page.gatherDev.Repos.avConnections.stronglyConnectedSpaceUserIds = ['00000000-0000-4000-8000-000000000001'];
  snapshot = await adapter.snapshot();
  assert.equal(snapshot.movementCapabilities.brief, false); assert.equal(snapshot.movementCapabilities.away, false);
  assert.match(snapshot.movementIssues.brief, /outside a conversation/); assert.equal(calls.length, 0);
});

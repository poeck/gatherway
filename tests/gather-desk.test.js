const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { inspectGatherDesk } = require('../desktop/gather-desk');
const { GatherAdapter } = require('../desktop/adapter');
const { Engine } = require('../desktop/engine');
const { parseHTML } = require('linkedom');
const observedProfile = require('../desktop/profiles/otark-paul-observed.json');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const spaceId = id(1), selfId = id(2), deskId = id(3), visitorId = id(4);

function fixture() {
  const area = { stableId_USE_THIS_INSTEAD_OF_ID: deskId };
  const self = { id: selfId, currentMapArea: area };
  const visitor = { id: visitorId, currentMapArea: area };
  const desk = { ...area, deskOwner: { id: selfId }, mapOrUndefined: {}, isFullyAVConnected: true, spaceUsers: [self] };
  const user = { ...self, deskId, desk, isAtOwnDesk: true };
  const game = { wsConnected: true, currentSpaceOrUndefined: { id: spaceId }, currentSpaceUserOrUndefined: user };
  const page = { gatherDev: { Repos: { gameSpace: game } } };
  return { area, self, visitor, desk, user, game, page, read: () => inspectGatherDesk(page) };
}

test('observed alone, visitor and visitor-remaining shapes distinguish desk occupancy from self', () => {
  const f = fixture();
  assert.deepEqual(f.read().otherOccupantIds, []);
  f.desk.spaceUsers.push(f.visitor);
  assert.deepEqual(f.read().otherOccupantIds, [visitorId]);
  f.user.isAtOwnDesk = false; f.desk.spaceUsers = [f.visitor];
  const result = f.read();
  assert.equal(result.atOwnDesk, false); assert.deepEqual(result.occupantIds, [visitorId]);
  assert.deepEqual(result.otherOccupantIds, [visitorId]);
});

test('a valid empty desk while the user is away remains distinct from unknown occupancy', () => {
  const f = fixture(); f.user.isAtOwnDesk = false; f.desk.spaceUsers = [];
  assert.deepEqual(f.read().otherOccupantIds, []);
  for (const list of [undefined, null, {}, [null], [{ id: 'invalid', currentMapArea: f.area }], [f.visitor, f.visitor]]) {
    f.desk.spaceUsers = list;
    assert.equal(f.read().otherOccupantIds, null);
  }
});

test('unavailable spaceUserIds does not erase the observed spaceUsers roster', () => {
  const f = fixture();
  Object.defineProperty(f.desk, 'spaceUserIds', { get() { throw new Error('Unsupported collection'); } });
  assert.deepEqual(f.read().occupantIds, [selfId]);
});

test('nearby or contradictory area membership cannot become desk occupancy', () => {
  const f = fixture(); f.desk.spaceUsers.push({ ...f.visitor, currentMapArea: { stableId_USE_THIS_INSTEAD_OF_ID: id(9) } });
  assert.equal(f.read().otherOccupantIds, null);
  f.desk.spaceUsers = []; assert.equal(f.read().otherOccupantIds, null);
  f.user.isAtOwnDesk = false; f.desk.spaceUsers = [f.self]; assert.equal(f.read().otherOccupantIds, null);
});

test('missing map, wrong desk, changed ownership and disconnection are unknown', () => {
  for (const change of [
    f => { f.desk.mapOrUndefined = null; },
    f => { f.user.deskId = id(9); },
    f => { f.desk.deskOwner.id = id(9); },
    f => { f.desk.isFullyAVConnected = false; },
    f => { f.game.wsConnected = false; },
    f => { f.user.desk = undefined; },
    f => { Object.defineProperty(f.desk, 'spaceUsers', { get() { throw new Error('unavailable'); } }); },
  ]) {
    const f = fixture(); change(f); const result = f.read();
    assert.equal(result.connected, false); assert.equal(result.otherOccupantIds, null);
  }
});

test('identity changes during a read discard the result', () => {
  const f = fixture();
  Object.defineProperty(f.desk, 'spaceUsers', { get() { f.game.currentSpaceOrUndefined.id = id(9); return [f.self]; } });
  assert.equal(f.read().otherOccupantIds, null);
});

test('serialized reader works in the page world and adapter refuses other origins', async () => {
  const f = fixture(), context = vm.createContext(f.page);
  let url = 'https://app.v2.gather.town/office';
  const adapter = new GatherAdapter({ isDestroyed: () => false, webContents: {
    getURL: () => url, executeJavaScript: async code => vm.runInContext(code, context),
  } }, {});
  assert.equal((await adapter.readDesk()).deskId, deskId);
  url = 'https://example.com';
  await assert.rejects(adapter.readDesk(), /not available/);
});

test('desk integration remains diagnostic without supplying policy visitors', async () => {
  const f = fixture(); f.desk.spaceUsers.push(f.visitor);
  const adapter = new GatherAdapter(null, {});
  adapter.evaluate = async () => ({ connected: false, participants: null, deskVisitors: null, errors: ['No verified Gather profile'] });
  adapter.readWaves = async () => ({}); adapter.readSession = async () => ({}); adapter.readLocation = async () => ({});
  adapter.readDesk = async () => f.read();
  const result = await adapter.snapshot();
  assert.deepEqual(result.deskIntegration.otherOccupantIds, [visitorId]);
  assert.equal(result.deskVisitors, null); assert.equal(result.participants, null); assert.equal(result.connected, false);
  adapter.readDesk = async () => { adapter.invalidate(); return f.read(); };
  await assert.rejects(adapter.snapshot(), /session changed/);
});

function wiredFixture() {
  const f = fixture(); f.user.isAtOwnDesk = false; f.desk.spaceUsers = [];
  const profile = { ...observedProfile, deskVisitors: { source: 'gather-desk', scope: { spaceId, selfId }, deskId } };
  const config = { profile, spaceId, selfId, movementVerified: false };
  const document = parseHTML(`<button data-testid="${profile.mic.off}"></button><button data-testid="${profile.camera.off}"></button>`).document;
  const adapter = new GatherAdapter(null, config);
  adapter.evaluate = async (fn, ...args) => fn(document, ...args);
  adapter.readSession = async () => ({ connected: true, spaceId, selfId, participants: [], mic: false, camera: false });
  adapter.readWaves = async () => ({ spaceId, selfId, waves: [], baseline: false });
  adapter.readLocation = async () => ({ connected: true, spaceId, selfId, floorId: id(5), position: { x: 37, y: 59 } });
  adapter.readDesk = async () => f.read();
  return { ...f, profile, config, adapter };
}

test('verified empty-visit-empty cycle feeds policy without creating a self conversation', async () => {
  const f = wiredFixture(), engine = new Engine(f.config);
  const empty = await f.adapter.snapshot();
  assert.deepEqual(empty.errors, []); assert.deepEqual(empty.deskVisitors, []);
  assert.deepEqual(engine.update(empty, 'brief', 1000), []);
  f.desk.spaceUsers = [f.visitor];
  const visit = await f.adapter.snapshot();
  assert.deepEqual(visit.participants, []); assert.deepEqual(visit.deskVisitors, [visitorId]);
  const effects = engine.update(visit, 'brief', 2000);
  assert.equal(effects.length, 1); assert.equal(effects[0].type, 'alert'); assert.equal(effects[0].mode, 'ring');
  assert.deepEqual(engine.update(await f.adapter.snapshot(), 'brief', 3000), []);
  f.desk.spaceUsers = [];
  const canceled = engine.update(await f.adapter.snapshot(), 'brief', 4000);
  assert.equal(canceled[0].id, effects[0].id); assert.equal(canceled[0].reason, 'visitor-left');
});

test('desk source must match configured identity, observed scope and verified desk ID', async () => {
  for (const change of [
    f => { f.profile.deskVisitors.deskId = id(9); },
    f => { f.profile.deskVisitors.scope.spaceId = id(9); },
    f => { f.profile.deskVisitors.scope.selfId = id(9); },
    f => { f.config.selfId = id(9); },
    f => { f.desk.mapOrUndefined = null; },
  ]) {
    const f = wiredFixture(); change(f); const snapshot = await f.adapter.snapshot();
    assert.equal(snapshot.deskVisitors, null); assert.ok(snapshot.errors.includes('deskVisitors unavailable'));
  }
});

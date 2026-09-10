const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { inspectGatherLocation, describeGatherLocation } = require('../desktop/gather-location');
const { GatherAdapter } = require('../desktop/adapter');
const { inspectGather } = require('../desktop/adapter-dom');
const { parseHTML } = require('linkedom');
const observed = require('../desktop/profiles/otark-paul-observed.json');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const expected = { spaceId: id(1), selfId: id(2) }, floorId = id(3);
const spec = { source: 'gather-repos', scope: expected, targets: {
  available: { floorId, x: 37, y: 61 }, brief: { floorId, x: 37, y: 59 }, away: { floorId, x: 27, y: 51 },
} };
function fixture() {
  const game = { wsConnected: true, currentSpaceOrUndefined: { id: expected.spaceId }, currentSpaceUserOrUndefined: { id: expected.selfId, floorId, position: { x: 37, y: 61 } } };
  const page = { gatherDev: { Repos: { gameSpace: game } } };
  const user = game.currentSpaceUserOrUndefined;
  return { game, user, page, read: () => describeGatherLocation(inspectGatherLocation(page), spec) };
}

test('observed desk, brief absence, break room and return resolve to distinct destinations', () => {
  const { user, read } = fixture();
  let desk;
  for (const key of ['available', 'brief', 'away', 'available']) {
    const { x, y } = spec.targets[key]; user.position = { x, y };
    const result = read();
    assert.equal(result.matchedDestination, key); assert.equal(result.connected, true);
    if (key === 'available') { desk ??= result.locationId; assert.equal(result.locationId, desk); }
  }
});

test('unsaved and fractional coordinates stay exact and cannot match a saved target', () => {
  const { user, read } = fixture(); const desk = read().locationId;
  user.position.y = 60.9;
  const result = read(); assert.equal(result.matchedDestination, null);
  assert.equal(result.position.y, 60.9); assert.notEqual(result.locationId, desk);
});

test('same coordinates on another floor, space or identity do not match these targets', () => {
  for (const change of [
    ({ user }) => { user.floorId = id(9); },
    ({ game }) => { game.currentSpaceOrUndefined.id = id(9); },
    ({ user }) => { user.id = id(9); },
  ]) {
    const f = fixture(); change(f); assert.equal(f.read().matchedDestination, null);
  }
});

test('missing, malformed, disconnected or throwing location fields remain unknown', () => {
  for (const change of [
    ({ game }) => { game.wsConnected = false; },
    ({ user }) => { user.floorId = 'invalid'; },
    ({ user }) => { user.position = null; },
    ({ user }) => { user.position.x = Infinity; },
    ({ user }) => { user.position.y = '61'; },
    ({ user }) => { Object.defineProperty(user, 'position', { get() { throw new Error('unavailable'); } }); },
  ]) {
    const f = fixture(); change(f); const result = f.read();
    assert.equal(result.connected, false); assert.equal(result.position, null); assert.equal(result.locationId, null);
  }
});

test('duplicate saved targets are ambiguous rather than choosing one', () => {
  const { page } = fixture();
  const duplicate = { ...spec, targets: { ...spec.targets, brief: spec.targets.available } };
  assert.equal(describeGatherLocation(inspectGatherLocation(page), duplicate).matchedDestination, null);
});

test('serialized reader handles identity changes during a read', () => {
  const { page, user, game } = fixture();
  const context = vm.createContext(page);
  assert.equal(vm.runInContext(`(${inspectGatherLocation.toString()})(globalThis)`, context).connected, true);
  Object.defineProperty(user, 'position', { get() { game.currentSpaceOrUndefined.id = id(9); return { x: 37, y: 61 }; } });
  assert.equal(inspectGatherLocation(page).connected, false);
});

test('structured adapter exposes diagnostics but requires explicit selection and matching identity for policy', async () => {
  const { page } = fixture();
  const profile = { ...observed, location: spec };
  const document = parseHTML(`<button data-testid="${observed.mic.off}"></button><button data-testid="${observed.camera.off}"></button>`).document;
  const adapter = new GatherAdapter(null, { ...expected, profile: null });
  adapter.evaluate = async (fn, ...args) => fn(document, ...args);
  adapter.readSession = async () => ({ connected: true, ...expected, participants: [], mic: false, camera: false });
  adapter.readWaves = async () => ({ ...expected, waves: [], baseline: false });
  adapter.readLocation = async () => inspectGatherLocation(page);
  let result = await adapter.snapshot();
  assert.equal(result.location, null); assert.equal(result.locationIntegration.position.x, 37);
  adapter.config.profile = profile;
  result = await adapter.snapshot();
  assert.equal(result.connected, true); assert.equal(result.location, result.locationIntegration.locationId);
  assert.equal(result.locationIntegration.matchedDestination, 'available');
  assert.equal(result.matchedDestination, 'available');
  assert.equal(result.canMove, false); assert.equal(result.deskVisitors, null);
  assert.ok(result.errors.includes('deskVisitors unavailable'));
  adapter.config.spaceId = id(9);
  result = await adapter.snapshot();
  assert.equal(result.location, null); assert.equal(result.matchedDestination, null);
  adapter.config.spaceId = expected.spaceId;
  adapter.config.profile = { ...profile, location: { ...spec, scope: { ...expected, selfId: id(9) } } };
  assert.equal((await adapter.snapshot()).matchedDestination, null);
  assert.equal(inspectGather(document, profile, expected).canMove, false);
});

test('disconnect while awaiting location invalidates the snapshot', async () => {
  const adapter = new GatherAdapter(null, { profile: null });
  adapter.evaluate = async () => ({ errors: [] }); adapter.readWaves = async () => ({}); adapter.readSession = async () => ({});
  adapter.readLocation = async () => { adapter.invalidate(); return inspectGatherLocation(fixture().page); };
  await assert.rejects(adapter.snapshot(), /session changed/);
});

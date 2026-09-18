const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../desktop/engine');
const config = { spaceId: 'office', selfId: 'me', movementVerified: true, locations: { available: 'desk', brief: 'near-desk', away: 'break' } };
const state = (extra = {}) => ({ connected: true, spaceId: 'office', selfId: 'me', location: 'desk', participants: [], deskVisitors: [], waves: [], mic: false, camera: false, canMove: true, ...extra });
const select = (effects, type) => effects.filter(effect => effect.type === type);

test('initial/reconnected participants and waves establish a baseline', () => {
  const engine = new Engine(config);
  const snapshot = state({ participants: ['alice'], waves: [{ id: 'old', fromId: 'alice' }] });
  assert.deepEqual(engine.update(snapshot, 'available', 1000), []);
  assert.deepEqual(engine.update(snapshot, 'available', 2000), []);
  engine.cancelAll(); assert.deepEqual(engine.update(snapshot, 'available', 3000), []);
});
test('first visitor rings once; subsequent arrivals and waves are suppressed', () => {
  const engine = new Engine(config); engine.update(state(), 'available', 1000);
  const first = engine.update(state({ participants: ['alice'], deskVisitors: ['alice'] }), 'available', 2000);
  assert.equal(select(first, 'alert').length, 1); assert.equal(first[0].mode, 'ring');
  const next = engine.update(state({ participants: ['alice', 'bob'], deskVisitors: ['alice', 'bob'], waves: [{ id: 'wave', fromId: 'carol' }] }), 'available', 3000);
  assert.equal(select(next, 'alert').length, 0);
});
test('observed desk alerts work before movement destinations are captured', () => {
  for (const firstField of ['deskVisitors', 'participants']) {
    const engine = new Engine({ ...config, movementVerified: false, locations: {} });
    const desk = state({ matchedDestination: 'available' });
    engine.update(desk, 'available', 1000);
    const [event] = select(engine.update({ ...desk, [firstField]: ['alice'] }, 'available', 2000), 'alert');
    assert.equal(event?.mode, 'ring');
    const conversation = { ...desk, participants: ['alice'], deskVisitors: ['alice'] };
    assert.deepEqual(engine.update(conversation, 'available', 3000), []);
    assert.deepEqual(engine.update({ ...conversation, waves: [{ id: 'wave', fromId: 'bob', createdAt: 3500 }] }, 'available', 4000), []);
    assert.deepEqual(select(engine.update(desk, 'available', 5000), 'cancel'), [{ type: 'cancel', id: event.id, reason: 'visitor-left' }]);
    assert.equal(select(engine.update(desk, 'brief', 6000), 'move').length, 0);
  }
});
test('observed break room rules work without captured movement destinations', () => {
  const engine = new Engine({ ...config, movementVerified: false, locations: {} });
  const room = state({ location: 'break', matchedDestination: 'away' });
  engine.update(room, 'available', 1000);
  assert.equal(select(engine.update({ ...room, participants: ['alice'] }, 'available', 2000), 'alert').length, 0);
  const effects = engine.update({ ...room, participants: ['alice'], waves: [{ id: 'wave', fromId: 'bob', createdAt: 2500 }] }, 'available', 3000);
  assert.equal(select(effects, 'alert')[0]?.mode, 'notification');
  assert.equal(select(engine.update(room, 'available', 301000), 'reminder').length, 1);
});
test('unknown positions and stale profile targets cannot override a captured desk', () => {
  for (const [locations, location, matchedDestination] of [
    [{}, null, 'available'], [{}, 'meeting', null],
    [{ available: 'new-desk' }, 'old-desk', 'available'],
  ]) {
    const engine = new Engine({ ...config, locations });
    const snapshot = state({ location, matchedDestination });
    engine.update(snapshot, 'available', 1000);
    assert.equal(select(engine.update({ ...snapshot, participants: ['alice'] }, 'available', 2000), 'alert').length, 0);
  }
});
test('brief absence still monitors desk and avatar visits', () => {
  for (const field of ['deskVisitors', 'participants']) {
    const engine = new Engine(config); engine.update(state({ location: 'near-desk' }), 'brief', 1000);
    const result = engine.update(state({ location: 'near-desk', [field]: ['alice'] }), 'brief', 2000);
    assert.equal(select(result, 'alert')[0].mode, 'ring');
  }
});
test('break room allows normal waves but ignores visits and ambient conversations', () => {
  const engine = new Engine(config); engine.update(state({ location: 'break', participants: ['alice'] }), 'away', 1000);
  const result = engine.update(state({ location: 'break', participants: ['alice', 'bob'], waves: [{ id: 'wave', fromId: 'carol' }] }), 'away', 2000);
  assert.equal(select(result, 'alert').length, 1); assert.equal(select(result, 'alert')[0].mode, 'notification');
});
test('visitor departure, expiry and explicit interactions cancel ringing', () => {
  for (const method of ['leave', 'expire', 'interact', 'acknowledge']) {
    const engine = new Engine(config); engine.update(state(), 'available', 1000);
    const [event] = engine.update(state({ participants: ['alice'] }), 'available', 2000);
    const result = method === 'leave' ? engine.update(state(), 'available', 3000) : method === 'expire' ? engine.update(state({ participants: ['alice'] }), 'available', 47000) : method === 'interact' ? engine.interact(3000) : engine.acknowledge(event.id);
    assert.equal(select(result, 'cancel')[0].id, event.id);
  }
});
test('unknown presence does not move and waves are non-ringing', () => {
  const engine = new Engine(config); engine.update(state(), 'unknown', 1000);
  const effects = engine.update(state({ waves: [{ id: 'a', fromId: 'alice' }] }), 'unknown', 2000);
  assert.equal(select(effects, 'move').length, 0); assert.equal(select(effects, 'alert')[0].mode, 'notification');
});
test('automatic ownership supports desk → brief → break → desk', () => {
  const engine = new Engine(config); engine.update(state(), 'available', 1000);
  assert.equal(select(engine.update(state(), 'brief', 2000), 'move')[0].destination, 'near-desk');
  engine.movementResult(true);
  assert.equal(select(engine.update(state({ location: 'near-desk' }), 'away', 3000), 'move')[0].destination, 'break');
  engine.movementResult(true);
  assert.equal(select(engine.update(state({ location: 'break', participants: ['alice'] }), 'available', 4000), 'move')[0].destination, 'desk');
});
test('manual locations and established conversations prevent automatic movement', () => {
  for (const extra of [{ location: 'meeting' }, { participants: ['alice'] }, { participants: null }]) {
    const engine = new Engine(config); engine.update(state(extra), 'available', 1000);
    assert.equal(select(engine.update(state(extra), 'away', 2000), 'move').length, 0);
  }
});
test('a failed move cannot loop retries', () => {
  const engine = new Engine(config); engine.update(state(), 'available', 1000);
  engine.update(state(), 'brief', 2000); engine.movementResult(false);
  assert.equal(select(engine.update(state(), 'brief', 3000), 'move').length, 0);
});
test('manual break reminder requires five continuous minutes and fires once', () => {
  const engine = new Engine(config); const snapshot = state({ location: 'break', participants: ['alice'] });
  engine.update(snapshot, 'available', 1000);
  assert.equal(select(engine.update(snapshot, 'available', 300999), 'reminder').length, 0);
  assert.equal(select(engine.update(snapshot, 'available', 301000), 'reminder').length, 1);
  assert.equal(select(engine.update(snapshot, 'available', 601000), 'reminder').length, 0);
  engine.update(snapshot, 'unknown', 602000); engine.update(snapshot, 'available', 603000);
  assert.equal(select(engine.update(snapshot, 'available', 903000), 'reminder').length, 1);
});
test('media disable waits ten seconds and resets for participants or unknown state', () => {
  const engine = new Engine(config); const live = state({ mic: true, camera: true });
  engine.update(live, 'available', 1000);
  assert.equal(select(engine.update(live, 'available', 10999), 'disable-media').length, 0);
  assert.deepEqual(select(engine.update(live, 'available', 11000), 'disable-media')[0], { type: 'disable-media', mic: true, camera: true });
  engine.update(state({ ...live, participants: ['alice'] }), 'available', 12000);
  engine.update(live, 'available', 13000);
  assert.equal(select(engine.update(live, 'available', 22000), 'disable-media').length, 0);
  engine.update(state({ ...live, participants: null }), 'available', 23000);
  assert.equal(select(engine.update(live, 'available', 24000), 'disable-media').length, 0);
});
test('disconnect and manual pause cancel pending alerts and reset baselines', () => {
  const engine = new Engine(config); engine.update(state(), 'available', 1000);
  engine.update(state({ waves: [{ id: 'a', fromId: 'alice' }] }), 'available', 2000);
  assert.equal(select(engine.update(state(), 'available', 3000, false), 'cancel').length, 1);
  assert.equal(select(engine.update(state({ participants: ['alice'] }), 'available', 4000), 'alert').length, 0);
});
test('recovering an unavailable wave feed does not replay old waves', () => {
  const engine = new Engine(config); engine.update(state({ waves: null }), 'available', 1000);
  assert.equal(select(engine.update(state({ waves: [{ id: 'old', fromId: 'alice' }] }), 'available', 2000), 'alert').length, 0);
});
test('avatar visitor detection works independently of an unavailable desk feed', () => {
  const engine = new Engine(config); engine.update(state({ deskVisitors: null }), 'available', 1000);
  assert.equal(select(engine.update(state({ deskVisitors: null, participants: ['alice'] }), 'available', 2000), 'alert').length, 1);
});

test('wave alerts retain the original event deadline across delayed polling', () => {
  const engine = new Engine(config); engine.update(state(), 'available', 1000);
  const waves = [{ id: 'timed-wave', fromId: 'alice', createdAt: 2000 }];
  const [event] = select(engine.update(state({ waves }), 'available', 12000), 'alert');
  assert.equal(event.createdAt, 2000); assert.equal(event.expiresAt, 47000);
  engine.acknowledge(event.id);
  assert.equal(select(engine.update(state({ waves }), 'available', 13000), 'alert').length, 0);
});
test('expired and future wave timestamps cannot start alerts', () => {
  for (const createdAt of [2000, 48001, NaN, null]) {
    const engine = new Engine(config); engine.update(state(), 'available', 1000);
    const waves = [{ id: 'invalid-time', fromId: 'alice', createdAt }];
    assert.equal(select(engine.update(state({ waves }), 'available', 48000), 'alert').length, 0);
  }
});
test('genuine input after a wave but before its polling result acknowledges it', () => {
  const engine = new Engine(config); engine.update(state(), 'available', 1000);
  engine.interact(2500);
  const waves = [{ id: 'delayed', fromId: 'alice', createdAt: 2000 }];
  assert.equal(select(engine.update(state({ waves }), 'available', 3000), 'alert').length, 0);
  waves.push({ id: 'newer', fromId: 'alice', createdAt: 3500 });
  assert.equal(select(engine.update(state({ waves }), 'available', 4000), 'alert').length, 1);
});

test('an ongoing visit does not ring twice when desk and avatar feeds update separately', () => {
  for (const firstField of ['deskVisitors', 'participants']) {
    const engine = new Engine(config); engine.update(state({ location: 'near-desk' }), 'brief', 1000);
    const first = state({ location: 'near-desk', [firstField]: ['alice'] });
    const [event] = select(engine.update(first, 'brief', 2000), 'alert');
    assert.ok(event);
    engine.acknowledge(event.id);
    const both = state({ location: 'near-desk', deskVisitors: ['alice'], participants: ['alice'] });
    assert.equal(select(engine.update(both, 'brief', 3000), 'alert').length, 0);
  }
});

test('an alert follows a continuing visit across desk and avatar feeds until confirmed departure', () => {
  const engine = new Engine(config); engine.update(state(), 'available', 1000);
  const [event] = select(engine.update(state({ participants: ['alice'], deskVisitors: ['alice'] }), 'available', 2000), 'alert');
  assert.deepEqual(engine.update(state({ location: 'near-desk', deskVisitors: ['alice'] }), 'brief', 3000), []);
  assert.deepEqual(engine.update(state({ location: 'near-desk', deskVisitors: null }), 'brief', 4000), []);
  assert.deepEqual(engine.update(state({ location: 'near-desk', deskVisitors: ['alice'] }), 'brief', 5000), []);
  const canceled = select(engine.update(state({ location: 'near-desk' }), 'brief', 6000), 'cancel');
  assert.equal(canceled[0].id, event.id); assert.equal(canceled[0].reason, 'visitor-left');
});

test('reconnect and desk-feed recovery baseline existing desk visitors without ringing', () => {
  const engine = new Engine(config);
  const visit = state({ location: 'near-desk', deskVisitors: ['alice'] });
  assert.deepEqual(engine.update(visit, 'brief', 1000), []);
  engine.cancelAll(); assert.deepEqual(engine.update(visit, 'brief', 2000), []);
  engine.update(state({ location: 'near-desk', deskVisitors: null }), 'brief', 3000);
  assert.deepEqual(engine.update(visit, 'brief', 4000), []);
});

test('manual phone navigation blocks competing automatic moves but keeps media safety active', () => {
  const engine = new Engine(config);
  const live = state({ mic: true, camera: true });
  engine.update(live, 'brief', 1000, true, false);
  const effects = engine.update(live, 'brief', 11000, true, false);
  assert.equal(select(effects, 'move').length, 0);
  assert.equal(select(effects, 'disable-media').length, 1);
});

test('a desk-only capability cannot trigger automatic movement to another destination', () => {
  const engine = new Engine(config);
  const s = state({ movementCapabilities: { available: true, brief: false, away: false } });
  engine.update(s, 'brief', 1000);
  assert.equal(select(engine.update(s, 'brief', 2000), 'move').length, 0);
});

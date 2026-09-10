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

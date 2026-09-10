const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { observeGatherWaves } = require('../desktop/gather-waves');

const spaceId = '11111111-1111-4111-8111-111111111111';
const selfId = '22222222-2222-4222-8222-222222222222';
const senderId = '33333333-3333-4333-8333-333333333333';
function bus() {
  const listeners = new Map();
  return {
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },
    emit(name, value) { for (const fn of [...(listeners.get(name) || [])]) fn(value); },
    count() { return [...listeners.values()].reduce((n, set) => n + set.size, 0); },
  };
}
function fixture() {
  let now = 1789036168000, timerId = 0;
  const timers = new Map(), events = bus(), wsEvents = bus();
  const gameSpace = { wsConnected: true, currentSpaceOrUndefined: { id: spaceId }, currentSpaceUserOrUndefined: { id: selfId }, events, wsEvents };
  const page = { gatherDev: { Repos: { gameSpace } } };
  const context = vm.createContext({ page, Date: { now: () => now }, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) });
  return {
    gameSpace, events, wsEvents, timers,
    read(token = 'one', command = 'read') { return JSON.parse(JSON.stringify(vm.runInContext(`(${observeGatherWaves.toString()})(page, ${JSON.stringify(token)}, ${JSON.stringify(command)})`, context))); },
    advance(ms) { now += ms; },
    wave(time = now, sender = senderId) { events.emit('WaveEvent', { senderId: sender, sentTime: { toMillis: () => time }, unrelatedContent: 'must not leave the page' }); },
    get now() { return now; },
  };
}

test('real probe timing shape yields two unique events and deduplicates repeat delivery', () => {
  const f = fixture(); assert.equal(f.read().baseline, true);
  f.advance(424); f.wave(1789036168336); f.wave(1789036168336);
  const first = f.read(); assert.equal(first.waves.length, 1);
  assert.deepEqual(Object.keys(first.waves[0]).sort(), ['createdAt', 'fromId', 'id']);
  f.advance(3000); f.read(); f.advance(2195); f.wave(1789036173557);
  const second = f.read(); assert.equal(second.waves.length, 2);
  assert.notEqual(second.waves[0].id, second.waves[1].id);
  assert.equal(second.waves[1].createdAt - second.waves[0].createdAt, 5221);
  assert.equal(f.events.count(), 1); assert.equal(f.wsEvents.count(), 3); assert.equal(f.timers.size, 1);
});
test('pre-subscription, invalid, future, self and expired waves are ignored', () => {
  const f = fixture(); f.read(); const start = f.now;
  f.advance(100); f.wave(start); f.wave(f.now + 1); f.wave(NaN); f.wave(f.now, selfId); f.wave(f.now, 'unknown');
  for (let i = 0; i < 46; i++) { f.advance(1000); f.read(); }
  f.wave(start + 1); assert.deepEqual(f.read().waves, []);
});
test('expiry is based on event time and polling never extends retention', () => {
  const f = fixture(); f.read(); f.advance(100); const sent = f.now; f.wave(sent);
  for (let i = 0; i < 44; i++) { f.advance(1000); assert.equal(f.read().waves.length, 1); }
  f.advance(1000); assert.deepEqual(f.read().waves, []);
  f.wave(sent); assert.deepEqual(f.read().waves, []);
});
test('disconnect disposes listeners and reconnect discards old events', () => {
  for (const name of ['connecting', 'close', 'disconnect']) {
    const f = fixture(); f.read(); f.advance(100); const oldTime = f.now; f.wave();
    f.wsEvents.emit(name); assert.equal(f.events.count(), 0); assert.equal(f.wsEvents.count(), 0); assert.equal(f.timers.size, 0);
    f.advance(100); assert.equal(f.read().baseline, true); f.wave(oldTime); assert.deepEqual(f.read().waves, []);
  }
});
test('identity changes and event-bus replacement require a new baseline', () => {
  const f = fixture(); f.read(); f.advance(100); f.wave();
  f.gameSpace.currentSpaceUserOrUndefined = { id: '44444444-4444-4444-8444-444444444444' };
  const newIdentity = f.read(); assert.equal(newIdentity.baseline, true); assert.deepEqual(newIdentity.waves, []);
  const replacement = bus(); f.gameSpace.events = replacement;
  assert.equal(f.read().baseline, true); assert.equal(f.events.count(), 0); assert.equal(replacement.count(), 1);
});
test('unavailable scope stops listening and never means an empty healthy feed', () => {
  const f = fixture(); f.read(); f.gameSpace.wsConnected = false;
  assert.equal(f.read().waves, null); assert.equal(f.events.count(), 0);
  f.gameSpace.wsConnected = true; f.gameSpace.currentSpaceOrUndefined = undefined;
  assert.equal(f.read().waves, null);
});
test('polling lease and scoped cleanup cannot retain stale or remove newer listeners', () => {
  const f = fixture(); f.read('old'); f.read('new'); f.read('old', 'stop');
  assert.equal(f.events.count(), 1);
  f.advance(5000); f.wave(); assert.equal(f.events.count(), 0);
  f.read('new'); for (const timer of [...f.timers.values()]) timer();
  assert.equal(f.events.count(), 0); assert.equal(f.wsEvents.count(), 0);
});
test('bounded buffer refuses overflow and retains duplicate identities', () => {
  const f = fixture(); f.read();
  for (let i = 0; i < 140; i++) { f.advance(1); f.wave(); }
  assert.equal(f.read().waves.length, 128);
});

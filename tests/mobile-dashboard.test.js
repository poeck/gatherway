const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { MobileDashboard, position, moveIssue } = require('../desktop/mobile-dashboard');
const { Presence } = require('../desktop/presence');
function setup() {
  const now = 100000;
  const c = {
    config: { spaceId: 'space', selfId: 'self', adapterVerified: true, locations: { available: 'desk', brief: 'brief', away: 'break' }, presence: { calibrated: true } },
    snapshot: { connected: true, spaceId: 'space', selfId: 'self', location: 'desk', participants: [], canMove: true }, snapshotAt: now,
    phone: { receivedAt: now, serviceRunning: true, bluetooth: true, wifi: 'home' },
    ble: { healthy: true, status: 'Scanning' }, presence: new Presence({ calibrated: true }), availability: 'available',
    engine: { manualMovement() { this.manualCalls = (this.manualCalls || 0) + 1; } },
    adapter: { pending: false, async move(target) { this.calls = (this.calls || []).concat(target); return true; } },
    testedDestinations: new Set(['desk', 'brief', 'break']),
  };
  const dashboard = new MobileDashboard(c);
  const request = destination => ({ id: randomUUID(), session: dashboard.session, destination, createdAt: now });
  return { c, dashboard, now, request };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('dashboard separates avatar position, inferred presence and conversation count', () => {
  const { c, dashboard, now } = setup(); c.availability = 'brief'; c.snapshot.participants = ['other'];
  const state = dashboard.state(now);
  assert.equal(state.position, 'available'); assert.equal(state.availability, 'brief'); assert.equal(state.participants, 1);
  assert.equal(state.rssi, null); assert.equal(state.medianRssi, null);
  assert.equal(JSON.stringify(state).includes('other'), false);
  c.snapshot.location = 'unmapped'; assert.equal(position(c, now), 'elsewhere');
  c.snapshot.location = null; assert.equal(position(c, now), 'unknown');
});

test('stale, disconnected and mismatched Gather observations do not claim current position', () => {
  const { c, now } = setup();
  assert.equal(position(c, now + 5000), 'unknown');
  c.snapshot.selfId = 'wrong'; assert.equal(position(c, now), 'unknown');
  c.snapshot.selfId = 'self'; c.snapshot.connected = false; assert.equal(position(c, now), 'unknown');
});

test('observed profile destinations work before navigation is configured', () => {
  const { c, now } = setup(); c.config.locations = {}; c.snapshot.matchedDestination = 'away';
  assert.equal(position(c, now), 'away');
  c.config.locations.away = 'different'; assert.equal(position(c, now), 'elsewhere');
});

test('movement is gated independently from automatic presence calibration', () => {
  const { c, now } = setup();
  c.config.presence.calibrated = false;
  assert.equal(moveIssue(c, 'available', now), null);
  c.snapshot.canMove = false; assert.match(moveIssue(c, 'available', now), /not been verified/);
  c.snapshot.canMove = true; c.testedDestinations.clear(); assert.match(moveIssue(c, 'available', now), /Capture and test/);
  c.config.paused = true; assert.match(moveIssue(c, 'available', now), /Resume/);
});

test('manual requests execute once and report confirmed arrival', async () => {
  const { c, dashboard, now, request } = setup(); const command = request('away');
  dashboard.accept(command, now); dashboard.accept(command, now);
  assert.equal(dashboard.result.status, 'moving');
  await settle();
  dashboard.accept(command, now);
  assert.deepEqual(c.adapter.calls, ['break']); assert.equal(c.engine.manualCalls, 1);
  assert.equal(dashboard.result.status, 'complete');
});

test('pending navigation rejects a second request without starting another move', async () => {
  const { c, dashboard, now, request } = setup(); let finish;
  c.adapter.move = () => new Promise(resolve => { finish = resolve; });
  dashboard.accept(request('away'), now); await settle();
  dashboard.accept(request('brief'), now); assert.match(dashboard.result.message, /already in progress/);
  assert.equal(c.engine.manualCalls, 1); finish(true); await settle();
});

test('expired, future and old-session requests never move', async () => {
  const { c, dashboard, now, request } = setup();
  for (const changes of [{ createdAt: now - 15001 }, { createdAt: now + 2001 }, { session: randomUUID() }]) {
    dashboard.accept({ ...request('available'), ...changes }, now); assert.equal(dashboard.result.status, 'failed');
  }
  await settle(); assert.equal(c.adapter.calls, undefined);
});

test('disconnect before dispatch fences requests and discards old command state', async () => {
  const { c, dashboard, now, request } = setup();
  dashboard.accept(request('away'), now); dashboard.reset(); await settle();
  assert.equal(c.adapter.calls, undefined); assert.equal(dashboard.result, null);
});

test('navigation failure is visible rather than optimistic success', async () => {
  const { c, dashboard, now, request } = setup(); c.adapter.move = async () => false;
  dashboard.accept(request('away'), now); await settle(); assert.equal(dashboard.result.status, 'failed');
});

test('history records transitions once, retains 12 and resets for a new session', () => {
  const { c, dashboard, now } = setup(); dashboard.state(now); dashboard.state(now + 1);
  assert.equal(dashboard.history.length, 1);
  for (let i = 0; i < 30; i++) { c.availability = i % 2 ? 'available' : 'brief'; dashboard.observe(now + i); }
  assert.equal(dashboard.history.length, 12);
  const session = dashboard.session; dashboard.reset(); assert.notEqual(dashboard.session, session); assert.equal(dashboard.history.length, 0);
});

test('paused monitoring and stale sensors show unknown and identify the problem', () => {
  const { c, dashboard, now } = setup(); c.config.paused = true;
  assert.equal(dashboard.state(now).availability, 'unknown'); assert.match(dashboard.state(now).presenceIssue, /paused/);
  c.config.paused = false; c.phone.receivedAt = now - 11000;
  assert.equal(dashboard.state(now).availability, 'unknown'); assert.match(dashboard.state(now).presenceIssue, /fresh phone/);
  c.override = 'available'; assert.equal(dashboard.state(now).availability, 'available'); assert.equal(dashboard.state(now).override, 'available');
});

test('a full request ledger retains deduplication instead of evicting recent receipts', async () => {
  const { c, dashboard, now, request } = setup(); const first = request('away');
  dashboard.accept(first, now); await settle();
  for (let i = 0; i < 105; i++) dashboard.accept({ ...request('brief'), session: 'old-session' }, now);
  assert.equal(dashboard.receipts.size, 100);
  dashboard.accept(first, now); await settle();
  assert.deepEqual(c.adapter.calls, ['break']);
});

test('stale Gather polling is marked unknown in both live data and change history', () => {
  const { dashboard, now } = setup(); dashboard.state(now);
  const state = dashboard.state(now + 5000);
  assert.equal(state.availability, 'unknown'); assert.equal(state.history[0].availability, 'unknown');
  assert.match(state.presenceIssue, /fresh Gather/);
});

test('desk capability never enables another destination and reports context restrictions', () => {
  const { c, now } = setup(); c.snapshot.movementCapabilities = { available: true, brief: false, away: false };
  assert.equal(moveIssue(c, 'available', now), null); assert.match(moveIssue(c, 'brief', now), /not been verified/);
  c.snapshot.movementIssues = { available: 'Desk return is currently verified only outside a conversation' };
  assert.match(moveIssue(c, 'available', now), /outside a conversation/);
});

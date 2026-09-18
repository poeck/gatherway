const { randomUUID } = require('node:crypto');
const { sensorIssue, signalMedian } = require('./presence');
const { observedManualAction } = require('./gather-navigation');

const destinations = ['available', 'brief', 'away'];
function freshSnapshot(c, now) {
  return !!c.snapshot?.connected && c.snapshot.spaceId === c.config.spaceId && c.snapshot.selfId === c.config.selfId
    && Number.isFinite(c.snapshotAt) && now >= c.snapshotAt && now - c.snapshotAt < 5000 && !c.suspended;
}
function position(c, now) {
  if (!freshSnapshot(c, now) || !c.snapshot.location) return 'unknown';
  return destinations.find(key => c.config.locations?.[key]
    ? c.config.locations[key] === c.snapshot.location : c.snapshot.matchedDestination === key) || 'elsewhere';
}
function moveIssue(c, key, now) {
  if (!destinations.includes(key)) return 'Unknown destination';
  if (c.config.paused || c.suspended) return 'Resume desktop monitoring first';
  if (!freshSnapshot(c, now)) return 'Waiting for fresh Gather state';
  if (c.snapshot.movementIssues?.[key]) return c.snapshot.movementIssues[key];
  if (!c.config.adapterVerified || c.snapshot.canMove !== true) return 'Gather movement has not been verified yet';
  if (c.snapshot.movementCapabilities && c.snapshot.movementCapabilities[key] !== true) return 'Movement to this destination has not been verified yet';
  const target = c.config.locations?.[key];
  if (!target || (!c.testedDestinations?.has(target) && !observedManualAction(c.config, key))) return 'Capture and test this destination on the laptop first';
  if (c.adapter.pending || c.engine.pendingMove) return 'A movement is already in progress';
  return null;
}
function presenceStatus(c, now) {
  const monitoring = !c.suspended && !c.config.paused;
  const issue = !monitoring ? 'Desktop monitoring is paused' : !freshSnapshot(c, now) ? 'Waiting for fresh Gather state'
    : !c.config.presence.calibrated ? 'Calibrate this presence profile first' : sensorIssue(c.phone, c.ble.healthy, now);
  return { issue, availability: monitoring && (!issue || c.override) ? c.availability : 'unknown' };
}

class MobileDashboard {
  constructor(controller) { this.c = controller; this.reset(); }
  get moving() { return [...this.receipts.values()].some(item => item.status === 'moving'); }
  reset() { this.session = randomUUID(); this.receipts = new Map(); this.result = null; this.history = []; this.previous = null; }
  observe(now) {
    const c = this.c;
    const value = { availability: presenceStatus(c, now).availability, position: position(c, now), override: !!c.override };
    if (JSON.stringify(value) !== this.previous) {
      this.previous = JSON.stringify(value);
      this.history.unshift({ ...value, at: now }); this.history = this.history.slice(0, 12);
    }
  }
  state(now = Date.now()) {
    const c = this.c; this.observe(now);
    const monitoring = !c.suspended && !c.config.paused;
    const presence = presenceStatus(c, now), issue = presence.issue;
    return {
      version: 1, session: this.session, position: position(c, now),
      availability: presence.availability,
      override: c.override, presenceIssue: issue,
      candidate: !issue && !c.override && c.presence.candidate !== c.availability ? c.presence.candidate : null,
      candidateSeconds: Math.max(0, Math.ceil((c.presence.config.dwellMs - (now - c.presence.since)) / 1000)),
      rssi: now - c.lastRssiAt < 5000 ? c.lastRssi : null,
      medianRssi: signalMedian(c.presence.samples, now), bluetooth: c.ble.status,
      wifi: c.phone?.wifi || 'unknown', automatic: c.engine.owner,
      movementEnabled: c.config.movementVerified, paused: !monitoring,
      participants: freshSnapshot(c, now) && Array.isArray(c.snapshot.participants) ? c.snapshot.participants.length : null,
      moves: Object.fromEntries(destinations.map(key => [key, moveIssue(c, key, now)])),
      command: this.result, history: this.history,
    };
  }
  accept(command, now = Date.now()) {
    if (!command) return;
    // A bounded receipt ledger makes HTTP retries idempotent within this session.
    for (const [id, receipt] of this.receipts) if (receipt.status !== 'moving' && now - receipt.receivedAt > 60000) this.receipts.delete(id);
    if (this.receipts.has(command.id)) { this.result = this.receipts.get(command.id); return; }
    if (this.receipts.size >= 100) { this.result = { id: command.id, status: 'failed', message: 'Too many requests. Wait a minute before trying again.' }; return; }
    const issue = command.session !== this.session || !Number.isSafeInteger(command.createdAt) || command.createdAt > now + 2000 || now - command.createdAt > 15000
      ? 'Request expired or desktop session changed. Try again.' : this.moving ? 'A movement is already in progress' : moveIssue(this.c, command.destination, now);
    const result = { id: command.id, receivedAt: now, status: issue ? 'failed' : 'moving', message: issue || 'Moving to your selected destination…' };
    this.result = result; this.receipts.set(command.id, result);
    if (issue) return;
    const c = this.c, session = this.session, destination = c.config.locations[command.destination];
    const startedElsewhere = !!c.snapshot?.location && c.snapshot.location !== destination;
    c.engine.manualMovement();
    // Explicit phone navigation stays manual, including a manually selected break.
    Promise.resolve().then(() => session === this.session && c.adapter.move(destination)).then(success => {
      if (session !== this.session) return;
      if (success && startedElsewhere && c.adapter.lastMovement?.dispatched === true) { c.testedDestinations ??= new Set(); c.testedDestinations.add(destination); }
      result.status = success ? 'complete' : 'failed';
      result.message = success ? 'Arrival confirmed in Gather' : 'Arrival could not be confirmed. Check Gather on your laptop.';
    }).catch(() => {
      if (session === this.session) { result.status = 'failed'; result.message = 'Movement failed. Check Gather on your laptop.'; }
    });
  }
}
module.exports = { MobileDashboard, position, moveIssue };

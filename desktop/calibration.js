const { signalMedian, sensorIssue } = require('./presence');

const REQUIRED_MS = 120000;
const PREPARE_MS = 20000;
const emptyGroup = () => ({ frames: [], validMs: 0, signalMs: 0, gapMs: 0, maxGapMs: 0, samples: 0 });
function signalQuantile(frames, q) {
  const values = frames.filter(f => f.rssi !== null).sort((a, b) => a.rssi - b.rssi);
  const target = values.reduce((sum, f) => sum + f.durationMs, 0) * q;
  let total = 0;
  for (const frame of values) { total += frame.durationMs; if (total >= target) return frame.rssi; }
  return null;
}

class Calibration {
  constructor() { this.reset(); }
  export() { return JSON.parse(JSON.stringify(this.groups)); }
  static restore(groups) {
    const result = new Calibration();
    for (const key of ['near', 'far']) {
      const group = groups?.[key];
      if (!group || !Array.isArray(group.frames) || group.frames.length > 4096) throw new Error('Invalid saved measurement');
      let validMs = 0, signalMs = 0;
      const frames = group.frames.map(frame => {
        if (!Number.isInteger(frame.durationMs) || frame.durationMs <= 0 || frame.durationMs > 2000 || (frame.rssi !== null && (!Number.isFinite(frame.rssi) || frame.rssi < -127 || frame.rssi >= 0))) throw new Error('Invalid saved measurement');
        validMs += frame.durationMs; if (frame.rssi !== null) signalMs += frame.durationMs;
        return { rssi: frame.rssi, durationMs: frame.durationMs };
      });
      if (validMs > REQUIRED_MS || validMs !== group.validMs || signalMs !== group.signalMs || !Number.isInteger(group.samples) || group.samples < 0 || group.samples > 1000000 || !Number.isFinite(group.maxGapMs) || group.maxGapMs < 0 || group.maxGapMs > validMs - signalMs) throw new Error('Invalid saved measurement totals');
      result.groups[key] = { frames, validMs, signalMs, samples: group.samples, maxGapMs: group.maxGapMs, gapMs: 0 };
    }
    result.message = 'Saved measurements restored; collection stopped';
    return result;
  }
  reset() {
    this.groups = { near: emptyGroup(), far: emptyGroup() };
    this.active = null; this.recent = []; this.previous = null; this.message = 'Not started';
  }
  start(group, now) {
    if (!['near', 'far'].includes(group)) throw new Error('Invalid calibration group');
    if (this.active) throw new Error('Stop the current collection first');
    if (this.groups[group].validMs >= REQUIRED_MS) throw new Error('This group is complete. Reset it to record a new trial.');
    this.active = group; this.readyAt = now + PREPARE_MS;
    this.recent = []; this.previous = null; this.groups[group].gapMs = 0;
    this.message = 'Preparing';
  }
  stop(message = 'Stopped; measurements retained') {
    this.active = null; this.recent = []; this.previous = null; this.message = message;
  }
  resetGroup(group) {
    if (!['near', 'far'].includes(group)) throw new Error('Invalid calibration group');
    if (this.active) throw new Error('Stop collecting before resetting measurements');
    this.groups[group] = emptyGroup(); this.message = 'Measurements reset';
  }
  invalidate(message) {
    this.recent = []; this.previous = null;
    if (this.active) { this.groups[this.active].gapMs = 0; this.message = message; }
  }
  observe(rssi, now, issue) {
    if (!this.active || now < this.readyAt || issue || !Number.isFinite(rssi) || rssi >= 0 || rssi < -127) return;
    this.recent.push({ rssi, at: now });
    this.recent = this.recent.filter(s => now - s.at < 5000).slice(-100);
    this.groups[this.active].samples++;
  }
  tick(now, issue) {
    if (!this.active) return;
    if (now < this.readyAt) { this.message = 'Preparing'; this.previous = null; return; }
    if (issue) { this.invalidate(issue); return; }
    this.message = 'Collecting';
    const elapsed = this.previous === null ? 0 : now - this.previous;
    this.previous = now;
    // A blocked event loop or suspend is not evidence of continued reception loss.
    if (elapsed <= 0 || elapsed > 2000) { this.recent = []; this.groups[this.active].gapMs = 0; return; }
    this.recent = this.recent.filter(s => now >= s.at && now - s.at < 5000);
    const group = this.groups[this.active];
    const durationMs = Math.min(elapsed, REQUIRED_MS - group.validMs);
    const rssi = signalMedian(this.recent, now);
    group.frames.push({ rssi, durationMs }); group.validMs += durationMs;
    if (rssi === null) {
      group.gapMs += durationMs; group.maxGapMs = Math.max(group.maxGapMs, group.gapMs);
    } else { group.signalMs += durationMs; group.gapMs = 0; }
    if (group.validMs >= REQUIRED_MS) this.stop('Collection complete');
  }
  state(now) {
    return {
      active: this.active, message: this.message,
      countdownSeconds: this.active ? Math.max(0, Math.ceil((this.readyAt - now) / 1000)) : 0,
      requiredSeconds: REQUIRED_MS / 1000,
      comparison: this.comparison(),
      groups: Object.fromEntries(Object.entries(this.groups).map(([key, group]) => [key, {
        samples: group.samples, validSeconds: Math.floor(group.validMs / 1000),
        signalPercent: group.validMs ? Math.round(100 * group.signalMs / group.validMs) : 0,
        noSignalSeconds: Math.round((group.validMs - group.signalMs) / 1000),
        maxGapSeconds: group.maxGapMs / 1000, complete: group.validMs >= REQUIRED_MS,
      }])),
    };
  }
  comparison() {
    const nearWeak = signalQuantile(this.groups.near.frames, 0.1);
    const farStrong = signalQuantile(this.groups.far.frames, 0.9);
    return {
      complete: Object.values(this.groups).every(g => g.validMs >= REQUIRED_MS),
      nearWeak, farStrong, margin: nearWeak !== null && farStrong !== null ? nearWeak - farStrong : null,
      requiredMargin: 6,
    };
  }
  calculate() {
    if (this.active) throw new Error('Stop collecting before calculating thresholds');
    const { near, far } = this.groups;
    if (near.validMs < REQUIRED_MS || far.validMs < REQUIRED_MS) throw new Error('Record two minutes of healthy monitoring in each group');
    if (near.signalMs / near.validMs < 0.9 || near.maxGapMs > 5000) throw new Error('Reception in your room is too irregular. Check Bluetooth and repeat the room trial.');
    // Weight time windows rather than packet counts, so a reception burst cannot
    // dominate a trial. Missing far-room packets are never invented RSSI values.
    const { nearWeak: nearThreshold, farStrong: strongFar, margin, requiredMargin } = this.comparison();
    if (nearThreshold === null || nearThreshold < -121) throw new Error(`Room signal is too weak (${nearThreshold ?? 'unavailable'} dBm) to set a usable exit threshold. Keep automatic movement disabled.`);
    if (strongFar !== null && margin < requiredMargin) throw new Error(`Room signals overlap or have too little separation: weaker in-room signal ${nearThreshold} dBm, stronger other-room signal ${strongFar} dBm; margin ${margin} dB, required ${requiredMargin} dB. Keep automatic movement disabled.`);
    return { near: nearThreshold, far: nearThreshold - 6, dwellMs: 5000, calibrated: true, calibrationVersion: 2 };
  }
}

function calibrationIssue(phone, scanner, now) {
  return sensorIssue(phone, scanner, now) || (phone.wifi !== 'home' ? 'Connect the phone to home Wi-Fi for calibration' : null);
}
module.exports = { Calibration, calibrationIssue };

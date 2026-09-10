class Presence {
  constructor(config = {}) {
    this.config = { near: -60, far: -72, dwellMs: 5000, staleMs: 10000, calibrated: false, ...config };
    this.reset();
  }
  reset() { this.samples = []; this.near = null; this.state = 'unknown'; this.candidate = null; this.since = 0; }
  observe(rssi, now) {
    if (Number.isFinite(rssi) && rssi <= 0 && rssi >= -127) this.samples.push({ rssi, at: now });
    this.samples = this.samples.filter(s => now - s.at < 5000).slice(-100);
  }
  update(phone, scanner, now) {
    const c = this.config;
    if (!c.calibrated || !phone || now - phone.receivedAt > c.staleMs || !phone.bluetooth || !phone.serviceRunning || !scanner || !['home', 'away'].includes(phone.wifi)) return this.unknown();
    this.samples = this.samples.filter(s => now - s.at < 5000);
    if (this.samples.length) {
      const values = this.samples.map(s => s.rssi).sort((a, b) => a - b);
      const median = values[Math.floor(values.length / 2)];
      if (median >= c.near) this.near = true;
      else if (median <= c.far) this.near = false;
    } else this.near = false; // Only valid while both advertiser and scanner report healthy.
    if (this.near === null) return this.unknown();
    const desired = this.near ? 'available' : phone.wifi === 'home' ? 'brief' : 'away';
    if (this.candidate !== desired) { this.candidate = desired; this.since = now; }
    if (now - this.since >= c.dwellMs) this.state = desired;
    return this.state;
  }
  unknown() { this.state = 'unknown'; this.candidate = null; this.near = null; return this.state; }
}

function calibrate(nearSamples, farSamples) {
  if (nearSamples.length < 15 || farSamples.length < 15) throw new Error('Collect at least 15 samples in each location');
  const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)];
  const weakNear = quantile(nearSamples, 0.1), strongFar = quantile(farSamples, 0.9);
  if (weakNear - strongFar < 6) throw new Error('Room signals overlap. Keep automatic movement disabled.');
  return { near: weakNear, far: strongFar, dwellMs: 5000, calibrated: true };
}
module.exports = { Presence, calibrate };

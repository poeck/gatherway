class Presence {
  constructor(config = {}) {
    this.config = { near: -60, far: -72, dwellMs: 5000, staleMs: 10000, calibrated: false, ...config };
    this.reset();
  }
  reset() { this.samples = []; this.near = null; this.state = 'unknown'; this.candidate = null; this.since = 0; }
  observe(rssi, now) {
    if (Number.isFinite(rssi) && rssi < 0 && rssi >= -127) this.samples.push({ rssi, at: now });
    this.samples = this.samples.filter(s => now - s.at < 5000).slice(-100);
  }
  update(phone, scanner, now) {
    const c = this.config;
    if (!c.calibrated || sensorIssue(phone, scanner, now, c.staleMs)) return this.unknown();
    this.samples = this.samples.filter(s => now >= s.at && now - s.at < 5000);
    if (this.samples.length) {
      const median = signalMedian(this.samples, now);
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

function sensorIssue(phone, scanner, now, staleMs = 10000) {
  if (!phone || !Number.isFinite(phone.receivedAt) || now < phone.receivedAt || now - phone.receivedAt > staleMs) return 'Waiting for fresh phone telemetry';
  if (!scanner) return 'Bluetooth scanning unavailable';
  if (!phone.serviceRunning) return 'Start the phone companion';
  if (!phone.bluetooth) return 'Phone BLE advertising unavailable';
  if (!['home', 'away'].includes(phone.wifi)) return 'Phone Wi-Fi state unavailable';
  return null;
}
function signalMedian(samples, now) {
  const values = samples.filter(s => now >= s.at && now - s.at < 5000).map(s => s.rssi).sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : null;
}
module.exports = { Presence, sensorIssue, signalMedian };

const { spawn } = require('node:child_process');

class BleScanner {
  constructor(beacon, onSample, onHealth = () => {}, runtime = {}) {
    this.beacon = beacon.toLowerCase(); this.onSample = onSample; this.onHealth = onHealth;
    this.healthy = false; this.devices = new Map(); this.buffer = ''; this.status = 'Stopped';
    this.spawn = runtime.spawn || spawn;
    this.now = runtime.now || Date.now;
    this.setTimer = runtime.setTimeout || setTimeout; this.clearTimer = runtime.clearTimeout || clearTimeout;
    this.running = false; this.phase = 'stopped';
  }
  start() {
    if (this.running) return;
    this.running = true; this.launch();
  }
  launch() {
    if (!this.running) return;
    this.buffer = ''; this.devices.clear(); this.phase = 'controller';
    this.health(false, 'Waiting for Bluetooth controller');
    const child = this.child = this.spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C', TERM: 'dumb' } });
    const failed = status => { if (this.child === child) this.retry(status); };
    child.on('error', () => failed('bluetoothctl unavailable; retrying'));
    child.on('exit', () => failed('Bluetooth scanner stopped; retrying'));
    child.stdout.on('data', bytes => {
      if (this.child !== child) return;
      this.buffer += bytes.toString().replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '\n');
      const lines = this.buffer.split('\n'); this.buffer = lines.pop().slice(-4096);
      for (const line of lines) { if (this.child !== child) break; this.line(line); }
    });
    child.stdin.on('error', () => failed('Bluetooth scanner unavailable; retrying'));
    this.deadline = this.setTimer(() => failed('Bluetooth discovery timed out; retrying'), 10000);
    // Query readiness before sending scan commands; a controller can appear after startup.
    child.stdin.write('show\n');
  }
  retry(status) {
    this.clearTimer(this.deadline); this.deadline = null;
    this.clearTimer(this.retryTimer); this.retryTimer = null;
    const child = this.child; this.child = null;
    child?.kill(); this.devices.clear(); this.phase = 'waiting'; this.health(false, status);
    if (this.running) this.retryTimer = this.setTimer(() => { this.retryTimer = null; this.launch(); }, 3000);
  }
  line(line) {
    if (/Powered: no/.test(line)) { this.retry('Bluetooth is off; waiting for it to be enabled'); return; }
    if (/Failed to start discovery|SetDiscoveryFilter failed|Failed to set discovery filter|No default controller available/.test(line)) { this.retry('Bluetooth discovery unavailable; retrying'); return; }
    if (/\[CHG\] Controller .*Discovering: no/.test(line) && this.phase === 'scanning') { this.retry('Bluetooth discovery stopped; retrying'); return; }
    if (/Powered: yes/.test(line) && this.phase === 'controller' && this.child) {
      this.phase = 'discovery'; this.status = 'Starting Bluetooth discovery';
      // BlueZ 5.87 can crash with UUID discovery filters (bluez/bluez#2282).
      // Filter received observations locally instead; never forward unrelated devices.
      // `scan on` resets the transport filter to auto in bluetoothctl. Select LE
      // in the start command itself to avoid interleaving classic inquiry.
      this.child.stdin.write('menu scan\nduplicate-data on\nback\nscan le\n');
    }
    // A global Discovering property can belong to another client. Wait for our reply.
    if (/Discovery started/.test(line) && this.phase === 'discovery') {
      this.clearTimer(this.deadline); this.deadline = null; this.phase = 'scanning'; this.health(true, 'Scanning');
    }
    const match = /Device ([0-9A-F:]{17}) (.*)/i.exec(line);
    if (!match) return;
    const [, address, detail] = match;
    if (/\[DEL\] Device /.test(line)) { this.devices.delete(address); return; }
    const state = this.devices.get(address) || {};
    const advert = /^(UUIDs:|ServiceData[.: ])/.test(detail) && detail.toLowerCase().includes(this.beacon);
    if (advert) state.matches = true;
    const rssi = /RSSI: (?:(?:0x[0-9a-f]+)\s+\()?(-?\d+)/i.exec(detail);
    if (rssi) {
      const value = Number(rssi[1]);
      // Zero is BlueZ's invalidation value, not a nearby signal.
      state.rssi = value >= -127 && value < 0 ? value : null;
      state.at = this.now(); state.pendingSample = state.rssi != null;
    }
    // UUID and ServiceData changes may follow the same RSSI observation. They
    // identify the sender but must neither duplicate nor refresh an old sample.
    if (state.matches && state.pendingSample && this.now() - state.at < 5000) {
      state.pendingSample = false; this.onSample(state.rssi, state.at);
    }
    this.devices.set(address, state);
    if (this.devices.size > 100) this.devices.delete(this.devices.keys().next().value);
  }
  health(value, status) { this.healthy = value; this.status = status; this.onHealth(value); }
  stop() {
    this.running = false; this.clearTimer(this.retryTimer); this.retryTimer = null;
    this.clearTimer(this.deadline); this.deadline = null;
    const child = this.child; this.child = null;
    child?.stdin.end('scan off\nquit\n'); child?.kill();
    this.devices.clear(); this.phase = 'stopped'; this.health(false, 'Stopped');
  }
}
module.exports = { BleScanner };

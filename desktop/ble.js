const { spawn } = require('node:child_process');

class BleScanner {
  constructor(beacon, onSample, onHealth = () => {}) {
    this.beacon = beacon.toLowerCase(); this.onSample = onSample; this.onHealth = onHealth;
    this.healthy = false; this.devices = new Map(); this.buffer = ''; this.status = 'Stopped';
  }
  start() {
    this.child = spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C', TERM: 'dumb' } });
    this.child.on('error', () => this.health(false, 'bluetoothctl unavailable'));
    this.child.on('exit', () => this.health(false, 'Bluetooth scanner stopped'));
    this.child.stdout.on('data', bytes => {
      this.buffer += bytes.toString().replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '\n');
      const lines = this.buffer.split('\n'); this.buffer = lines.pop().slice(-4096);
      for (const line of lines) this.line(line);
    });
    this.child.stdin.on('error', () => this.health(false, 'Bluetooth scanner unavailable'));
    this.child.stdin.write(`menu scan\ntransport le\nduplicate-data on\nuuids ${this.beacon}\nback\nscan on\n`);
    this.status = 'Starting Bluetooth discovery';
  }
  line(line) {
    if (/Discovering: yes|Discovery started/.test(line)) this.health(true, 'Scanning');
    if (/Discovering: no|Powered: no|Failed to start discovery|No default controller available/.test(line)) this.health(false, 'Bluetooth discovery unavailable');
    const match = /Device ([0-9A-F:]{17}) (.*)/i.exec(line);
    if (!match) return;
    const [, address, detail] = match;
    const state = this.devices.get(address) || {};
    const advert = detail.toLowerCase().includes(this.beacon);
    if (advert) { state.matches = true; state.at = Date.now(); }
    const rssi = /RSSI: (?:(?:0x[0-9a-f]+)\s+\()?(-?\d+)/i.exec(detail);
    if (rssi) { state.rssi = Number(rssi[1]); state.at = Date.now(); }
    if (state.matches && state.rssi != null && (rssi || advert) && Date.now() - state.at < 5000) this.onSample(state.rssi, state.at);
    this.devices.set(address, state);
    if (this.devices.size > 100) this.devices.delete(this.devices.keys().next().value);
  }
  health(value, status) { this.healthy = value; this.status = status; this.onHealth(value); }
  stop() { this.child?.stdin.end('scan off\nquit\n'); this.child?.kill(); this.health(false, 'Stopped'); }
}
module.exports = { BleScanner };

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BleScanner } = require('../desktop/ble');
const { EventEmitter } = require('node:events');
const beacon = '12345678-1234-1234-1234-123456789abc';
function fixture() {
  const children = [], timers = new Map(); let next = 0;
  const scanner = new BleScanner(beacon, () => {}, () => {}, {
    spawn() {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stdin = new EventEmitter(); child.writes = [];
      child.stdin.write = value => child.writes.push(value); child.stdin.end = child.stdin.write;
      child.kill = () => { child.killed = true; child.emit('exit', 0); };
      children.push(child); return child;
    },
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const output = (child, text) => child.stdout.emit('data', Buffer.from(text + '\n'));
  const advance = delay => { for (const [id, task] of [...timers]) if (task.delay === delay) { timers.delete(id); task.fn(); } };
  return { scanner, children, timers, output, advance };
}
test('Bluetooth scanner only emits RSSI for the paired beacon UUID', () => {
  const beacon = '12345678-1234-1234-1234-123456789abc'; const samples = [];
  const scanner = new BleScanner(beacon, value => samples.push(value));
  scanner.line('[CHG] Device AA:BB:CC:DD:EE:FF RSSI: -65'); assert.equal(samples.length, 0);
  scanner.line(`[CHG] Device AA:BB:CC:DD:EE:FF UUIDs: ${beacon}`); assert.deepEqual(samples, [-65]);
  scanner.line('[CHG] Device AA:BB:CC:DD:EE:FF RSSI: 0xffffffb0 (-80)'); assert.equal(samples.at(-1), -80);
  scanner.phase = 'discovery'; scanner.line('Discovery started'); assert.equal(scanner.healthy, true);
  scanner.line('[CHG] Controller FF:EE:DD:CC:BB:AA Powered: no'); assert.equal(scanner.healthy, false);
});
test('scan waits for a powered controller and its own discovery confirmation', () => {
  const { scanner, children, output, timers } = fixture(); scanner.start(); const child = children[0];
  assert.deepEqual(child.writes, ['show\n']);
  output(child, '[CHG] Controller FF:EE:DD:CC:BB:AA Discovering: yes'); assert.equal(scanner.healthy, false);
  output(child, '\tPowered: yes\n\tDiscovering: no');
  assert.equal(child.writes.length, 2);
  assert.ok(child.writes[1].endsWith('scan le\n'));
  assert.ok(!child.writes[1].includes('scan on\n'));
  assert.ok(!child.writes[1].includes('uuids '));
  assert.equal(scanner.healthy, false); output(child, 'Discovery started');
  assert.equal(scanner.healthy, true); assert.equal(timers.size, 0); scanner.stop();
});
test('advertisement metadata neither duplicates nor refreshes an RSSI sample', () => {
  let now = 1000; const samples = [];
  const scanner = new BleScanner(beacon, (rssi, at) => samples.push({ rssi, at }), () => {}, { now: () => now });
  const prefix = '[CHG] Device AA:BB:CC:DD:EE:FF ';
  scanner.line(prefix + 'RSSI: -65');
  scanner.line(prefix + `ServiceData.${beacon}:`);
  scanner.line(prefix + `UUIDs: ${beacon}`);
  assert.deepEqual(samples, [{ rssi: -65, at: 1000 }]);
  now = 20000; scanner.line(prefix + `ServiceData.${beacon}:`);
  assert.equal(samples.length, 1);
  scanner.line(prefix + 'RSSI: -65');
  assert.deepEqual(samples.at(-1), { rssi: -65, at: 20000 });
  scanner.line(prefix + 'RSSI: 0x00000000 (0)');
  scanner.line(prefix + `ServiceData.${beacon}:`);
  assert.equal(samples.length, 2);
  scanner.line('[DEL] Device AA:BB:CC:DD:EE:FF Phone');
  scanner.line(prefix + 'RSSI: -70');
  now += 5001; scanner.line(prefix + `ServiceData.${beacon}:`);
  assert.equal(samples.length, 2);
});
test('failed discovery and controller loss retry without powering Bluetooth on', () => {
  for (const failure of ['No default controller available', 'Failed to start discovery: org.bluez.Error.NotReady', '[CHG] Controller FF:EE:DD:CC:BB:AA Powered: no', '[CHG] Controller FF:EE:DD:CC:BB:AA Discovering: no']) {
    const { scanner, children, output, advance } = fixture(); scanner.start(); const first = children[0];
    output(first, 'Powered: yes'); output(first, 'Discovery started');
    scanner.devices.set('old', { matches: true, rssi: -50 }); output(first, failure);
    assert.equal(scanner.healthy, false); assert.equal(first.killed, true); assert.equal(scanner.devices.size, 0);
    advance(3000); const second = children[1]; assert.deepEqual(second.writes, ['show\n']);
    output(first, 'Discovery started'); assert.equal(scanner.healthy, false);
    output(second, 'Powered: yes'); output(second, 'Discovery started'); assert.equal(scanner.healthy, true);
    assert.ok(children.every(c => c.writes.every(w => !w.includes('power on')))); scanner.stop();
  }
});
test('process errors and startup timeouts recover, while explicit stop cancels retries', () => {
  for (const fail of [f => f.children[0].emit('error', new Error('missing')), f => f.children[0].emit('exit', 1), f => f.advance(10000)]) {
    const f = fixture(); f.scanner.start(); fail(f); assert.equal(f.scanner.healthy, false);
    f.scanner.stop(); f.advance(3000); f.advance(10000);
    assert.equal(f.children.length, 1); assert.equal(f.timers.size, 0); assert.equal(f.scanner.status, 'Stopped');
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BleScanner } = require('../desktop/ble');
test('Bluetooth scanner only emits RSSI for the paired beacon UUID', () => {
  const beacon = '12345678-1234-1234-1234-123456789abc'; const samples = [];
  const scanner = new BleScanner(beacon, value => samples.push(value));
  scanner.line('[CHG] Device AA:BB:CC:DD:EE:FF RSSI: -65'); assert.equal(samples.length, 0);
  scanner.line(`[CHG] Device AA:BB:CC:DD:EE:FF UUIDs: ${beacon}`); assert.deepEqual(samples, [-65]);
  scanner.line('[CHG] Device AA:BB:CC:DD:EE:FF RSSI: 0xffffffb0 (-80)'); assert.equal(samples.at(-1), -80);
  scanner.line('[CHG] Controller FF:EE:DD:CC:BB:AA Discovering: yes'); assert.equal(scanner.healthy, true);
  scanner.line('[CHG] Controller FF:EE:DD:CC:BB:AA Powered: no'); assert.equal(scanner.healthy, false);
});

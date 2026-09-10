const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { seal, open, packet, ReplayGuard } = require('../desktop/protocol');
const { tailnetAddress } = require('../desktop/transport');
test('authenticated encryption round-trips unicode and rejects tampering', () => {
  const key = crypto.randomBytes(32).toString('base64'); const message = packet('event', { title: 'Hello 👋' });
  const envelope = seal(key, message); assert.deepEqual(open(key, envelope), message);
  const changed = Buffer.from(envelope.data, 'base64'); changed[0] ^= 1;
  assert.throws(() => open(key, { ...envelope, data: changed.toString('base64') }));
  assert.throws(() => open(crypto.randomBytes(32).toString('base64'), envelope));
});
test('wire protocol rejects invalid sizes and versions', () => {
  const key = crypto.randomBytes(32).toString('base64');
  assert.throws(() => open(key, { v: 2, iv: '', data: '' })); assert.throws(() => seal('invalid', {}));
});
test('replay guard rejects duplicate, expired and future requests', () => {
  const guard = new ReplayGuard(); const event = packet('exchange', {}, 100000);
  assert.equal(guard.accept(event, 100000), true); assert.equal(guard.accept(event, 100001), false);
  assert.equal(guard.accept(packet('exchange', {}, 1), 100000), false);
  assert.equal(guard.accept(packet('exchange', {}, 200000), 100000), false);
});
test('listener addresses are restricted to Tailscale IPv4', () => {
  for (const host of ['100.64.0.1', '100.127.255.255']) assert.equal(tailnetAddress(host), true);
  for (const host of ['0.0.0.0', '127.0.0.1', '100.128.0.1', '100.1.2.3', '100.64.999.1', 'evil.com']) assert.equal(tailnetAddress(host), false);
});

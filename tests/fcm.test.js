const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Fcm } = require('../desktop/fcm');
const { open } = require('../desktop/protocol');
test('FCM sends encrypted data with bounded TTL and reuses its access token', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gatherway-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const credentials = path.join(directory, 'credentials.json');
  fs.writeFileSync(credentials, JSON.stringify({ project_id: 'test-project', client_email: 'sender@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
  const key = crypto.randomBytes(32).toString('base64'); const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.includes('oauth2') ? { access_token: 'test-token', expires_in: 3600 } : { name: 'accepted' } };
  });
  const sender = new Fcm({ key, firebasePath: credentials });
  const event = { type: 'alert', id: 'event-a', kind: 'wave', mode: 'ring', sourceId: 'private-identifier', createdAt: Date.now(), expiresAt: Date.now() + 45000 };
  assert.equal(await sender.send(event, 'device-token'), true);
  const wire = JSON.parse(calls[1].options.body).message;
  assert.equal(wire.android.priority, 'high'); assert.ok(parseInt(wire.android.ttl) <= 45); assert.ok(!calls[1].options.body.includes('private-identifier'));
  assert.deepEqual(open(key, JSON.parse(wire.data.envelope)).body, event);
  await sender.send({ type: 'cancel', id: 'event-a' }, 'device-token');
  assert.equal(calls.filter(call => call.url.includes('oauth2')).length, 1);
  assert.equal(JSON.parse(calls[2].options.body).message.android.priority, 'normal');
});
test('missing Firebase setup is surfaced without claiming delivery', async () => {
  const sender = new Fcm({}); assert.equal(await sender.send({}, null), false); assert.match(sender.status, /missing/);
});

const crypto = require('node:crypto');

const AAD = Buffer.from('gatherway:v1');
function keyBytes(key) {
  const bytes = Buffer.from(key || '', 'base64');
  if (bytes.length !== 32) throw new Error('Pairing key must contain 32 bytes');
  return bytes;
}
function seal(key, message) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify(message)), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), data: Buffer.concat([data, cipher.getAuthTag()]).toString('base64') };
}
function open(key, envelope) {
  if (envelope?.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') throw new Error('Invalid envelope');
  const iv = Buffer.from(envelope.iv, 'base64');
  const data = Buffer.from(envelope.data, 'base64');
  if (iv.length !== 12 || data.length < 16 || data.length > 32768) throw new Error('Invalid envelope size');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(key), iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(data.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString());
}
function packet(kind, body, now = Date.now()) {
  return { id: crypto.randomUUID(), sentAt: now, kind, body };
}
class ReplayGuard {
  constructor() { this.seen = new Map(); }
  accept(message, now = Date.now()) {
    for (const [id, until] of this.seen) if (until < now) this.seen.delete(id);
    if (typeof message?.id !== 'string' || message.id.length > 100 || !Number.isFinite(message.sentAt) || Math.abs(now - message.sentAt) > 60000 || this.seen.has(message.id) || this.seen.size >= 10000) return false;
    this.seen.set(message.id, now + 120000);
    return true;
  }
}
module.exports = { seal, open, packet, ReplayGuard };

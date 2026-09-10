const fs = require('node:fs');
const crypto = require('node:crypto');
const { seal, packet } = require('./protocol');

class Fcm {
  constructor(config) { this.config = config; this.access = null; this.status = 'Not configured'; }
  async accessToken(account) {
    if (this.access && this.access.until > Date.now() + 60000) return this.access.token;
    const now = Math.floor(Date.now() / 1000);
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const payload = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const jwt = payload + '.' + crypto.sign('RSA-SHA256', Buffer.from(payload), account.private_key).toString('base64url');
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(10000), body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
    if (!response.ok) throw new Error('Firebase authentication failed');
    const result = await response.json();
    this.access = { token: result.access_token, until: Date.now() + result.expires_in * 1000 };
    return this.access.token;
  }
  async send(event, fcmToken) {
    if (!this.config.firebasePath || !fcmToken) { this.status = 'Firebase credentials or phone token missing'; return false; }
    try {
      const account = JSON.parse(fs.readFileSync(this.config.firebasePath, 'utf8'));
      if (!/^[a-z0-9-]+$/.test(account.project_id)) throw new Error('Invalid project');
      const token = await this.accessToken(account);
      const ttl = Math.max(0, Math.min(60, Math.floor(((event.expiresAt || Date.now() + 60000) - Date.now()) / 1000)));
      if (event.type !== 'cancel' && ttl === 0) return false;
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: 'POST', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: fcmToken, data: { envelope: JSON.stringify(seal(this.config.key, packet('event', event))) }, android: { priority: event.type === 'cancel' ? 'normal' : 'high', ttl: `${ttl}s` } } }),
      });
      if (!response.ok) throw new Error('Firebase delivery failed');
      this.status = 'Last message accepted by FCM'; return true;
    } catch { this.status = 'FCM failed; check credentials and network'; return false; }
  }
}
module.exports = { Fcm };

const http = require('node:http');
const { seal, open, packet, ReplayGuard } = require('./protocol');

function tailnetAddress(host) {
  const match = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host || '');
  return !!match && Number(match[1]) >= 64 && Number(match[1]) <= 127 && Number(match[2]) <= 255 && Number(match[3]) <= 255;
}
class Transport {
  constructor(config, onExchange, onError = () => {}) {
    this.config = config; this.onExchange = onExchange; this.onError = onError;
    this.guard = new ReplayGuard(); this.outbox = new Map(); this.server = null; this.status = 'Not configured';
  }
  queue(event) {
    this.outbox.delete(event.id);
    this.outbox.set(event.id, { ...event, deliveryUntil: event.type === 'cancel' ? Date.now() + 60000 : event.expiresAt });
    if (this.outbox.size > 200) this.outbox.delete(this.outbox.keys().next().value);
  }
  start() {
    if (!tailnetAddress(this.config.host)) { this.status = 'Enter the laptop Tailscale IPv4 address'; return; }
    this.server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'POST' || req.url !== '/v1/exchange') { res.writeHead(404).end('{}'); return; }
      try {
        let raw = ''; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 32768) { res.writeHead(413).end('{}'); return; } raw += chunk; }
        const message = open(this.config.key, JSON.parse(raw));
        if (!this.guard.accept(message) || message.kind !== 'exchange') throw new Error('Rejected request');
        const body = message.body;
        if (!body || !['home', 'away', 'unknown'].includes(body.wifi) || typeof body.bluetooth !== 'boolean' || typeof body.serviceRunning !== 'boolean' || !Array.isArray(body.acks) || body.acks.length > 100 || body.acks.some(id => typeof id !== 'string' || id.length > 100)) throw new Error('Invalid telemetry');
        if (body.fcmToken != null && (typeof body.fcmToken !== 'string' || body.fcmToken.length > 4096)) throw new Error('Invalid token');
        if (body.wifiTelemetryVersion != null && (body.wifiTelemetryVersion !== 1 || !(body.wifiSsid === null || (typeof body.wifiSsid === 'string' && Buffer.byteLength(body.wifiSsid, 'utf8') <= 32)))) throw new Error('Invalid Wi-Fi telemetry');
        const state = await this.onExchange(body);
        const now = Date.now();
        for (const [id, event] of this.outbox) if (event.deliveryUntil < now) this.outbox.delete(id);
        const events = [...this.outbox.values()].slice(-30).map(({ deliveryUntil, ...event }) => event);
        res.end(JSON.stringify(seal(this.config.key, packet('exchange-result', { requestId: message.id, state, events }))));
      } catch { if (!res.headersSent) res.writeHead(400); res.end('{}'); }
    });
    this.server.requestTimeout = 5000;
    this.server.headersTimeout = 5000;
    this.server.on('error', () => { this.status = 'Connection failed: check Tailscale address and port'; this.onError(); });
    this.server.listen(this.config.port, this.config.host, () => { this.status = 'Listening on Tailscale'; });
  }
  async close() { if (this.server) { this.server.closeAllConnections(); await new Promise(resolve => this.server.close(resolve)); this.server = null; } }
}
module.exports = { Transport, tailnetAddress };

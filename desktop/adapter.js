const { inspectGather } = require('./adapter-dom');

class GatherAdapter {
  constructor(win, config) { this.win = win; this.config = config; this.pending = false; this.generation = 0; }
  validOrigin() { try { return new URL(this.win.webContents.getURL()).origin === 'https://app.v2.gather.town'; } catch { return false; } }
  async evaluate(fn, ...args) {
    if (!this.validOrigin() || this.win.isDestroyed()) throw new Error('Gather is not available');
    return this.win.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `(${fn.toString()})(document, ...${JSON.stringify(args)})` }]);
  }
  async snapshot() {
    return this.evaluate(inspectGather, this.config.profile, { selfId: this.config.selfId, spaceId: this.config.spaceId });
  }
  invalidate() { this.generation++; }
  async move(destination) {
    const generation = this.generation;
    const selector = this.config.profile?.destinations?.[destination];
    if (!selector || this.pending) return false;
    this.pending = true;
    try {
      await this.evaluate((document, selector) => {
        const nodes = document.querySelectorAll(selector);
        if (nodes.length !== 1 || nodes[0].disabled || !nodes[0].getClientRects().length) throw new Error('Destination control unavailable');
        nodes[0].click();
      }, selector);
      const until = Date.now() + 15000;
      while (Date.now() < until && generation === this.generation) {
        const snapshot = await this.snapshot();
        if (!snapshot.connected) return false;
        if (snapshot.location === destination) return true;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      return false;
    } catch { return false; } finally { this.pending = false; }
  }
  async disableMedia(kinds) {
    for (const kind of ['mic', 'camera']) if (kinds[kind]) {
      const spec = this.config.profile?.[kind];
      if (!spec) continue;
      await this.evaluate((document, spec, participants, selfId) => {
        const containers = document.querySelectorAll(participants.container);
        if (containers.length !== 1) throw new Error('Participants unavailable');
        const ids = [...document.querySelectorAll(participants.selector)].map(node => node.getAttribute(participants.idAttribute));
        if (ids.some(id => !id || id !== selfId)) throw new Error('Another participant joined');
        const matches = document.querySelectorAll(spec.selector);
        if (matches.length !== 1) throw new Error('Media control unavailable');
        const node = matches[0];
        // Re-read immediately before acting. Never click an already disabled control.
        if (node.getAttribute(spec.attribute) === spec.on && !node.disabled) node.click();
      }, spec, this.config.profile.participants, this.config.selfId);
    }
    const snapshot = await this.snapshot();
    if ((kinds.mic && snapshot.mic !== false) || (kinds.camera && snapshot.camera !== false)) throw new Error('Media disable not confirmed');
  }
}
module.exports = { GatherAdapter };

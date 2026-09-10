const { inspectGather } = require('./adapter-dom');
const { observeGatherWaves } = require('./gather-waves');
const { inspectGatherSession, disableGatherMedia } = require('./gather-session');
const { inspectGatherLocation, describeGatherLocation } = require('./gather-location');
const { inspectGatherDesk } = require('./gather-desk');
const { randomUUID } = require('node:crypto');

class GatherAdapter {
  constructor(win, config) { this.win = win; this.config = config; this.pending = false; this.generation = 0; this.waveToken = randomUUID(); }
  validOrigin() { try { return new URL(this.win.webContents.getURL()).origin === 'https://app.v2.gather.town'; } catch { return false; } }
  async evaluate(fn, ...args) {
    if (!this.validOrigin() || this.win.isDestroyed()) throw new Error('Gather is not available');
    return this.win.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `(${fn.toString()})(document, ...${JSON.stringify(args)})` }]);
  }
  async snapshot() {
    const generation = this.generation, token = this.waveToken;
    const snapshot = await this.evaluate(inspectGather, this.config.profile, { selfId: this.config.selfId, spaceId: this.config.spaceId });
    snapshot.matchedDestination = null;
    if (generation !== this.generation) throw new Error('Gather session changed');
    let source;
    try { source = await this.readWaves(token, this.config.paused ? 'stop' : 'read'); }
    catch { source = { status: 'Gather event source unavailable', waves: null }; }
    if (generation !== this.generation || token !== this.waveToken) throw new Error('Gather session changed');
    snapshot.waveIntegration = source;
    let session;
    try { session = await this.readSession(); }
    catch { session = { status: 'Gather session unavailable', connected: false, participants: null, mic: null, camera: null }; }
    if (generation !== this.generation || token !== this.waveToken) throw new Error('Gather session changed');
    snapshot.sessionIntegration = session;
    let location;
    try { location = await this.readLocation(); }
    catch { location = { status: 'Gather location unavailable', connected: false, position: null }; }
    if (generation !== this.generation || token !== this.waveToken) throw new Error('Gather session changed');
    snapshot.locationIntegration = describeGatherLocation(location, this.config.profile?.location);
    try { snapshot.deskIntegration = await this.readDesk(); }
    catch { snapshot.deskIntegration = { status: 'Gather desk unavailable', connected: false, occupantIds: null, otherOccupantIds: null }; }
    if (generation !== this.generation || token !== this.waveToken) throw new Error('Gather session changed');
    if (this.config.profile?.session?.source === 'gather-repos') {
      const matching = session.connected === true && session.spaceId === this.config.spaceId && session.selfId === this.config.selfId;
      snapshot.connected = matching;
      snapshot.spaceId = matching ? session.spaceId : null;
      snapshot.selfId = matching ? session.selfId : null;
      snapshot.participants = matching && Array.isArray(session.participants) ? session.participants : null;
      if (!matching) snapshot.errors.push('Gather session unavailable or identity mismatch');
      if (snapshot.participants === null) snapshot.errors.push('participants unavailable');
      for (const kind of ['mic', 'camera']) {
        if (!matching || typeof session[kind] !== 'boolean' || snapshot[kind] !== session[kind]) {
          snapshot[kind] = null;
          snapshot.errors.push(`${kind} unavailable or contradictory`);
        }
      }
    }
    if (this.config.profile?.location?.source === 'gather-repos') {
      const matching = snapshot.connected && location.connected && location.spaceId === this.config.spaceId && location.selfId === this.config.selfId;
      snapshot.location = matching ? snapshot.locationIntegration.locationId : null;
      snapshot.matchedDestination = matching ? snapshot.locationIntegration.matchedDestination : null;
      // Observed coordinates do not prove that a navigation action exists.
      snapshot.canMove = false;
      if (snapshot.location === null) snapshot.errors.push('location unavailable');
    }
    if (this.config.profile?.deskVisitors?.source === 'gather-desk') {
      const desk = snapshot.deskIntegration, spec = this.config.profile.deskVisitors;
      const matching = snapshot.connected && desk.connected === true && desk.spaceId === this.config.spaceId && desk.selfId === this.config.selfId
        && spec.scope?.spaceId === desk.spaceId && spec.scope?.selfId === desk.selfId && spec.deskId === desk.deskId;
      snapshot.deskVisitors = matching && Array.isArray(desk.otherOccupantIds) ? desk.otherOccupantIds : null;
      if (snapshot.deskVisitors === null) snapshot.errors.push('deskVisitors unavailable');
    }
    if (this.config.profile?.waves?.source === 'gather-events') {
      const matching = source.spaceId === this.config.spaceId && source.selfId === this.config.selfId;
      snapshot.waves = matching && !source.baseline && Array.isArray(source.waves) ? source.waves : null;
      if (snapshot.waves === null) snapshot.errors.push('waves unavailable');
    }
    return snapshot;
  }
  async readWaves(token, command) {
    if (this.win.isDestroyed() || !this.validOrigin()) throw new Error('Gather is not available');
    return this.win.webContents.executeJavaScript(`(${observeGatherWaves.toString()})(globalThis, ${JSON.stringify(token)}, ${JSON.stringify(command)})`);
  }
  async readSession() {
    if (this.win.isDestroyed() || !this.validOrigin()) throw new Error('Gather is not available');
    return this.win.webContents.executeJavaScript(`(${inspectGatherSession.toString()})(globalThis)`);
  }
  async readLocation() {
    if (this.win.isDestroyed() || !this.validOrigin()) throw new Error('Gather is not available');
    return this.win.webContents.executeJavaScript(`(${inspectGatherLocation.toString()})(globalThis)`);
  }
  async readDesk() {
    if (this.win.isDestroyed() || !this.validOrigin()) throw new Error('Gather is not available');
    return this.win.webContents.executeJavaScript(`(${inspectGatherDesk.toString()})(globalThis)`);
  }
  async disableSessionMedia(kind, spec) {
    if (this.win.isDestroyed() || !this.validOrigin()) throw new Error('Gather is not available');
    const expected = { spaceId: this.config.spaceId, selfId: this.config.selfId };
    return this.win.webContents.executeJavaScript(`(${disableGatherMedia.toString()})(globalThis, document, ${inspectGatherSession.toString()}, ${JSON.stringify(expected)}, ${JSON.stringify(kind)}, ${JSON.stringify(spec)})`);
  }
  disconnect() {
    this.invalidate();
    const previous = this.waveToken; this.waveToken = randomUUID();
    // Token-scoped cleanup cannot remove a newer observer after a reconnect.
    this.readWaves(previous, 'stop').catch(() => {});
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
    const generation = this.generation;
    for (const kind of ['mic', 'camera']) if (kinds[kind]) {
      if (generation !== this.generation) throw new Error('Gather session changed');
      const spec = this.config.profile?.[kind];
      if (!spec) continue;
      if (this.config.profile?.session?.source === 'gather-repos') {
        await this.disableSessionMedia(kind, spec);
        continue;
      }
      await this.evaluate((document, spec, participants, selfId) => {
        const containers = document.querySelectorAll(participants.container);
        if (containers.length !== 1) throw new Error('Participants unavailable');
        const ids = [...document.querySelectorAll(participants.selector)].map(node => node.getAttribute(participants.idAttribute));
        if (ids.some(id => !id || id !== selfId)) throw new Error('Another participant joined');
        const matches = document.querySelectorAll(spec.selector);
        if (matches.length !== 1) throw new Error('Media control unavailable');
        const node = matches[0];
        // Re-read immediately before acting. Never click an already disabled control.
        if (node.getAttribute(spec.attribute) === spec.on) {
          if (node.disabled || node.getAttribute('aria-disabled') === 'true' || !node.getClientRects().length) throw new Error('Media control unavailable');
          node.click();
        }
      }, spec, this.config.profile.participants, this.config.selfId);
    }
    if (generation !== this.generation) throw new Error('Gather session changed');
    const snapshot = await this.snapshot();
    if ((kinds.mic && snapshot.mic !== false) || (kinds.camera && snapshot.camera !== false)) throw new Error('Media disable not confirmed');
  }
}
module.exports = { GatherAdapter };

const { inspectGather } = require('./adapter-dom');
const { observeGatherWaves } = require('./gather-waves');
const { inspectGatherSession, disableGatherMedia } = require('./gather-session');
const { inspectGatherLocation, describeGatherLocation } = require('./gather-location');
const { inspectGatherDesk } = require('./gather-desk');
const { deskNavigation, deskContextMatches, deskButton, coordinateNavigation, coordinateAction } = require('./gather-navigation');
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
    if (this.config.profile?.location?.source === 'gather-repos') {
      let deskReady = false;
      if (deskContextMatches(this.config, session, snapshot.deskIntegration)) {
        // Returning is a no-op at the verified target; Gather may hide its button there.
        if (snapshot.location === deskNavigation(this.config).destination) deskReady = true;
        else try { deskReady = await this.evaluate(deskButton); } catch { /* Keep unavailable controls disabled. */ }
      }
      if (generation !== this.generation) throw new Error('Gather session changed');
      snapshot.movementCapabilities = { available: deskReady, brief: false, away: false };
      snapshot.movementIssues = {
        available: deskReady ? null : !deskNavigation(this.config) ? 'Set up desk return in desktop settings first'
          : Array.isArray(session?.participants) && session.participants.length ? 'Desk return is currently verified only outside a conversation'
            : 'Waiting for the verified desk button and current desk state',
        brief: 'Movement to this destination has not been verified yet',
        away: 'Movement to this destination has not been verified yet',
      };
      for (const key of ['brief', 'away']) {
        const spec = coordinateNavigation(this.config, key);
        if (!spec) continue;
        let issue = 'Gather coordinate movement unavailable';
        try { issue = await this.runCoordinateAction(spec, false); } catch { /* Keep unavailable methods disabled. */ }
        if (generation !== this.generation) throw new Error('Gather session changed');
        snapshot.movementIssues[key] = issue;
        snapshot.movementCapabilities[key] = issue === null;
      }
      snapshot.canMove = Object.values(snapshot.movementCapabilities).some(Boolean);
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
  async runCoordinateAction(spec, execute) {
    if (this.win.isDestroyed() || !this.validOrigin()) throw new Error('Gather is not available');
    return this.win.webContents.executeJavaScript(`(${coordinateAction.toString()})(globalThis, ${JSON.stringify(spec)}, ${JSON.stringify(execute)})`);
  }
  async disableSessionMedia(kind, spec) {
    if (this.win.isDestroyed() || !this.validOrigin()) throw new Error('Gather is not available');
    const expected = { spaceId: this.config.spaceId, selfId: this.config.selfId };
    return this.win.webContents.executeJavaScript(`(${disableGatherMedia.toString()})(globalThis, document, ${inspectGatherSession.toString()}, ${JSON.stringify(expected)}, ${JSON.stringify(kind)}, ${JSON.stringify(spec)})`);
  }
  disconnect(reason = 'Gather session reset') {
    this.invalidate(reason);
    const previous = this.waveToken; this.waveToken = randomUUID();
    // Token-scoped cleanup cannot remove a newer observer after a reconnect.
    this.readWaves(previous, 'stop').catch(() => {});
  }
  invalidate(reason = 'Gather session changed') {
    this.generation++;
    if (this.pending && this.lastMovement && !this.lastMovement.interruption) this.lastMovement.interruption = reason;
  }
  async move(destination) {
    const generation = this.generation;
    const desk = deskNavigation(this.config);
    const isDesk = desk?.destination === destination;
    const coordinates = ['brief', 'away'].map(key => coordinateNavigation(this.config, key)).find(spec => spec?.destination === destination);
    const usesPositionReader = isDesk || !!coordinates;
    const selector = this.config.profile?.destinations?.[destination];
    if ((!selector && !isDesk && !coordinates) || this.pending) return false;
    this.pending = true;
    const trace = this.lastMovement = { destination, status: 'moving', startedAt: Date.now(), observedLocation: null, dispatched: false, reason: null };
    const finish = (status, reason) => { Object.assign(trace, { status, reason, finishedAt: Date.now() }); return status === 'confirmed'; };
    const interrupted = () => finish('interrupted', `Movement confirmation interrupted: ${trace.interruption || 'Gather session changed'}`);
    try {
      if (coordinates) {
        const result = await this.runCoordinateAction(coordinates, true);
        if (typeof result?.started !== 'boolean') return finish('failed', typeof result === 'string' ? result : 'Coordinate movement was not accepted');
        trace.dispatched = result.started;
      } else if (isDesk) {
        if (!this.validOrigin() || this.win.isDestroyed()) return finish('failed', 'Gather window or origin is unavailable');
        const expected = { spaceId: this.config.spaceId, selfId: this.config.selfId, deskId: desk.deskId, target: desk.target };
        // Re-read the session and assigned desk in the same page turn as the click.
        const clicked = await this.win.webContents.executeJavaScript(`(() => {
          const expected = ${JSON.stringify(expected)};
          const session = (${inspectGatherSession.toString()})(globalThis);
          const desk = (${inspectGatherDesk.toString()})(globalThis);
          const location = (${inspectGatherLocation.toString()})(globalThis);
          if (!session.connected || session.spaceId !== expected.spaceId || session.selfId !== expected.selfId
            || !Array.isArray(session.participants) || session.participants.length !== 0
            || !desk.connected || desk.spaceId !== expected.spaceId || desk.selfId !== expected.selfId || desk.deskId !== expected.deskId
            || !location.connected || location.spaceId !== expected.spaceId || location.selfId !== expected.selfId) return false;
          if (location.floorId === expected.target.floorId && location.position.x === expected.target.x && location.position.y === expected.target.y) return 'already-there';
          return (${deskButton.toString()})(document, true);
        })()`);
        if (!clicked) return finish('failed', 'Desk control or conversation/desk state changed before the click');
        trace.dispatched = clicked === true;
      } else {
        await this.evaluate((document, selector) => {
        const nodes = document.querySelectorAll(selector);
        if (nodes.length !== 1 || nodes[0].disabled || !nodes[0].getClientRects().length) throw new Error('Destination control unavailable');
        nodes[0].click();
      }, selector);
        trace.dispatched = true;
      }
      const until = Date.now() + 15000;
      while (Date.now() < until && generation === this.generation) {
        // Navigation animations can briefly make a reader unavailable. Arrival needs
        // only a fresh position, not the visibility of the button or other UI panels.
        let snapshot, timeout;
        try {
          const reading = usesPositionReader ? this.readLocation().then(location => ({ ...location, location: describeGatherLocation(location, this.config.profile.location).locationId })) : this.snapshot();
          snapshot = await Promise.race([reading, new Promise(resolve => { timeout = setTimeout(() => resolve(null), Math.max(0, until - Date.now())); })]);
        } catch { snapshot = null; } finally { clearTimeout(timeout); }
        if (snapshot?.location) trace.observedLocation = snapshot.location;
        if (generation !== this.generation) return interrupted();
        if (usesPositionReader && !this.validOrigin()) return finish('failed', 'Gather origin changed during arrival confirmation');
        if ((snapshot?.spaceId && snapshot.spaceId !== this.config.spaceId) || (snapshot?.selfId && snapshot.selfId !== this.config.selfId)) return finish('failed', 'Gather identity changed during arrival confirmation');
        if (Date.now() < until && snapshot?.connected && snapshot.spaceId === this.config.spaceId && snapshot.selfId === this.config.selfId && snapshot.location === destination) return finish('confirmed', 'Arrival confirmed');
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      return generation !== this.generation
        ? interrupted()
        : finish('failed', `Arrival was not confirmed within 15 seconds. Expected ${destination}; last observed ${trace.observedLocation || 'unavailable'}`);
    } catch { return finish('failed', 'Could not read Gather state or activate the destination control'); } finally { this.pending = false; }
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

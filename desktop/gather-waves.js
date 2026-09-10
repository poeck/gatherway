// Evaluated in Gather's page world. No Electron, Node, or device APIs are exposed.
function observeGatherWaves(page, token, command = 'read') {
  const key = Symbol.for('gatherway.wave-observer.v1');
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
  const unavailable = status => ({ status, spaceId: null, selfId: null, waves: null });
  let state = page[key];
  if (command === 'stop') {
    if (state?.token === token) state.dispose();
    return unavailable('Stopped');
  }
  const readScope = () => {
    const space = page.gatherDev?.Repos?.gameSpace;
    if (space?.wsConnected !== true) throw new Error('Disconnected');
    const spaceId = space.currentSpaceOrUndefined?.id;
    const selfId = space.currentSpaceUserOrUndefined?.id;
    if (!uuid(spaceId) || !uuid(selfId)) throw new Error('Identity unavailable');
    const events = space.events, lifecycle = space.wsEvents;
    if (typeof events?.addEventListener !== 'function' || typeof lifecycle?.addEventListener !== 'function') throw new Error('Events unavailable');
    return { spaceId, selfId, events, lifecycle };
  };
  let scope;
  try { scope = readScope(); } catch {
    state?.dispose();
    return unavailable('Gather event source unavailable');
  }
  const matches = current => current.spaceId === scope.spaceId && current.selfId === scope.selfId && current.events === scope.events && current.lifecycle === scope.lifecycle;
  if (state && (state.token !== token || !matches(state) || Date.now() - state.lastRead >= 5000)) {
    state.dispose(); state = null;
  }
  let baseline = false;
  if (!state) {
    baseline = true;
    state = { ...scope, token, startedAt: Date.now(), lastRead: Date.now(), waves: new Map(), cleanup: [], timer: null, disposed: false };
    const current = state;
    current.dispose = () => {
      if (current.disposed) return;
      current.disposed = true;
      clearTimeout(current.timer);
      current.waves.clear();
      for (const remove of current.cleanup.splice(0)) { try { remove(); } catch {} }
      if (page[key] === current) delete page[key];
    };
    page[key] = current;
    const subscribe = (bus, name, callback) => {
      const remove = bus.addEventListener(name, callback);
      if (typeof remove !== 'function') throw new Error('Listener cleanup unavailable');
      current.cleanup.push(remove);
    };
    try {
      subscribe(scope.events, 'WaveEvent', event => {
        if (current.disposed) return;
        const now = Date.now();
        try {
          const active = readScope();
          if (!matches(active) || now - current.lastRead >= 5000) { current.dispose(); return; }
          const createdAt = event?.sentTime?.toMillis?.();
          const fromId = event?.senderId;
          if (!uuid(fromId) || fromId === current.selfId || !Number.isSafeInteger(createdAt) || createdAt <= current.startedAt || createdAt > now || now >= createdAt + 45000) return;
          for (const [id, wave] of current.waves) if (now >= wave.createdAt + 45000) current.waves.delete(id);
          const id = `${current.spaceId}:${current.selfId}:${fromId}:${createdAt}`;
          if (current.waves.has(id) || current.waves.size >= 128) return;
          current.waves.set(id, { id, fromId, createdAt });
        } catch { current.dispose(); }
      });
      for (const name of ['connecting', 'close', 'disconnect']) subscribe(scope.lifecycle, name, current.dispose);
    } catch {
      current.dispose();
      return unavailable('Gather event subscription unavailable');
    }
  }
  state.lastRead = Date.now();
  clearTimeout(state.timer);
  state.timer = setTimeout(state.dispose, 5000);
  for (const [id, wave] of state.waves) if (state.lastRead >= wave.createdAt + 45000) state.waves.delete(id);
  return { status: 'Listening', spaceId: state.spaceId, selfId: state.selfId, baseline, waves: [...state.waves.values()] };
}

module.exports = { observeGatherWaves };

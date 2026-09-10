// Run in Gather's DevTools Console for each manually confirmed conversation state.
// Reads only connection IDs and local media flags; does not change the session.
(() => {
  const repos = globalThis.gatherDev?.Repos;
  const result = { connected: false, selfId: null, participants: null, nearbyListeners: null, mic: null, camera: null };
  try {
    if (repos?.gameSpace?.wsConnected !== true) return JSON.stringify(result, null, 2);
    result.connected = true;
    result.selfId = repos.gameSpace.currentSpaceUserOrUndefined?.id ?? null;
    const ids = value => Array.isArray(value) && value.every(id => typeof id === 'string') ? [...value] : null;
    result.participants = ids(repos.avConnections?.stronglyConnectedSpaceUserIds);
    result.nearbyListeners = ids(repos.avConnections?.ambientlyConnectedSpaceUserIds);
    const boolean = value => typeof value === 'boolean' ? value : null;
    result.mic = boolean(repos.localMediaSelfInfo?.ownAudioEnabled);
    result.camera = boolean(repos.localMediaSelfInfo?.ownVideoEnabled);
  } catch {
    return JSON.stringify({ status: 'Conversation state unavailable' });
  }
  return JSON.stringify(result, null, 2);
})();

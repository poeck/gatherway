// Run in Gather's DevTools Console while standing at a manually chosen location.
// Reads only the current user's location. Does not move the avatar or save a destination.
(() => {
  const result = { connected: false, spaceId: null, selfId: null, floorId: null, position: null };
  const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;
  try {
    const game = globalThis.gatherDev?.Repos?.gameSpace;
    if (game?.wsConnected !== true) return JSON.stringify(result, null, 2);
    const user = game.currentSpaceUserOrUndefined;
    if (!user) return JSON.stringify(result, null, 2);
    result.spaceId = identifier(game.currentSpaceOrUndefined?.id);
    result.selfId = identifier(user.id);
    result.floorId = identifier(user.floorId);
    const position = user.position;
    if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) result.position = { x: position.x, y: position.y };
    if (game.wsConnected !== true || game.currentSpaceUserOrUndefined?.id !== result.selfId || game.currentSpaceOrUndefined?.id !== result.spaceId) throw new Error('Session changed');
    result.connected = !!result.spaceId && !!result.selfId;
  } catch {
    return JSON.stringify({ status: 'Location unavailable' });
  }
  return JSON.stringify(result, null, 2);
})();

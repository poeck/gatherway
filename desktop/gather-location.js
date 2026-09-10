/* Evaluated in Gather's page world. Reads only the current user's position. */
function inspectGatherLocation(page) {
  const unknown = { status: 'Gather location unavailable', connected: false, spaceId: null, selfId: null, floorId: null, position: null };
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  try {
    const game = page.gatherDev?.Repos?.gameSpace;
    if (game?.wsConnected !== true) return unknown;
    const user = game.currentSpaceUserOrUndefined;
    const spaceId = game.currentSpaceOrUndefined?.id, selfId = user?.id, floorId = user?.floorId;
    const x = user?.position?.x, y = user?.position?.y;
    if (![spaceId, selfId, floorId].every(uuid) || !Number.isFinite(x) || !Number.isFinite(y)) return unknown;
    if (page.gatherDev?.Repos?.gameSpace !== game || game.wsConnected !== true || game.currentSpaceOrUndefined?.id !== spaceId || game.currentSpaceUserOrUndefined?.id !== selfId || user.floorId !== floorId) return unknown;
    return { status: 'Observed', connected: true, spaceId, selfId, floorId, position: { x, y } };
  } catch { return unknown; }
}

function describeGatherLocation(source, spec) {
  if (!source?.connected || !source.floorId || !source.spaceId || !Number.isFinite(source.position?.x) || !Number.isFinite(source.position?.y)) return { ...source, locationId: null, matchedDestination: null };
  // Keep exact coordinates, including unsaved positions, so manual movement remains visible.
  const locationId = `gather:${source.spaceId}:${source.floorId}:${source.position.x}:${source.position.y}`;
  const matches = spec?.scope?.spaceId === source.spaceId && spec.scope.selfId === source.selfId
    ? ['available', 'brief', 'away'].filter(key => {
      const target = spec.targets?.[key];
      return target?.floorId === source.floorId && target.x === source.position.x && target.y === source.position.y;
    }) : [];
  return { ...source, locationId, matchedDestination: matches.length === 1 ? matches[0] : null };
}

module.exports = { inspectGatherLocation, describeGatherLocation };

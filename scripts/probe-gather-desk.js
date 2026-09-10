// Run in Gather's DevTools Console at the desk and during a manually arranged visit.
// Reads only the current user's assigned desk, its occupants and conversation IDs.
// Occupancy is a candidate signal, not a verified conversation or alert trigger.
(() => {
  const result = { connected: false, spaceId: null, selfId: null, assignedDeskId: null, atOwnDesk: null, currentAreaId: null, selfClusterId: null, participants: null, desk: null, errors: [] };
  const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;
  const boolean = value => typeof value === 'boolean' ? value : null;
  const attempt = (field, read) => { try { result[field] = read(); } catch { result.errors.push(`${field} unavailable`); } };
  const ids = value => {
    if (!(Array.isArray(value) || value instanceof Set) || value.size > 1000 || value.length > 1000) return null;
    const list = [...value];
    return list.every(id => identifier(id)) && new Set(list).size === list.length ? list : null;
  };
  try {
    const repos = globalThis.gatherDev?.Repos, game = repos?.gameSpace;
    if (game?.wsConnected !== true) return JSON.stringify(result, null, 2);
    const user = game.currentSpaceUserOrUndefined;
    if (!user) return JSON.stringify(result, null, 2);
    result.spaceId = identifier(game.currentSpaceOrUndefined?.id);
    result.selfId = identifier(user.id);
    attempt('assignedDeskId', () => identifier(user.deskId));
    attempt('atOwnDesk', () => boolean(user.isAtOwnDesk));
    attempt('currentAreaId', () => identifier(user.currentMapArea?.stableId_USE_THIS_INSTEAD_OF_ID));
    attempt('selfClusterId', () => identifier(user.clusterId));
    attempt('participants', () => ids(repos.avConnections?.stronglyConnectedSpaceUserIds));
    attempt('desk', () => {
      const desk = user.desk;
      if (!desk) return null;
      const mapAvailable = !!desk.mapOrUndefined;
      const occupants = mapAvailable ? desk.spaceUsers : null;
      return {
        areaId: identifier(desk.stableId_USE_THIS_INSTEAD_OF_ID),
        ownerId: identifier(desk.deskOwner?.id),
        mapAvailable,
        fullyAVConnected: boolean(desk.isFullyAVConnected),
        occupantIds: mapAvailable ? ids(desk.spaceUserIds) : null,
        occupants: Array.isArray(occupants) && occupants.length <= 1000 ? occupants.map(person => ({
          id: identifier(person.id),
          clusterId: identifier(person.clusterId),
          currentAreaId: identifier(person.currentMapArea?.stableId_USE_THIS_INSTEAD_OF_ID),
        })) : null,
      };
    });
    if (game !== globalThis.gatherDev?.Repos?.gameSpace || game.wsConnected !== true || game.currentSpaceUserOrUndefined?.id !== result.selfId || game.currentSpaceOrUndefined?.id !== result.spaceId) throw new Error('Session changed');
    result.connected = !!result.spaceId && !!result.selfId;
  } catch { return JSON.stringify({ status: 'Desk state unavailable' }); }
  return JSON.stringify(result, null, 2);
})();

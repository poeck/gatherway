/* Evaluated in Gather's page world. Reads occupancy; policy decides whether to alert. */
function inspectGatherDesk(page) {
  const unknown = { status: 'Gather desk unavailable', connected: false, spaceId: null, selfId: null, deskId: null, atOwnDesk: null, occupantIds: null, otherOccupantIds: null };
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  try {
    const game = page.gatherDev?.Repos?.gameSpace;
    if (game?.wsConnected !== true) return unknown;
    const user = game.currentSpaceUserOrUndefined;
    const spaceId = game.currentSpaceOrUndefined?.id, selfId = user?.id, deskId = user?.deskId;
    if (![spaceId, selfId, deskId].every(uuid)) return unknown;
    const desk = user.desk, atOwnDesk = user.isAtOwnDesk;
    if (!desk || desk.stableId_USE_THIS_INSTEAD_OF_ID !== deskId || desk.deskOwner?.id !== selfId || !desk.mapOrUndefined || desk.isFullyAVConnected !== true || typeof atOwnDesk !== 'boolean') return unknown;
    // The live probe verified spaceUsers as an array; spaceUserIds was unavailable.
    const occupants = desk.spaceUsers;
    if (!Array.isArray(occupants) || occupants.length > 1000) return unknown;
    const occupantIds = [];
    for (const person of occupants) {
      if (!uuid(person?.id) || person.currentMapArea?.stableId_USE_THIS_INSTEAD_OF_ID !== deskId) return unknown;
      occupantIds.push(person.id);
    }
    if (new Set(occupantIds).size !== occupantIds.length || occupantIds.includes(selfId) !== atOwnDesk) return unknown;
    if (page.gatherDev?.Repos?.gameSpace !== game || game.wsConnected !== true || game.currentSpaceOrUndefined?.id !== spaceId || game.currentSpaceUserOrUndefined?.id !== selfId || user.deskId !== deskId || user.desk !== desk) return unknown;
    return { status: 'Observed', connected: true, spaceId, selfId, deskId, atOwnDesk, occupantIds, otherOccupantIds: occupantIds.filter(id => id !== selfId) };
  } catch { return unknown; }
}

module.exports = { inspectGatherDesk };

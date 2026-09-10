/* Evaluated in Gather's page world. Read only the observed public client properties. */
function inspectGatherSession(page) {
  const result = { status: 'Gather session unavailable', connected: false, spaceId: null, selfId: null, participants: null, nearbyListeners: null, mic: null, camera: null, errors: [] };
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  try {
    const repos = page.gatherDev?.Repos, game = repos?.gameSpace;
    if (game?.wsConnected !== true) return result;
    const spaceId = game.currentSpaceOrUndefined?.id, selfId = game.currentSpaceUserOrUndefined?.id;
    if (!uuid(spaceId) || !uuid(selfId)) return result;
    const attempt = (field, read) => { try { result[field] = read(); } catch { result.errors.push(`${field} unavailable`); } };
    const ids = value => {
      if (!Array.isArray(value) || value.length > 1000 || value.some(id => !uuid(id) || id === selfId) || new Set(value).size !== value.length) throw new Error('Invalid participants');
      return [...value];
    };
    attempt('participants', () => ids(repos.avConnections?.stronglyConnectedSpaceUserIds));
    attempt('nearbyListeners', () => ids(repos.avConnections?.ambientlyConnectedSpaceUserIds));
    for (const [kind, property] of [['mic', 'ownAudioEnabled'], ['camera', 'ownVideoEnabled']]) attempt(kind, () => {
      const value = repos.localMediaSelfInfo?.[property];
      if (typeof value !== 'boolean') throw new Error('Unknown media state');
      return value;
    });
    if (game !== page.gatherDev?.Repos?.gameSpace || game.wsConnected !== true || game.currentSpaceOrUndefined?.id !== spaceId || game.currentSpaceUserOrUndefined?.id !== selfId) throw new Error('Session changed');
    return { ...result, status: 'Observed', connected: true, spaceId, selfId };
  } catch {
    return { ...result, connected: false, spaceId: null, selfId: null, participants: null, nearbyListeners: null, mic: null, camera: null, errors: ['Gather session unavailable'] };
  }
}

/* Read participants and media immediately before the explicit disable action. */
function disableGatherMedia(page, document, inspect, expected, kind, spec) {
  if (!['mic', 'camera'].includes(kind)) throw new Error('Invalid media kind');
  const source = inspect(page);
  if (!source.connected || source.spaceId !== expected.spaceId || source.selfId !== expected.selfId || !Array.isArray(source.participants)) throw new Error('Participants unavailable');
  if (source.participants.length) throw new Error('Another participant joined');
  const name = kind === 'mic' ? 'microphone' : 'camera';
  if (spec?.attribute !== 'data-testid' || spec.on !== `toggle-${name}-off-button` || spec.off !== `toggle-${name}-on-button`) throw new Error('Media control unavailable');
  const matches = document.querySelectorAll(spec.selector);
  if (matches.length !== 1 || matches[0].tagName !== 'BUTTON') throw new Error('Media control unavailable');
  const node = matches[0], value = node.getAttribute(spec.attribute);
  if (source[kind] === false && value === spec.off) return;
  if (source[kind] !== true || value !== spec.on) throw new Error('Media state unavailable or contradictory');
  if (node.disabled || node.getAttribute('aria-disabled') === 'true' || !node.getClientRects().length) throw new Error('Media control unavailable');
  node.click();
}

module.exports = { inspectGatherSession, disableGatherMedia };

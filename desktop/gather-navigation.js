function deskNavigation(config) {
  const spec = config.profile?.navigation?.desk;
  const location = config.profile?.location;
  const target = location?.targets?.available;
  if (spec?.source !== 'observed-desk-button' || spec.scope?.spaceId !== config.spaceId || spec.scope?.selfId !== config.selfId
    || location?.scope?.spaceId !== config.spaceId || location?.scope?.selfId !== config.selfId
    || !target || target.floorId !== spec.target?.floorId || target.x !== spec.target.x || target.y !== spec.target.y
    || spec.deskId !== config.profile?.deskVisitors?.deskId) return null;
  const destination = `gather:${config.spaceId}:${target.floorId}:${target.x}:${target.y}`;
  if (config.locations?.available && config.locations.available !== destination) return null;
  return { ...spec, destination };
}

function deskContextMatches(config, session, desk) {
  const spec = deskNavigation(config);
  return !!spec && session?.connected === true && session.spaceId === config.spaceId && session.selfId === config.selfId
    && Array.isArray(session.participants) && session.participants.length === 0
    && desk?.connected === true && desk.spaceId === config.spaceId && desk.selfId === config.selfId && desk.deskId === spec.deskId;
}

// The supplied control was verified outside a conversation. Do not infer meeting behavior.
function deskButton(document, click = false) {
  const nodes = document.querySelectorAll('button[data-testid="leave-meeting-button"]');
  if (nodes.length !== 1) return false;
  const node = nodes[0];
  if (node.disabled || node.getAttribute('aria-disabled') === 'true' || !node.getClientRects().length) return false;
  if (click) node.click();
  return true;
}

function installObservedDeskAction(config) {
  const observed = require('./profiles/otark-paul-observed.json');
  const candidate = { ...config, profile: { ...config.profile, navigation: { ...config.profile?.navigation, desk: observed.navigation.desk } } };
  if (!deskNavigation(candidate)) throw new Error('The observed desk action does not match this identity and saved desk. Verify this installation separately.');
  config.profile = candidate.profile;
  config.locations ??= {};
  config.locations.available = deskNavigation(config).destination;
  config.movementVerified = false;
}

function coordinateNavigation(config, key) {
  if (!['brief', 'away'].includes(key)) return null;
  const spec = config.profile?.navigation?.coordinates;
  const location = config.profile?.location;
  const target = spec?.targets?.[key], captured = location?.targets?.[key];
  if (spec?.source !== 'gather-move-controller-v1' || spec.scope?.spaceId !== config.spaceId || spec.scope?.selfId !== config.selfId
    || location?.scope?.spaceId !== config.spaceId || location?.scope?.selfId !== config.selfId
    || !target || !captured || target.floorId !== captured.floorId || target.x !== captured.x || target.y !== captured.y
    || !Number.isSafeInteger(target.x) || !Number.isSafeInteger(target.y) || typeof target.floorId !== 'string') return null;
  const destination = `gather:${config.spaceId}:${target.floorId}:${target.x}:${target.y}`;
  if (config.locations?.[key] && config.locations[key] !== destination) return null;
  return { ...spec.scope, target, destination };
}

// These exact actions and destinations were manually verified in the configured office.
// This permits explicit phone trials; automatic movement still requires completed
// adapter arrival checks and a separate user enable action.
function observedManualAction(config, key) {
  const observed = require('./profiles/otark-paul-observed.json');
  const spec = key === 'available' ? deskNavigation(config) : coordinateNavigation(config, key);
  const expected = observed.location.targets[key];
  return !!spec && !!expected && config.spaceId === observed.location.scope.spaceId && config.selfId === observed.location.scope.selfId
    && spec.target.floorId === expected.floorId && spec.target.x === expected.x && spec.target.y === expected.y;
}

function installObservedCoordinateActions(config) {
  const observed = require('./profiles/otark-paul-observed.json');
  const candidate = { ...config, profile: { ...config.profile, navigation: { ...config.profile?.navigation, coordinates: structuredClone(observed.navigation.coordinates) } }, locations: { ...config.locations } };
  for (const key of ['brief', 'away']) {
    if (!observedManualAction(candidate, key)) throw new Error('Coordinate movement does not match the observed identity and destinations');
    candidate.locations[key] = coordinateNavigation(candidate, key).destination;
  }
  config.profile = candidate.profile; config.locations = candidate.locations; config.movementVerified = false;
}

// Runs in Gather's page world. Reading readiness never creates a Position or moves.
function coordinateAction(page, expected, execute = false) {
  const game = page.gatherDev?.Repos?.gameSpace;
  const user = game?.currentSpaceUserOrUndefined;
  const participants = page.gatherDev?.Repos?.avConnections?.stronglyConnectedSpaceUserIds;
  const controller = page.gatherDev?.MoveController;
  const target = expected.target;
  if (!game?.wsConnected || game.currentSpaceOrUndefined?.id !== expected.spaceId || user?.id !== expected.selfId) return 'Waiting for the configured Gather session';
  if (!target || user.floorId !== target.floorId) return 'Movement has only been verified on the saved floor';
  if (!Array.isArray(participants)) return 'Conversation state unavailable';
  if (participants.length) return 'Coordinate movement is currently verified only outside a conversation';
  if (typeof controller?.moveSpaceUserToTile !== 'function' || typeof user.position?.updatedCopy !== 'function' || typeof user.position?.hash !== 'function') return 'Gather movement or native Position type unavailable';
  if (controller.isMovementInterruptible !== true) return 'Gather is not accepting movement right now';
  if (!execute) return null;
  if (!Number.isSafeInteger(target.x) || !Number.isSafeInteger(target.y)) return 'Invalid destination coordinates';
  const current = user.position, x = current.x, y = current.y;
  if (x === target.x && y === target.y) return { started: false };
  const position = current.updatedCopy(target.x, target.y);
  if (!position || position === current || typeof position.hash !== 'function' || position.x !== target.x || position.y !== target.y || current.x !== x || current.y !== y) return 'Could not create an independent native Position';
  if (page.gatherDev?.MoveController !== controller || page.gatherDev?.Repos?.gameSpace !== game
    || !game.wsConnected || game.currentSpaceOrUndefined?.id !== expected.spaceId || game.currentSpaceUserOrUndefined !== user || user.id !== expected.selfId || user.floorId !== target.floorId
    || !Array.isArray(page.gatherDev.Repos.avConnections.stronglyConnectedSpaceUserIds) || page.gatherDev.Repos.avConnections.stronglyConnectedSpaceUserIds.length) return 'Gather state changed before movement';
  controller.moveSpaceUserToTile(position, target.floorId);
  return { started: true };
}

module.exports = { deskNavigation, deskContextMatches, deskButton, installObservedDeskAction, coordinateNavigation, observedManualAction, installObservedCoordinateActions, coordinateAction };

function resetsGatherDocument(details, url, isInPlace, isMainFrame) {
  const main = typeof details?.isMainFrame === 'boolean' ? details.isMainFrame : isMainFrame;
  if (!main) return false;
  const sameDocument = typeof details?.isSameDocument === 'boolean' ? details.isSameDocument : isInPlace;
  const target = details?.url ?? url;
  // Gather can update its route without replacing the page. Session identity is
  // still checked by every state read and immediately before/after navigation.
  if (sameDocument) {
    try { if (new URL(target).origin === 'https://app.v2.gather.town') return false; } catch { /* Unknown navigation invalidates the session. */ }
  }
  return true;
}

function movementInterruption(input) {
  if (input?.movement === true) return input.kind === 'dblclick' ? 'Map movement requested in Gather' : 'Movement key pressed in Gather';
  return null;
}
module.exports = { resetsGatherDocument, movementInterruption };

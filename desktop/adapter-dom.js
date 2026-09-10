/* This function is also evaluated in Electron's isolated world. Keep it self-contained. */
function inspectGather(document, profile, expected) {
  const result = { connected: false, spaceId: null, selfId: null, location: null, participants: null, deskVisitors: null, waves: null, mic: null, camera: null, canMove: false, errors: [] };
  if (!profile) { result.errors.push('No verified Gather profile'); return result; }
  const nodes = selector => [...document.querySelectorAll(selector)];
  const one = selector => { const matches = nodes(selector); if (matches.length !== 1) throw new Error('Selector must match exactly one element'); return matches[0]; };
  const read = spec => {
    if (!spec?.selector || !spec.attribute) throw new Error('Missing attribute reader');
    const value = one(spec.selector).getAttribute(spec.attribute);
    if (!value || value.length > 256) throw new Error('Missing or invalid attribute');
    return value;
  };
  const list = spec => {
    one(spec.container);
    const values = nodes(spec.selector).map(node => node.getAttribute(spec.idAttribute));
    if (values.some(value => !value || value.length > 256) || new Set(values).size !== values.length) throw new Error('Invalid participant identifiers');
    return values.filter(id => id !== expected.selfId);
  };
  const attempt = (name, action) => { try { result[name] = action(); } catch { result.errors.push(`${name} unavailable`); } };
  if (profile.session?.source !== 'gather-repos') {
    attempt('spaceId', () => read(profile.space));
    attempt('selfId', () => read(profile.self));
    attempt('connected', () => !!one(profile.connected) && result.spaceId === expected.spaceId && result.selfId === expected.selfId);
    attempt('participants', () => list(profile.participants));
  }
  if (profile.location?.source !== 'gather-repos') attempt('location', () => read(profile.location));
  if (profile.deskVisitors?.source !== 'gather-desk') attempt('deskVisitors', () => list(profile.deskVisitors));
  if (profile.waves?.source !== 'gather-events') attempt('waves', () => {
    one(profile.waves.container);
    return nodes(profile.waves.selector).filter(node => node.getAttribute(profile.waves.recipientAttribute) === expected.selfId).map(node => {
      const id = node.getAttribute(profile.waves.idAttribute), fromId = node.getAttribute(profile.waves.senderAttribute);
      if (!id || !fromId || id.length > 256 || fromId.length > 256) throw new Error('Invalid wave');
      return { id, fromId };
    });
  });
  for (const kind of ['mic', 'camera']) attempt(kind, () => {
    const spec = profile[kind];
    const value = one(spec.selector).getAttribute(spec.attribute);
    if (value === spec.on) return true;
    if (value === spec.off) return false;
    throw new Error('Unknown media state');
  });
  result.canMove = !!result.location && Object.values(profile.destinations || {}).length === 3 && Object.values(profile.destinations).every(selector => { try { return nodes(selector).length === 1; } catch { return false; } });
  return result;
}
if (typeof module !== 'undefined') module.exports = { inspectGather };

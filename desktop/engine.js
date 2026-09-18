const { randomUUID } = require('node:crypto');

class Engine {
  constructor(config = {}) {
    this.config = config;
    this.alerts = new Map();
    this.reset();
  }
  reset() {
    this.previous = null;
    this.owner = false;
    this.pendingMove = null;
    this.lastAutoLocation = null;
    this.aloneSince = null;
    this.remindSince = null;
    this.reminded = false;
    this.seenWaves = new Set();
    this.lastInteractionAt = 0;
    this.suspended = false;
  }
  cancelAll(reason = 'disconnected') {
    const effects = [...this.alerts.keys()].map(id => ({ type: 'cancel', id, reason }));
    this.alerts.clear();
    this.reset();
    return effects;
  }
  interact(now) {
    this.lastInteractionAt = Math.max(this.lastInteractionAt, now);
    const out = [];
    for (const [id, alert] of this.alerts) if (now >= alert.createdAt) { out.push({ type: 'cancel', id, reason: 'acknowledged' }); this.alerts.delete(id); }
    // Any physical movement interaction must not be mistaken for automatic navigation.
    return out;
  }
  acknowledge(id) {
    if (!this.alerts.delete(id)) return [];
    return [{ type: 'cancel', id, reason: 'acknowledged' }];
  }
  movementResult(success) {
    if (success) { this.owner = true; this.lastAutoLocation = this.pendingMove?.destination; }
    else { this.owner = false; this.suspended = true; }
    this.pendingMove = null;
  }
  manualMovement() { this.owner = false; this.pendingMove = null; this.suspended = true; }
  update(s, presence, now, enabled = true, allowMovement = true) {
    if (!enabled || !s?.connected || s.spaceId !== this.config.spaceId || s.selfId !== this.config.selfId) return this.cancelAll();
    const effects = [];
    const locations = this.config.locations || {};
    // Alarm policy can use verified profile positions before movement targets are captured.
    // Explicitly captured locations take precedence over older profile targets.
    const atLocation = (snapshot, key) => !!snapshot?.location && (locations[key]
      ? snapshot.location === locations[key] : snapshot.matchedDestination === key);
    const atBreak = atLocation(s, 'away');
    const atDesk = atLocation(s, 'available');
    const participantsKnown = Array.isArray(s.participants);
    const participants = s.participants || [];
    const prev = this.previous;
    const existingConversation = !!prev && Array.isArray(prev.participants) && prev.participants.length > 0 && !atLocation(prev, 'away');
    const visitors = new Set([...(s.deskVisitors || []).map(id => `desk:${id}`), ...participants.map(id => `avatar:${id}`)]);

    for (const [id, alert] of this.alerts) {
      const visitEnded = alert.visit && participantsKnown && Array.isArray(s.deskVisitors)
        && !participants.includes(alert.sourceId) && !s.deskVisitors.includes(alert.sourceId);
      if (now >= alert.expiresAt || visitEnded) {
        effects.push({ type: 'cancel', id, reason: now >= alert.expiresAt ? 'expired' : 'visitor-left' }); this.alerts.delete(id);
      }
    }
    const alert = (kind, sourceId, visit = null, createdAt = now) => {
      if (!Number.isSafeInteger(createdAt) || createdAt > now || now >= createdAt + 45000 || createdAt <= this.lastInteractionAt) return;
      if (existingConversation || !participantsKnown || !Array.isArray(prev?.participants)) return;
      const longAway = atBreak || presence === 'away';
      if (longAway && kind === 'visit') return;
      // Unknown presence is visible, but never represented as a reliable ringing decision.
      const mode = longAway || presence === 'unknown' ? 'notification' : 'ring';
      const event = { id: randomUUID(), kind, mode, sourceId, visit, createdAt, expiresAt: createdAt + 45000 };
      this.alerts.set(event.id, event); effects.push({ type: 'alert', ...event });
    };
    if (prev) {
      const oldVisitors = new Set([...(prev.deskVisitors || []).map(id => `desk:${id}`), ...(prev.participants || []).map(id => `avatar:${id}`)]);
      const previousVisitorIds = new Set([...(prev.deskVisitors || []), ...(prev.participants || [])]);
      const alerted = new Set();
      if (participantsKnown && Array.isArray(prev.participants)) {
        for (const visit of visitors) if (!oldVisitors.has(visit) && (visit.startsWith('avatar:') || (Array.isArray(s.deskVisitors) && Array.isArray(prev.deskVisitors)))) {
          const id = visit.slice(visit.indexOf(':') + 1);
          // A desk occupant becoming an avatar participant is the same ongoing visit.
          if (previousVisitorIds.has(id)) continue;
          const avatarVisit = visit.startsWith('avatar:');
          if ((atDesk || this.owner || presence === 'brief') && !alerted.has(id)) { alert('visit', id, avatarVisit ? visit : participants.includes(id) ? `avatar:${id}` : visit); alerted.add(id); }
        }
      }
      for (const wave of s.waves || []) if (Array.isArray(prev.waves) && !this.seenWaves.has(wave.id)) alert('wave', wave.fromId, null, wave.createdAt);
    }
    for (const wave of s.waves || []) this.seenWaves.add(wave.id);
    if (this.seenWaves.size > 2000) this.seenWaves = new Set([...this.seenWaves].slice(-1000));

    if (participantsKnown && participants.length === 0 && (s.mic === true || s.camera === true)) {
      this.aloneSince ??= now;
      if (now - this.aloneSince >= 10000) { effects.push({ type: 'disable-media', mic: s.mic === true, camera: s.camera === true }); this.aloneSince = now; }
    } else this.aloneSince = null;

    if (prev && s.location && prev.location && s.location !== prev.location && !this.pendingMove) {
      if (this.lastAutoLocation !== s.location) this.owner = false;
      this.lastAutoLocation = null;
    }
    if (atDesk && prev && prev.location !== s.location && !this.pendingMove) this.suspended = false;
    if (atBreak && !this.owner && presence === 'available') {
      this.remindSince ??= now;
      if (!this.reminded && now - this.remindSince >= 300000) {
        effects.push({ type: 'reminder', id: randomUUID(), kind: 'return-reminder', mode: 'notification', createdAt: now, expiresAt: now + 60000 }); this.reminded = true;
      }
    } else { this.remindSince = null; this.reminded = false; }

    const destination = locations[presence];
    const conversationProtected = !participantsKnown || (participants.length > 0 && !atBreak);
    if (allowMovement && prev && this.config.movementVerified && !this.suspended && destination && s.location && s.location !== destination && (atDesk || this.owner) && !conversationProtected && !this.pendingMove && s.canMove === true && (!s.movementCapabilities || s.movementCapabilities[presence] === true)) {
      this.pendingMove = { destination, startedAt: now };
      effects.push({ type: 'move', destination });
    }
    this.previous = structuredClone(s);
    return effects;
  }
}
module.exports = { Engine };

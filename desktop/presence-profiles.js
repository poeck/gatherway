const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Calibration } = require('./calibration');

const uncalibrated = () => ({ calibrated: false, dwellMs: 5000 });
function details(name, homeWifi) {
  if (typeof name !== 'string' || !name.trim() || name.length > 80 || typeof homeWifi !== 'string' || Buffer.byteLength(homeWifi, 'utf8') > 32 || /[\x00-\x1f]/.test(name + homeWifi)) throw new Error('Enter a profile name and a valid home Wi-Fi name (SSID)');
  return { name: name.trim(), homeWifi };
}
function thresholds(value) {
  if (!value?.calibrated) return uncalibrated();
  if (![value.near, value.far].every(n => Number.isFinite(n) && n >= -127 && n < 0) || value.near <= value.far || value.dwellMs !== 5000) throw new Error('Invalid saved thresholds');
  return { near: value.near, far: value.far, dwellMs: 5000, calibrated: true, ...(value.calibrationVersion === 2 ? { calibrationVersion: 2 } : {}) };
}

class PresenceProfiles {
  constructor(directory, beacon, legacyPresence) {
    this.file = path.join(directory, 'presence-profiles.json');
    this.device = crypto.createHash('sha256').update(beacon).digest('hex');
    this.status = 'Not saved'; this.last = null; this.blocked = false;
    this.profiles = [{ id: crypto.randomUUID(), name: 'Home', homeWifi: '', presence: thresholds(legacyPresence), calibration: new Calibration() }];
    this.activeId = this.profiles[0].id;
    try {
      if (fs.existsSync(this.file)) {
        if (fs.statSync(this.file).size > 4 * 1024 * 1024) throw new Error('Saved profiles are too large');
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (data.version !== 1 || data.device !== this.device || !Array.isArray(data.profiles) || !data.profiles.length || data.profiles.length > 20) throw new Error('Saved profiles are incompatible');
        const ids = new Set();
        const profiles = data.profiles.map(profile => {
          if (typeof profile.id !== 'string' || !/^[\w-]{1,80}$/.test(profile.id) || ids.has(profile.id)) throw new Error('Invalid profile identifier');
          ids.add(profile.id);
          return { id: profile.id, ...details(profile.name, profile.homeWifi), presence: thresholds(profile.presence), calibration: Calibration.restore(profile.measurements) };
        });
        if (!ids.has(data.activeId)) throw new Error('Missing active profile');
        this.profiles = profiles; this.activeId = data.activeId;
      }
    } catch {
      // Preserve unreadable/incompatible data rather than replacing it with an empty trial.
      this.blocked = true; this.status = 'Saved profiles could not be loaded. Existing file preserved; profile saving is unavailable.';
    }
    if (!this.blocked) this.checkpoint();
  }
  get active() { return this.profiles.find(profile => profile.id === this.activeId); }
  save() {
    if (this.blocked) throw new Error(this.status);
    const raw = JSON.stringify({ version: 1, device: this.device, activeId: this.activeId, profiles: this.profiles.map(profile => ({ id: profile.id, name: profile.name, homeWifi: profile.homeWifi, presence: profile.presence, measurements: profile.calibration.export() })) });
    if (raw === this.last) return;
    const temporary = this.file + '.' + crypto.randomUUID() + '.tmp';
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, raw); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, this.file); this.last = raw; this.status = 'Measurements saved locally';
    } catch {
      this.status = 'Could not save measurements. Keep the app open and check local storage.';
      throw new Error(this.status);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch {}
    }
  }
  checkpoint() { try { this.save(); } catch {} }
  create(name, homeWifi) {
    if (this.profiles.length >= 20) throw new Error('A maximum of 20 profiles is supported');
    const profile = { id: crypto.randomUUID(), ...details(name, homeWifi), presence: uncalibrated(), calibration: new Calibration() };
    this.active.calibration.stop(); this.profiles.push(profile); this.activeId = profile.id; this.save();
  }
  select(id) {
    if (!this.profiles.some(p => p.id === id)) throw new Error('Unknown presence profile');
    this.active.calibration.stop(); this.activeId = id; this.active.calibration.stop(); this.save();
  }
  edit(name, homeWifi) {
    const changes = details(name, homeWifi);
    if (this.active.homeWifi !== changes.homeWifi) {
      // Keep the measurements, but require an explicit recalculation and live check.
      this.active.presence = uncalibrated();
    }
    Object.assign(this.active, changes); this.save();
  }
  state() {
    return { activeId: this.activeId, status: this.status, profiles: this.profiles.map(p => ({ id: p.id, name: p.name, homeWifi: p.homeWifi, calibrated: p.presence.calibrated })) };
  }
}

function profileWifi(body, homeWifi) {
  if (!homeWifi || body.wifiTelemetryVersion !== 1) return 'unknown';
  if (typeof body.wifiSsid === 'string' && body.wifiSsid.length) return body.wifiSsid === homeWifi ? 'home' : 'away';
  return body.wifi === 'away' && body.wifiSsid === null ? 'away' : 'unknown';
}
module.exports = { PresenceProfiles, profileWifi };

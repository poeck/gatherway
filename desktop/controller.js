const path = require('node:path');
const crypto = require('node:crypto');
const { BrowserWindow, ipcMain, Notification, dialog } = require('electron');
const { Store } = require('./store');
const { Presence } = require('./presence');
const { calibrationIssue } = require('./calibration');
const { PresenceProfiles, profileWifi } = require('./presence-profiles');
const { Engine } = require('./engine');
const { Transport, tailnetAddress } = require('./transport');
const { Fcm } = require('./fcm');
const { BleScanner } = require('./ble');
const { GatherAdapter } = require('./adapter');
const { MobileDashboard } = require('./mobile-dashboard');
const { installObservedDeskAction, installObservedCoordinateActions } = require('./gather-navigation');
const { resetsGatherDocument, movementInterruption } = require('./navigation-lifecycle');

class Controller {
  constructor(app, win) {
    this.win = win; this.store = new Store(path.join(app.getPath('userData'), 'gatherway'));
    this.config = this.store.config; this.phone = null; this.snapshot = null; this.suspended = false;
    this.presenceProfiles = new PresenceProfiles(this.store.directory, this.config.beacon, this.config.presence);
    this.config.presence = { ...this.presenceProfiles.active.presence };
    this.config.movementVerified = false;
    this.presence = new Presence(this.config.presence); this.engine = new Engine(this.config);
    this.adapter = new GatherAdapter(win, this.config); this.fcm = new Fcm(this.config);
    this.availability = 'unknown'; this.override = null; this.calibration = this.presenceProfiles.active.calibration; this.testAlerts = new Map();
    this.ble = new BleScanner(this.config.beacon, (rssi, now) => {
      this.presence.observe(rssi, now); this.lastRssi = rssi; this.lastRssiAt = now;
      this.calibration.observe(rssi, now, this.calibrationIssue(now));
    }, healthy => { if (!healthy) this.calibration.invalidate('Bluetooth scanning unavailable'); });
    this.mobileDashboard = new MobileDashboard(this);
    this.ble.start(); this.startTransport();
    ipcMain.on('gatherway:interaction', (event, input) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !this.adapter.validOrigin()) return;
      this.effects(this.engine.interact(Date.now()));
      this.cancelTests();
      const interruption = movementInterruption(input);
      if (interruption) { this.adapter.invalidate(interruption); this.engine.manualMovement(); }
    });
    ipcMain.handle('gatherway:settings', async (event, command, payload) => {
      if (!this.settings || event.sender !== this.settings.webContents || event.senderFrame !== this.settings.webContents.mainFrame || !event.senderFrame.url.startsWith('file:')) throw new Error('Invalid sender');
      return this.command(command, payload);
    });
    this.timer = setInterval(() => {
      this.calibration.tick(Date.now(), this.calibrationIssue(Date.now()));
      this.presenceProfiles.checkpoint();
      this.tick();
    }, 1000);
    win.webContents.on('did-start-navigation', (details, url, isInPlace, isMainFrame) => {
      if (resetsGatherDocument(details, url, isInPlace, isMainFrame)) this.disconnect('Gather document navigation started');
    });
    win.webContents.on('render-process-gone', () => this.disconnect('Gather renderer stopped'));
  }
  get collecting() { return this.calibration.active; }
  activatePresenceProfile() {
    this.disconnect();
    this.calibration = this.presenceProfiles.active.calibration;
    this.config.presence = { ...this.presenceProfiles.active.presence };
    this.presence = new Presence(this.config.presence); this.override = null;
    this.config.movementVerified = false; this.testedDestinations = new Set();
    this.lastRssi = null; this.lastRssiAt = null;
    this.store.save();
  }
  calibrationIssue(now) {
    if (this.suspended || this.config.paused) return 'Desktop monitoring is paused';
    if (!this.presenceProfiles?.active.homeWifi) return 'Set the home Wi-Fi name for this profile';
    if (this.phone && this.phone.wifiTelemetryVersion !== 1) return 'Update the phone companion for presence profiles';
    return calibrationIssue(this.phone, this.ble.healthy, now);
  }
  startTransport() {
    this.transport = new Transport(this.config, body => {
      this.phone = { wifi: profileWifi(body, this.presenceProfiles.active.homeWifi), wifiTelemetryVersion: body.wifiTelemetryVersion, bluetooth: body.bluetooth, serviceRunning: body.serviceRunning, receivedAt: Date.now(), fcmToken: body.fcmToken || null };
      const issue = this.calibrationIssue(Date.now());
      if (issue) this.calibration.invalidate(issue);
      for (const id of body.acks) {
        this.effects(this.engine.acknowledge(id));
        if (this.testAlerts.delete(id)) this.effects([{ type: 'cancel', id, reason: 'acknowledged' }]);
      }
      this.mobileDashboard.accept(body.command);
      return { working: !this.suspended && !this.config.paused && (!!this.collecting || (!!this.snapshot?.connected && this.config.adapterVerified)), paused: this.config.paused, availability: this.availability, dashboard: this.mobileDashboard.state(), presenceProfile: { name: this.presenceProfiles.active.name, homeWifi: this.presenceProfiles.active.homeWifi } };
    }, () => this.store.log('transport-unavailable'));
    this.transport.start();
  }
  async tick() {
    if (this.ticking || this.suspended || this.win.isDestroyed()) return;
    this.ticking = true;
    const generation = this.adapter.generation;
    try {
      const snapshot = await this.adapter.snapshot();
      if (generation !== this.adapter.generation || this.suspended) return;
      this.snapshot = snapshot;
      this.snapshotAt = Date.now();
      for (const [id, expiry] of this.testAlerts) if (Date.now() >= expiry) { this.testAlerts.delete(id); this.effects([{ type: 'cancel', id, reason: 'expired' }]); }
      this.availability = this.override || this.presence.update(this.phone, this.ble.healthy, Date.now());
      const phoneFresh = this.phone && Date.now() - this.phone.receivedAt <= 10000;
      const enabled = !this.config.paused && this.config.adapterVerified;
      // A fresh baseline is required after reconnect. Media safety can still operate without the phone.
      const classification = phoneFresh || this.override ? this.availability : 'unknown';
      this.effects(this.engine.update(this.snapshot, classification, Date.now(), enabled, !this.mobileDashboard.moving));
      this.mobileDashboard.observe(Date.now());
    } catch { if (generation === this.adapter.generation) { this.snapshot = null; this.effects(this.engine.cancelAll()); } }
    finally { this.ticking = false; }
  }
  effects(effects) {
    for (const effect of effects) {
      if (['alert', 'cancel', 'reminder'].includes(effect.type)) {
        this.transport.queue(effect);
        this.fcm.send(effect, this.phone?.fcmToken).then(ok => { if (!ok) this.store.log('fcm-unavailable'); });
      }
      if (effect.type === 'reminder' && Notification.isSupported()) new Notification({ title: 'Still on a break?', body: 'You have been near your laptop for five minutes. Return to your Gather desk when ready.' }).show();
      if (effect.type === 'move') {
        const generation = this.adapter.generation;
        this.adapter.move(effect.destination).then(success => {
          if (generation !== this.adapter.generation) return;
          this.engine.movementResult(success);
          if (!success) { this.config.movementVerified = false; this.store.save(); this.store.log('movement-not-confirmed'); }
        });
      }
      if (effect.type === 'disable-media' && !this.disablingMedia) {
        this.disablingMedia = true;
        this.adapter.disableMedia(effect).catch(() => this.store.log('media-disable-not-confirmed')).finally(() => { this.disablingMedia = false; });
      }
    }
  }
  cancelTests() { for (const id of this.testAlerts.keys()) this.effects([{ type: 'cancel', id, reason: 'acknowledged' }]); this.testAlerts.clear(); }
  disconnect(reason = 'Desktop session reset') { this.adapter.disconnect(reason); this.mobileDashboard?.reset(); this.effects(this.engine.cancelAll()); this.cancelTests(); this.presence.reset(); this.calibration.stop('Connection changed; resume collection when ready'); this.presenceProfiles?.checkpoint(); this.phone = null; this.snapshot = null; this.availability = 'unknown'; }
  suspend() { this.suspended = true; this.disconnect('Laptop suspended'); }
  resume() { this.disconnect(); this.suspended = false; }
  showSettings() {
    if (this.settings && !this.settings.isDestroyed()) { this.settings.show(); this.settings.focus(); return; }
    this.settings = new BrowserWindow({ width: 960, height: 880, title: 'Gatherway Settings', webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    this.settings.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.settings.webContents.on('will-navigate', event => event.preventDefault());
    this.settings.loadFile(path.join(__dirname, 'settings.html'));
    this.settings.on('closed', () => { this.settings = null; });
  }
  state() {
    return {
      config: { ...this.config, key: undefined, firebasePath: undefined }, firebaseConfigured: !!this.config.firebasePath,
      phone: this.phone ? { ...this.phone, fcmToken: undefined } : null,
      snapshot: this.snapshot, navigation: this.adapter.lastMovement || null, availability: this.availability, automatic: this.engine.owner, override: this.override,
      transport: this.transport.status, bluetooth: this.ble.status, fcm: this.fcm.status,
      lastRssi: Date.now() - this.lastRssiAt < 5000 ? this.lastRssi : null,
      collecting: this.collecting, calibration: this.calibration.state(Date.now()),
      presenceProfiles: this.presenceProfiles.state(),
    };
  }
  async command(command, payload) {
    switch (command) {
      case 'state': return this.state();
      case 'save': {
        if (!tailnetAddress(payload?.host) || typeof payload.spaceId !== 'string' || typeof payload.selfId !== 'string' || payload.spaceId.length > 256 || payload.selfId.length > 256) throw new Error('Enter a Tailscale IPv4 address and valid Gather identifiers');
        this.disconnect();
        const identityChanged = payload.spaceId !== this.config.spaceId || payload.selfId !== this.config.selfId;
        Object.assign(this.config, { host: payload.host, spaceId: payload.spaceId, selfId: payload.selfId });
        if (identityChanged) { this.config.adapterVerified = false; this.config.movementVerified = false; this.config.locations = {}; }
        this.store.save(); await this.transport.close(); this.startTransport(); break;
      }
      case 'pause': this.config.paused = !this.config.paused; this.disconnect(); this.store.save(); break;
      case 'override':
        if (![null, 'available', 'brief', 'away'].includes(payload)) throw new Error('Invalid override');
        this.override = payload; break;
      case 'pairing':
        if (!tailnetAddress(this.config.host)) throw new Error('Save the laptop Tailscale address first');
        return JSON.stringify({ v: 1, endpoint: `http://${this.config.host}:${this.config.port}`, key: this.config.key, beacon: this.config.beacon });
      case 'rotate-pairing':
        this.disconnect(); this.config.key = crypto.randomBytes(32).toString('base64'); this.store.save(); break;
      case 'firebase': {
        const chosen = await dialog.showOpenDialog(this.settings, { title: 'Select Firebase service-account JSON', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (!chosen.canceled) { this.config.firebasePath = chosen.filePaths[0]; this.fcm.access = null; this.store.save(); } break;
      }
      case 'profile': {
        if (typeof payload !== 'string' || payload.length > 32000) throw new Error('Invalid profile');
        const profile = JSON.parse(payload);
        if (profile.version !== 1 || typeof profile.destinations !== 'object') throw new Error('Profile must use version 1 and include destinations');
        this.disconnect(); this.testedDestinations = new Set(); this.config.profile = profile; this.config.adapterVerified = false; this.config.movementVerified = false; this.store.save(); break;
      }
      case 'verify-adapter':
        this.snapshot = await this.adapter.snapshot();
        if (!this.snapshot.connected || this.snapshot.errors.length) throw new Error('All signals must be readable before recording verification');
        this.config.adapterVerified = true; this.store.save(); this.engine.reset(); break;
      case 'capture':
        if (!['available', 'brief', 'away'].includes(payload)) throw new Error('Invalid location');
        this.snapshot = await this.adapter.snapshot();
        if (!this.snapshot.connected || !this.snapshot.location) throw new Error('Gather location is unavailable');
        this.config.locations[payload] = this.snapshot.location; this.config.movementVerified = false; this.store.save(); break;
      case 'setup-desk-action':
        this.disconnect(); installObservedDeskAction(this.config); this.testedDestinations = new Set(); this.store.save(); break;
      case 'setup-coordinate-actions':
        this.disconnect(); installObservedCoordinateActions(this.config); this.testedDestinations = new Set(); this.store.save(); break;
      case 'test-destination': {
        const destination = this.config.locations[payload];
        if (!this.config.adapterVerified || !destination) throw new Error('Verify the adapter and capture this destination first');
        const before = await this.adapter.snapshot();
        if (!before.connected || !before.location || before.location === destination) throw new Error('Move away from this destination before testing its return action');
        this.engine.manualMovement();
        if (!await this.adapter.move(destination)) throw new Error(this.adapter.lastMovement?.reason || 'Movement did not reach the saved destination');
        this.testedDestinations ??= new Set(); this.testedDestinations.add(destination); break;
      }
      case 'enable-movement':
        if (!this.config.presence.calibrated || !this.config.adapterVerified || new Set(Object.values(this.config.locations)).size !== 3 || !Object.values(this.config.locations).every(id => this.testedDestinations?.has(id))) throw new Error('Calibrate and successfully test all three distinct destinations first');
        this.config.movementVerified = true; this.store.save(); break;
      case 'collect':
        if (!['near', 'far', null].includes(payload)) throw new Error('Invalid calibration step');
        if (payload) {
          if (this.suspended || this.config.paused) throw new Error('Resume desktop monitoring first');
          this.calibration.start(payload, Date.now());
          this.config.movementVerified = false; this.store.save();
        } else this.calibration.stop();
        this.presenceProfiles?.save();
        break;
      case 'reset-calibration': this.calibration.resetGroup(payload); this.presenceProfiles?.save(); break;
      case 'create-presence-profile':
      case 'select-presence-profile':
      case 'edit-presence-profile': {
        // Stop old automation before changing the environment, including on a save failure.
        this.disconnect(); this.config.movementVerified = false;
        try {
          if (command === 'create-presence-profile') this.presenceProfiles.create(payload?.name, payload?.homeWifi);
          else if (command === 'select-presence-profile') this.presenceProfiles.select(payload);
          else this.presenceProfiles.edit(payload?.name, payload?.homeWifi);
        } finally { this.activatePresenceProfile(); }
        break;
      }
      case 'calibrate': {
        const result = this.calibration.calculate();
        if (this.presenceProfiles) { this.presenceProfiles.active.presence = result; this.presenceProfiles.save(); }
        this.config.presence = result; this.presence = new Presence(result); this.config.movementVerified = false; this.store.save(); break;
      }
      case 'test-alert': {
        const now = Date.now(), id = crypto.randomUUID(); this.testAlerts.set(id, now + 45000); this.effects([{ type: 'alert', id, kind: 'test', mode: 'ring', createdAt: now, expiresAt: now + 45000 }]); break;
      }
      case 'devtools': this.win.webContents.openDevTools({ mode: 'detach' }); break;
      default: throw new Error('Unknown settings action');
    }
    return this.state();
  }
  close() { clearInterval(this.timer); this.disconnect(); this.ble.stop(); this.transport.close(); this.settings?.close(); ipcMain.removeHandler('gatherway:settings'); ipcMain.removeAllListeners('gatherway:interaction'); }
}
module.exports = { Controller };

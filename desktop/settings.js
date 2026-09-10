const $ = id => document.getElementById(id);
let initialized = false;
let profileFormKey = null;
async function command(name, payload) {
  $('error').textContent = '';
  try { const result = await window.gatherway.command(name, payload); if (result?.config) render(result); return result; }
  catch (error) { $('error').textContent = error.message; return null; }
}
function render(state) {
  if (!initialized) { for (const key of ['host', 'spaceId', 'selfId']) $(key).value = state.config[key]; if (state.config.profile) $('profile').value = JSON.stringify(state.config.profile, null, 2); initialized = true; }
  $('pause').textContent = state.config.paused ? 'Resume' : 'Pause';
  $('status').textContent = `Availability: ${state.availability}\nPosition control: ${state.automatic ? 'Automatic' : 'Manual'}\n${state.transport}\nBluetooth: ${state.bluetooth}\nFCM: ${state.fcm}\nPhone: ${state.phone ? `${Math.floor((Date.now() - state.phone.receivedAt) / 1000)}s ago · Wi-Fi ${state.phone.wifi}` : 'Not connected'}\nAdapter: ${state.config.adapterVerified ? 'Verification recorded' : 'Not verified'}\nMovement: ${state.config.movementVerified ? 'Enabled' : 'Disabled'}`;
  $('capabilities').textContent = JSON.stringify(state.snapshot, null, 2);
  const calibration = state.calibration;
  if (state.presenceProfiles) {
    const profiles = state.presenceProfiles;
    $('presenceProfile').replaceChildren(...profiles.profiles.map(profile => {
      const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.name;
      option.selected = profile.id === profiles.activeId; return option;
    }));
    const active = profiles.profiles.find(profile => profile.id === profiles.activeId);
    const key = JSON.stringify([active.id, active.name, active.homeWifi]);
    if (key !== profileFormKey) {
      $('presenceProfileName').value = active.name; $('presenceProfileWifi').value = active.homeWifi;
      $('trial').checked = false; profileFormKey = key;
    }
    $('profileStorage').textContent = profiles.status;
  }
  const lines = Object.entries(calibration.groups).map(([key, group]) => `${key === 'near' ? 'Your room' : 'Other rooms'}: ${group.validSeconds}/${calibration.requiredSeconds}s valid · ${group.samples} samples · Signal available ${group.signalPercent}% · No signal ${group.noSignalSeconds}s`);
  if (calibration.comparison?.complete) {
    const comparison = calibration.comparison;
    lines.push(`Signal comparison: weaker in-room ${comparison.nearWeak ?? 'unavailable'} dBm · stronger other-room ${comparison.farStrong === null ? 'No received signal' : `${comparison.farStrong} dBm`}`);
    if (comparison.margin !== null) lines.push(`Separation: ${comparison.margin} dB · Required: ${comparison.requiredMargin} dB`);
  }
  lines.push(`RSSI: ${state.lastRssi ?? 'No recent signal'} · ${calibration.message}${calibration.countdownSeconds ? ` — starts in ${calibration.countdownSeconds}s` : ''}`);
  $('samples').textContent = lines.join('\n');
  for (const [key, id, label] of [['near', 'collectNear', 'your room'], ['far', 'collectFar', 'other rooms']]) {
    const group = calibration.groups[key];
    $(id).textContent = `${group.complete ? 'Completed' : group.validSeconds ? 'Resume' : 'Record'} ${label}`;
    $(id).disabled = !!calibration.active || group.complete;
  }
  $('stopCollect').disabled = !calibration.active;
  $('resetNear').disabled = $('resetFar').disabled = !!calibration.active;
  $('calibrate').disabled = !!calibration.active || !Object.values(calibration.groups).every(group => group.complete);
  $('thresholds').textContent = state.config.presence.calibrated ? `Saved thresholds: Available at ${state.config.presence.near} dBm or stronger; leave proximity at ${state.config.presence.far} dBm or weaker, or after sustained reception loss. Real room transitions must still be verified.` : 'No thresholds saved. Automatic movement remains disabled until calibration and real-world checks pass.';
}
$('save').onclick = () => command('save', Object.fromEntries(['host', 'spaceId', 'selfId'].map(key => [key, $(key).value.trim()])));
$('pause').onclick = () => command('pause');
$('override').onchange = () => command('override', $('override').value || null);
$('pairing').onclick = async () => { const code = await command('pairing'); if (code) { $('pairingCode').hidden = false; $('pairingCode').value = code; } };
$('rotate').onclick = async () => { await command('rotate-pairing'); $('pairingCode').value = ''; $('pairingCode').hidden = true; };
$('firebase').onclick = () => command('firebase');
$('testAlert').onclick = () => command('test-alert');
$('saveProfile').onclick = () => command('profile', $('profile').value);
$('devtools').onclick = () => command('devtools');
$('verifyAdapter').onclick = () => $('observed').checked ? command('verify-adapter') : $('error').textContent = 'Complete the real-client checks first.';
for (const [key, label] of [['available', 'Own desk'], ['brief', 'Brief absence'], ['away', 'Break room']]) {
  const row = document.createElement('div'); row.className = 'location';
  const title = document.createElement('strong'); title.textContent = label + ' '; row.append(title);
  for (const [action, text] of [['capture', 'Capture current location'], ['test-destination', 'Test destination']]) { const button = document.createElement('button'); button.textContent = text; button.onclick = () => command(action, key); row.append(button); }
  $('locations').append(row);
}
$('collectNear').onclick = () => command('collect', 'near'); $('collectFar').onclick = () => command('collect', 'far'); $('stopCollect').onclick = () => command('collect', null); $('calibrate').onclick = () => command('calibrate');
$('resetNear').onclick = () => command('reset-calibration', 'near'); $('resetFar').onclick = () => command('reset-calibration', 'far');
$('presenceProfile').onchange = () => command('select-presence-profile', $('presenceProfile').value);
const presenceProfileDetails = () => ({ name: $('presenceProfileName').value.trim(), homeWifi: $('presenceProfileWifi').value });
$('savePresenceProfile').onclick = () => command('edit-presence-profile', presenceProfileDetails());
$('createPresenceProfile').onclick = () => command('create-presence-profile', presenceProfileDetails());
$('enableMovement').onclick = () => $('trial').checked ? command('enable-movement') : $('error').textContent = 'Complete the real-world transition trial first.';
command('state'); setInterval(() => window.gatherway.command('state').then(render).catch(() => {}), 2000);

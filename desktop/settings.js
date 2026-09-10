const $ = id => document.getElementById(id);
let initialized = false;
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
  $('samples').textContent = `At desk: ${state.samples.near} samples · Other room: ${state.samples.far} samples · RSSI: ${state.lastRssi ?? 'unavailable'} · Collecting: ${state.collecting || 'stopped'}`;
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
$('enableMovement').onclick = () => $('trial').checked ? command('enable-movement') : $('error').textContent = 'Complete the real-world transition trial first.';
command('state'); setInterval(() => window.gatherway.command('state').then(render).catch(() => {}), 2000);

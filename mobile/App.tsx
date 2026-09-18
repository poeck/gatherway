import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, PermissionsAndroid, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

type Destination = 'available' | 'brief' | 'away';
type Dashboard = {
  version: number; session: string; position: string; availability: string; override: string | null;
  presenceIssue: string | null; candidate: string | null; candidateSeconds: number;
  rssi: number | null; medianRssi: number | null; bluetooth: string; wifi: string;
  automatic: boolean; movementEnabled: boolean; paused: boolean; participants: number | null;
  moves: Record<Destination, string | null>; command: { status: string; message: string } | null;
  history: { at: number; availability: string; position: string; override: boolean }[];
};
const positions: Record<string, string> = { available: 'At your desk', brief: 'Stepped away', away: 'In the break room', elsewhere: 'Elsewhere in Gather', unknown: 'Position unavailable' };
const availability: Record<string, string> = { available: 'In your room', brief: 'Elsewhere at home', away: 'Away from home', unknown: 'Presence unknown' };
const targets: [Destination, string][] = [['available', 'Go to desk'], ['brief', 'Step away'], ['away', 'Go to break room']];
type Status = { dashboard?: string; exchangeAgeMs: number | null; commandPending: boolean; commandMessage?: string; paired: boolean; running: boolean; advertising: boolean; working: boolean; connection: string; wifi: string; currentSsid?: string; homeWifi?: string; profileName?: string; notifications: boolean; fullScreen: boolean; fcmReady: boolean; lastExchange: number };
const companion = requireNativeModule<{ configure(value: string): Promise<void>; start(): Promise<void>; stop(): Promise<void>; move(destination: Destination): Promise<void>; status(): Promise<Status>; fullScreenSettings(): Promise<void>; notificationSettings(): Promise<void> }>('GatherwayCompanion');
const Button = ({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) => <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} style={[styles.button, secondary && styles.secondaryButton, disabled && styles.disabled]} onPress={onPress}><Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{title}</Text></TouchableOpacity>;

export default function App() {
  const [status, setStatus] = useState<Status>();
  const [page, setPage] = useState<'home' | 'settings'>('home');
  const [updatedAt, setUpdatedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page === 'settings') { setPage('home'); return true; }
      return false;
    });
    return () => back.remove();
  }, [page]);
  const [pairing, setPairing] = useState('');
  const [homeWifi, setHomeWifi] = useState('');
  const [firebase, setFirebase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => companion.status().then(value => { if (active) { setStatus(value); setUpdatedAt(Date.now()); } }).catch(() => { if (active) setError('Could not read companion status.'); });
    refresh(); const timer = setInterval(() => { setNow(Date.now()); refresh(); }, 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  let dashboard: Dashboard | null = null;
  try { const parsed = JSON.parse(status?.dashboard || 'null'); if (parsed?.version === 1) dashboard = parsed; } catch { /* Wait for a compatible desktop response. */ }
  const age = status?.exchangeAgeMs == null ? null : status.exchangeAgeMs + Math.max(0, now - updatedAt);
  const fresh = !!status?.running && age !== null && age < 10000;
  const live = fresh ? dashboard : null;
  const positionLabel = positions[live?.position || 'unknown'] || positions.unknown;
  const presenceLabel = availability[live?.availability || 'unknown'] || availability.unknown;
  const sharedMoveReason = !live ? 'Waiting for current laptop data' : targets.every(([key]) => live.moves[key] === live.moves.available) ? live.moves.available : null;
  const signal = (value?: number | null) => value == null ? 'No recent signal' : `${value} dBm`;

  async function action(fn: () => Promise<unknown>) { setError(''); setBusy(true); try { await fn(); setStatus(await companion.status()); setUpdatedAt(Date.now()); } catch (error) { setError(error instanceof Error ? error.message : 'Action failed'); } finally { setBusy(false); } }
  async function permissions() {
    const permissions = [PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION, PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    if (Number(Platform.Version) >= 33) permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES);
    const result = await PermissionsAndroid.requestMultiple(permissions);
    if (Object.values(result).some(value => value !== 'granted')) setError('Some permissions are missing. Check Android app settings before testing.');
  }
  async function save() {
    const value = JSON.parse(pairing);
    const google = JSON.parse(firebase);
    const client = google.client?.find((entry: any) => entry.client_info?.android_client_info?.package_name === 'com.gatherway.companion');
    if (!client) throw new Error('Firebase Android configuration must use com.gatherway.companion. Paste google-services.json, not a service-account key.');
    if (!homeWifi.trim()) throw new Error('Enter your home Wi-Fi name.');
    await companion.configure(JSON.stringify({ ...value, homeWifi: homeWifi.trim(), firebase: { appId: client.client_info.mobilesdk_app_id, apiKey: client.api_key[0].current_key, projectId: google.project_info.project_id, senderId: google.project_info.project_number } }));
    setPairing(''); setFirebase('');
  }
  return <ScrollView key={page} style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.nav}><Text style={styles.brand}>GATHERWAY</Text><Button title={page === 'home' ? 'Settings' : 'Back to home'} secondary onPress={() => setPage(page === 'home' ? 'settings' : 'home')} /></View>
    <Text style={styles.title}>{page === 'home' ? 'Your office,\nwithin reach.' : 'Settings'}</Text>
    <Text style={styles.subtitle}>{page === 'home' ? status?.profileName || 'Your everyday companion' : 'Device permissions and laptop pairing.'}</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}{busy && <ActivityIndicator color="#afe9ca" />}
    {page === 'home' ? <>
      <View style={styles.control}><Text style={styles.status}>{status?.running ? 'Companion on' : 'Companion off'}</Text><Button secondary disabled={busy || (!status?.paired && !status?.running)} title={status?.running ? 'Stop companion' : 'Start companion'} onPress={() => action(() => status?.running ? companion.stop() : companion.start())} /></View>
      {!status?.paired && <Button title="Set up your companion" onPress={() => setPage('settings')} />}
      <View style={styles.hero}><Text style={styles.eyebrow}>GATHER POSITION</Text><Text style={styles.position}>{positionLabel}</Text><Text style={styles.body}>{live ? `${live.automatic ? 'Automatic' : 'Manual'} position control` : status?.running ? 'Waiting for current laptop data' : 'Start the companion to see your position'}</Text>
        {live?.participants != null && <Text style={styles.note}>{live.participants ? `In conversation with ${live.participants} ${live.participants === 1 ? 'person' : 'people'}` : 'No active conversation'}</Text>}
      </View>
      <View style={styles.card}><Text style={styles.eyebrow}>REAL-WORLD PRESENCE</Text><Text style={styles.heading}>{presenceLabel}</Text>
        {live?.override && <Text style={styles.warning}>Manual override is active on the laptop. This is not a sensor reading.</Text>}
        {!!live?.presenceIssue && <Text style={styles.warning}>{live.presenceIssue}</Text>}
        {!!live?.candidate && <Text style={styles.status}>Checking: {availability[live.candidate] || live.candidate} · {live.candidateSeconds}s remaining</Text>}
        <Text style={styles.body}>BLE signal: {signal(live?.rssi)}{'\n'}Smoothed signal: {signal(live?.medianRssi)}</Text>
        <Text style={styles.note}>Presence describes where your phone is. Gather position describes where your avatar is.</Text>
      </View>
      <View style={styles.card}><Text style={styles.heading}>Move in Gather</Text><Text style={styles.note}>Choose a destination manually. This can leave your current conversation.</Text>
        {targets.map(([key, title]) => {
          const reason = !live ? 'Waiting for current laptop data' : live.moves[key];
          return <View key={key}><Button title={title} disabled={busy || !!reason || !!status?.commandPending || live?.command?.status === 'moving'} onPress={() => action(() => companion.move(key))} />{!!reason && !sharedMoveReason && <Text style={styles.note}>{reason}</Text>}</View>;
        })}
        {!!sharedMoveReason && <Text style={styles.warning}>{sharedMoveReason}</Text>}
        {!!(status?.commandMessage || live?.command?.message) && <Text accessibilityLiveRegion="polite" style={styles.status}>{status?.commandMessage || live?.command?.message}</Text>}
      </View>
      <View style={styles.card}><Text style={styles.heading}>Recent changes</Text><Text style={styles.note}>Latest 12 changes from this desktop session. Use these timestamps to check room transitions.</Text>
        {!fresh && <Text style={styles.warning}>Connection is not current. Entries below are historical.</Text>}
        {dashboard?.history?.length ? dashboard.history.map((entry, index) => <View key={`${entry.at}-${index}`} style={styles.historyRow}><Text style={styles.time}>{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Text><Text style={[styles.body, { flex: 1 }]}>{availability[entry.availability] || 'Unknown'}{entry.override ? ' · override' : ''}{'\n'}<Text style={styles.note}>{positions[entry.position] || 'Position unavailable'}</Text></Text></View>) : <Text style={styles.body}>Changes will appear here when the laptop connects.</Text>}
      </View>
      <View style={styles.card}><Text style={styles.heading}>Companion status</Text><Text style={styles.status}>{status?.connection || 'Loading…'}</Text>
        <Text style={styles.body}>Last laptop update: {age == null ? 'Not received' : `${Math.floor(age / 1000)}s ago`}{'\n'}Profile: {status?.profileName || 'Not selected'}{'\n'}Home Wi-Fi: {status?.wifi || 'Unknown'}{'\n'}Laptop Wi-Fi classification: {live?.wifi || 'Unknown'}{'\n'}BLE advertising: {status?.advertising ? 'Active' : 'Inactive'}{'\n'}Laptop Bluetooth: {live?.bluetooth || 'Unavailable'}{'\n'}Automatic movement: {live ? live.movementEnabled ? 'Enabled' : 'Disabled' : 'Unknown'}{'\n'}Pairing: {status?.paired ? 'Ready' : 'Required'}{'\n'}FCM token: {status?.fcmReady ? 'Ready' : 'Missing'}{'\n'}Notifications: {status?.notifications ? 'Allowed' : 'Permission required'}{'\n'}Full-screen requests: {status?.fullScreen ? 'Allowed' : 'Permission required'}</Text>
        {fresh && !dashboard && <Text style={styles.warning}>Restart the updated desktop client to enable the dashboard.</Text>}
      </View>
    </> : <>
    <View style={styles.card}><Text style={styles.heading}>1. Allow device features</Text><Text style={styles.body}>Bluetooth advertises your proximity. Wi-Fi information distinguishes home from away. Notifications deliver conversation requests.</Text><Button title="Grant permissions" onPress={() => action(permissions)} /><Button title="Full-screen notification settings" onPress={() => action(() => companion.fullScreenSettings())} /><Button title="Notification settings" onPress={() => action(() => companion.notificationSettings())} /></View>
    <View style={styles.card}><Text style={styles.heading}>2. Pair with your laptop</Text><Text style={styles.body}>Open Gatherway Settings on your laptop with Ctrl+Shift+G. Copy its private pairing code here.</Text><TextInput accessibilityLabel="Private pairing code" placeholder="Pairing JSON" placeholderTextColor="#82998b" style={styles.input} value={pairing} onChangeText={setPairing} multiline autoCorrect={false} autoCapitalize="none" />
      <TextInput accessibilityLabel="Home Wi-Fi name" placeholder={status?.homeWifi || 'Home Wi-Fi name'} placeholderTextColor="#82998b" style={styles.input} value={homeWifi} onChangeText={setHomeWifi} autoCapitalize="none" /><Button title="Use current Wi-Fi name" onPress={() => status?.currentSsid ? setHomeWifi(status.currentSsid) : Alert.alert('Wi-Fi unavailable', 'Connect to home Wi-Fi, enable location services, and grant location permission.')} />
      <Text style={styles.body}>Paste the Firebase Android app configuration (google-services.json). Keep the Firebase service-account key on your laptop.</Text><TextInput accessibilityLabel="Firebase Android configuration" placeholder="google-services.json contents" placeholderTextColor="#82998b" style={styles.input} value={firebase} onChangeText={setFirebase} multiline autoCorrect={false} autoCapitalize="none" /><Button title="Save pairing and Firebase configuration" onPress={() => action(save)} /></View>
    <View style={styles.card}><Text style={styles.heading}>3. Test before enabling</Text><Text style={styles.body}>Start the companion, then send a test call alert from your laptop. Lock your phone and repeat. Calibrate desk and other-room proximity in the desktop settings before enabling movement.</Text><Text style={styles.note}>Calls ring for at most 45 seconds and respect silent mode and Do Not Disturb. Tap Acknowledge or interact with Gather to stop ringing.</Text></View>
    </>}
  </ScrollView>;

}
const styles = StyleSheet.create({
  nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  control: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  hero: { backgroundColor: '#223a30', borderColor: '#547660', borderWidth: 1, borderRadius: 20, padding: 22, marginVertical: 12 },
  eyebrow: { color: '#a0c7b1', fontSize: 11, letterSpacing: 2, marginBottom: 12 },
  position: { color: '#edf5f1', fontSize: 30, fontWeight: '600', marginBottom: 12 },
  warning: { color: '#ead0a0', fontSize: 13, lineHeight: 20, marginBottom: 10 },
  secondaryButton: { backgroundColor: '#263c31', borderWidth: 1, borderColor: '#456353' },
  secondaryButtonText: { color: '#d7ecdf' },
  disabled: { opacity: 0.4 },
  historyRow: { flexDirection: 'row', gap: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#31423a' },
  time: { color: '#91d5b4', fontSize: 12, paddingTop: 4, fontVariant: ['tabular-nums'] },
 page: { flex: 1, backgroundColor: '#101716' }, content: { padding: 24, paddingTop: 64, paddingBottom: 60 }, brand: { color: '#91d5b4', letterSpacing: 3, fontSize: 12, marginBottom: 18 }, title: { color: '#edf5f1', fontSize: 38, fontWeight: '700', letterSpacing: -1.5 }, subtitle: { color: '#a8bcb1', fontSize: 16, lineHeight: 25, marginVertical: 18 }, card: { backgroundColor: '#1a2420', borderColor: '#31423a', borderWidth: 1, borderRadius: 18, padding: 20, marginVertical: 8 }, heading: { color: '#edf5f1', fontSize: 20, fontWeight: '600', marginBottom: 14 }, status: { color: '#afe9ca', fontSize: 16, marginBottom: 10 }, body: { color: '#cbdad2', fontSize: 15, lineHeight: 24, marginBottom: 10 }, note: { color: '#a8bcb1', fontSize: 13, lineHeight: 21, marginTop: 12 }, button: { backgroundColor: '#afe9ca', borderRadius: 10, padding: 14, marginVertical: 6 }, buttonText: { color: '#14291f', fontSize: 15, fontWeight: '600', textAlign: 'center' }, input: { backgroundColor: '#101716', borderColor: '#456353', borderWidth: 1, borderRadius: 9, padding: 12, color: '#fff', minHeight: 52, marginVertical: 8 }, error: { color: '#ffc1b4', lineHeight: 22, paddingVertical: 12 } });

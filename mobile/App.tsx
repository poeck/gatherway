import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, PermissionsAndroid, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

type Status = { paired: boolean; running: boolean; advertising: boolean; working: boolean; connection: string; wifi: string; currentSsid?: string; homeWifi?: string; profileName?: string; notifications: boolean; fullScreen: boolean; fcmReady: boolean; lastExchange: number };
const companion = requireNativeModule<{ configure(value: string): Promise<void>; start(): Promise<void>; stop(): Promise<void>; status(): Promise<Status>; fullScreenSettings(): Promise<void>; notificationSettings(): Promise<void> }>('GatherwayCompanion');
const Button = ({ title, onPress }: { title: string; onPress: () => void }) => <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={onPress}><Text style={styles.buttonText}>{title}</Text></TouchableOpacity>;

export default function App() {
  const [status, setStatus] = useState<Status>();
  const [pairing, setPairing] = useState('');
  const [homeWifi, setHomeWifi] = useState('');
  const [firebase, setFirebase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const refresh = () => companion.status().then(setStatus).catch(() => setError('Could not read companion status.')); refresh(); const timer = setInterval(refresh, 2000); return () => clearInterval(timer); }, []);
  async function action(fn: () => Promise<unknown>) { setError(''); setBusy(true); try { await fn(); setStatus(await companion.status()); } catch (error) { setError(error instanceof Error ? error.message : 'Action failed'); } finally { setBusy(false); } }
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
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.brand}>GATHERWAY</Text><Text style={styles.title}>Your office,{ '\n' }within reach.</Text><Text style={styles.subtitle}>Know when someone needs you. Keep your availability in sync.</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}{busy && <ActivityIndicator color="#afe9ca" />}
    <View style={styles.card}><Text style={styles.heading}>Companion status</Text><Text style={styles.status}>{status?.connection || 'Loading…'}</Text><Text style={styles.body}>Profile: {status?.profileName || 'Not selected'}{ '\n' }Pairing: {status?.paired ? 'Ready' : 'Required'}{ '\n' }BLE advertising: {status?.advertising ? 'Active' : 'Inactive'}{ '\n' }Home Wi-Fi: {status?.wifi || 'Unknown'}{ '\n' }FCM token: {status?.fcmReady ? 'Ready' : 'Missing'}{ '\n' }Notifications: {status?.notifications ? 'Allowed' : 'Permission required'}{ '\n' }Full-screen requests: {status?.fullScreen ? 'Allowed' : 'Permission required'}</Text>
      <Button title={status?.running ? 'Stop companion' : 'Start companion'} onPress={() => action(() => status?.running ? companion.stop() : companion.start())} /><Text style={styles.note}>Keep the companion running during work. Gather controls when presence monitoring is active. If Android stops it, open this app to restart.</Text></View>
    <View style={styles.card}><Text style={styles.heading}>1. Allow device features</Text><Text style={styles.body}>Bluetooth advertises your proximity. Wi-Fi information distinguishes home from away. Notifications deliver conversation requests.</Text><Button title="Grant permissions" onPress={() => action(permissions)} /><Button title="Full-screen notification settings" onPress={() => action(() => companion.fullScreenSettings())} /><Button title="Notification settings" onPress={() => action(() => companion.notificationSettings())} /></View>
    <View style={styles.card}><Text style={styles.heading}>2. Pair with your laptop</Text><Text style={styles.body}>Open Gatherway Settings on your laptop with Ctrl+Shift+G. Copy its private pairing code here.</Text><TextInput accessibilityLabel="Private pairing code" placeholder="Pairing JSON" placeholderTextColor="#82998b" style={styles.input} value={pairing} onChangeText={setPairing} multiline autoCorrect={false} autoCapitalize="none" />
      <TextInput accessibilityLabel="Home Wi-Fi name" placeholder={status?.homeWifi || 'Home Wi-Fi name'} placeholderTextColor="#82998b" style={styles.input} value={homeWifi} onChangeText={setHomeWifi} autoCapitalize="none" /><Button title="Use current Wi-Fi name" onPress={() => status?.currentSsid ? setHomeWifi(status.currentSsid) : Alert.alert('Wi-Fi unavailable', 'Connect to home Wi-Fi, enable location services, and grant location permission.')} />
      <Text style={styles.body}>Paste the Firebase Android app configuration (google-services.json). Keep the Firebase service-account key on your laptop.</Text><TextInput accessibilityLabel="Firebase Android configuration" placeholder="google-services.json contents" placeholderTextColor="#82998b" style={styles.input} value={firebase} onChangeText={setFirebase} multiline autoCorrect={false} autoCapitalize="none" /><Button title="Save pairing and Firebase configuration" onPress={() => action(save)} /></View>
    <View style={styles.card}><Text style={styles.heading}>3. Test before enabling</Text><Text style={styles.body}>Start the companion, then send a test call alert from your laptop. Lock your phone and repeat. Calibrate desk and other-room proximity in the desktop settings before enabling movement.</Text><Text style={styles.note}>Calls ring for at most 45 seconds and respect silent mode and Do Not Disturb. Tap Acknowledge or interact with Gather to stop ringing.</Text></View>
  </ScrollView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#101716' }, content: { padding: 24, paddingTop: 64, paddingBottom: 60 }, brand: { color: '#91d5b4', letterSpacing: 3, fontSize: 12, marginBottom: 18 }, title: { color: '#edf5f1', fontSize: 38, fontWeight: '700', letterSpacing: -1.5 }, subtitle: { color: '#a8bcb1', fontSize: 16, lineHeight: 25, marginVertical: 18 }, card: { backgroundColor: '#1a2420', borderColor: '#31423a', borderWidth: 1, borderRadius: 18, padding: 20, marginVertical: 8 }, heading: { color: '#edf5f1', fontSize: 20, fontWeight: '600', marginBottom: 14 }, status: { color: '#afe9ca', fontSize: 16, marginBottom: 10 }, body: { color: '#cbdad2', fontSize: 15, lineHeight: 24, marginBottom: 10 }, note: { color: '#a8bcb1', fontSize: 13, lineHeight: 21, marginTop: 12 }, button: { backgroundColor: '#afe9ca', borderRadius: 10, padding: 14, marginVertical: 6 }, buttonText: { color: '#14291f', fontSize: 15, fontWeight: '600', textAlign: 'center' }, input: { backgroundColor: '#101716', borderColor: '#456353', borderWidth: 1, borderRadius: 9, padding: 12, color: '#fff', minHeight: 52, marginVertical: 8 }, error: { color: '#ffc1b4', lineHeight: 22, paddingVertical: 12 } });

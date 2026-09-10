const { withAndroidManifest, withGradleProperties } = require('expo/config-plugins');
module.exports = config => withGradleProperties(withAndroidManifest(config, config => {
  const application = config.modResults.manifest.application[0];
  // Direct traffic is restricted to validated Tailscale IPv4 endpoints in native code.
  // Payloads are additionally authenticated and encrypted with the paired device key.
  application.$['android:usesCleartextTraffic'] = 'true';
  application.$['android:allowBackup'] = 'false';
  return config;
}), config => {
  config.modResults = config.modResults.filter(item => item.key !== 'android.minSdkVersion');
  config.modResults.push({ type: 'property', key: 'android.minSdkVersion', value: '31' });
  return config;
});

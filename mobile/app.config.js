module.exports = {
  expo: {
    name: 'Gatherway', slug: 'gatherway', version: '0.1.0', orientation: 'portrait',
    userInterfaceStyle: 'dark', platforms: ['android'],
    android: { package: 'com.gatherway.companion', versionCode: 1, allowBackup: false },
    plugins: ['./plugins/with-companion'],
  },
};

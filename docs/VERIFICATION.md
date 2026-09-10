# Verification record

Updated: 2026-09-10.

## Passed locally

- 33 Node.js tests: presence, conversation/alert policy, media timing, synthetic
  adapter fixtures, Bluetooth output parsing, encrypted protocol, and FCM sending.
- Desktop JavaScript syntax checks and TypeScript checking of the Expo app.
- Six Android JVM tests: cross-language AES-GCM interoperability, tamper rejection,
  duplicate delivery, expiry, and cancellation before push/service startup.
- Android ARM64 standalone release-variant APK build, including release lint.
- Nix expression parsing and Git whitespace checks.

The APK is generated at
`mobile/android/app/build/outputs/apk/release/app-release.apk`.
It includes the JavaScript bundle and does not require Metro. It is signed with
the generated template's development key and is intended for personal testing.

Build versions: Expo 56.0.21, React Native 0.85.3, JDK 17, Gradle 9.3.1,
Android compile/target SDK 36, minimum SDK 31, NDK 27.1.12297006.

## Still required

- Inspect the signed-in Gather 2.0 interface and implement/verify its real profile.
  The repository currently contains an adapter contract and synthetic fixtures,
  not verified production selectors. Structured-state integration may be necessary
  if location, participants, or destination controls are not exposed in the DOM.
- Verify any 2.0 teleport mechanism separately. The supplied 1.0 packet has not
  been sent or assumed compatible.
- Configure Firebase sender credentials on the laptop and client configuration
  on the Pixel; pair the devices over Tailscale.
- Test notification/full-screen presentation, ringing and cancellation, foreground
  services, screen-off BLE, Wi-Fi visibility, and battery use on physical devices.
- Calibrate and validate real room transitions; capture and test actual destinations.
- Run the colleague-based end-to-end acceptance checklist in `SETUP.md`.
- Build/install the Nix package and verify desktop UI behavior in the user's session.

Automatic actions remain disabled until real-client verification is recorded.
Movement also requires calibration, three distinct saved destinations, and successful
destination tests. These gates are intentional; passing synthetic tests does not
establish real Gather compatibility.

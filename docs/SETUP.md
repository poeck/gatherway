# Gatherway setup

## Current readiness

The desktop coordinator, state machines, encrypted device transport, FCM sender,
Expo app, and Android services are implemented. Automatic actions start disabled.

**No production Gather 2.0 adapter profile has been verified.** The fixture under
`tests/fixtures` is synthetic and must not be presented as a working Gather profile.
Real Gather events and movement remain blocked until the current client is inspected
and the corresponding signals/actions pass the checks below. Phone testing and
room calibration also require your physical Pixel.

## Desktop

Use Node.js 24 or newer for development:

```sh
npm ci
npm test
npm run check
npm start -- --settings
```

With a Nix-provided Electron executable, run `electron . --settings` instead.
The repository also provides a desktop development shell:

```sh
nix develop -c electron . --settings
```

Open settings later with **Ctrl+Shift+G**. The normal Gather login remains inside
its isolated Electron window. Classic mode is preserved, but the companion adapter
only accepts the Gather 2.0 origin.

Bluetooth discovery requires BlueZ, a powered adapter, and permission to use
`bluetoothctl` as your normal user. The Nix package adds BlueZ to its PATH; the
host must enable Bluetooth. No privileged daemon is installed by Gatherway.

Enter the laptop's Tailscale IPv4 address, Gather space identifier, and your own
Gather user identifier. The listener binds only to that Tailscale address on port
47831. Permit that port from your phone in your tailnet policy and host firewall.
There is no public listener or router port forwarding.

Settings live under Electron's user-data directory in `gatherway/config.json`,
with owner-only permissions. Logs contain fixed diagnostic codes and are bounded
to two approximately 128 KiB files. Reset pairing invalidates the phone's old key.

## Firebase

1. Create/select a Firebase project and register an Android app with package name
   `com.gatherway.companion`.
2. Download its `google-services.json`. Paste this Android client configuration into
   the companion app. It is separate from the service-account credential.
3. Enable the FCM HTTP v1 API. Create/select a sender service account with the
   Firebase Cloud Messaging API Admin role in this project, and obtain its JSON
   credential. Keep this file outside the repository on the laptop; select it in
   desktop settings. Do not put it on the phone.
4. The laptop obtains short-lived OAuth tokens and sends directly to FCM. No
   additional hosted application server is needed.

Notifications contain AES-256-GCM envelopes. Google receives ciphertext and normal
delivery metadata. The pairing key stays on the two devices. FCM delivery is
best-effort; acceptance by FCM is not a receipt from the phone.

## Android build and installation

The app uses Expo SDK 56, React Native 0.85, and an Android-only local Expo module.
Use a development build or standalone APK; Expo Go cannot load this module.

```sh
cd mobile
npm ci
npm run typecheck
npm run prebuild
cd android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Prerequisites: JDK 17, Android SDK platform/build-tools 36, NDK 27.1.12297006,
and a working Android native toolchain. Set `JAVA_HOME` and `ANDROID_HOME` to
your installations. The generated `android/` directory is disposable; native
changes belong in `modules/companion` and `plugins/with-companion.js`.

The generated template uses its development signing configuration by default.
An APK built this way is for personal testing. Configure and retain a private
release signing key before distributing durable builds to other devices; do not
commit it. `eas.json` also includes an internal APK profile if EAS is preferred.

Install the resulting APK on the Pixel. Grant Bluetooth, notifications, and precise
location access. Wi-Fi SSID visibility requires location access/services; Gatherway
does not request GPS coordinates. The foreground service declares its use of
location information because it infers home presence from Wi-Fi. Allow full-screen
notifications through the dedicated settings button if desired.

Paste the private laptop pairing code and Firebase Android configuration, choose
your home Wi-Fi name, then start the companion from the visible app. If Android
stops the service or requires a new foreground start, open the app and restart it.

## Gather 2.0 integration verification

Use **Inspect Gather client** in settings to inspect the signed-in interface.
Do not disable Electron sandboxing or expose generic IPC to the website.

The adapter currently supports a declarative semantic DOM profile. It requires:

- A unique connected-state marker plus stable space and self identifiers.
- A current location identifier and distinct, observable destination controls.
- A uniquely identifiable conversation container, participant identifiers, and a
  separate desk visitor container. An absent container is unknown, not empty.
- Directed wave IDs, sender IDs, and recipient IDs. A wave is relevant only when
  its recipient matches the configured self identifier.
- Unambiguous microphone/camera state attributes and their existing buttons.

`tests/fixtures/synthetic-profile.json` documents the profile shape only. Derive
actual selectors from the current interface. Stable attributes are preferable to
class names; do not use pixel positions or minified internal identifiers. If Gather
does not expose a required signal through the DOM, that part needs a separately
verified structured-state adapter before it can be enabled.

Observe waves, visits, media states, and conversation changes with the real client
before recording adapter verification. Walk to each destination and capture its
location, then explicitly test each destination control. Movement verifies arrival
and stops after 15 seconds if the target is not reached. Failed movement disables
further automatic navigation until verified again.

The user's historical Gather 1.0 report described a WebSocket action with
`action.$case = "teleport"` and a payload containing `mapId`, `x`, `y`, and
`direction`. This is **not evidence of a compatible Gather 2.0 command**. No old
packet is sent. A verified 2.0 teleport implementation can replace `GatherAdapter.move`
while retaining destination confirmation and manual-interruption handling.

## Calibration and behavior

Start collection in desktop settings to activate advertisements during setup.
Collect at least 30 seconds with the phone at the desk in its usual pocket, then
another 30 seconds in another room. Calibration needs at least 15 samples per
location and a six-dBm separation between the distributions' inner quantiles.
Overlapping signals keep movement disabled.

The classifier uses a five-second median window and a five-second dwell. This
targets roughly 5–10-second transitions in clear conditions; it is not a guarantee
of room accuracy. Verify repeated transitions within the 15-second acceptance
limit. Unknown Wi-Fi information, stopped advertising, unavailable scanning, or
phone telemetry older than ten seconds yields unknown and holds position.

The laptop remains the decision maker. Phone requests run about every two seconds
while the companion service operates. BLE advertising requests a two-second
controller interval using the Android advertising-set API. Requests and replies are authenticated and
encrypted, and requests include freshness and replay checks. Local phone receipt
timestamps determine telemetry freshness.

Alerts ring for at most 45 seconds from their original creation time. Duplicate
FCM/direct deliveries do not restart the timer. Acknowledgement/cancellation creates
a persisted tombstone so a late original push cannot ring again. Silent and Do Not
Disturb settings are respected. Normal waves/reminders use a separate channel.

Automatic position ownership is lost on manual movement. Existing conversations
outside the break room protect position and suppress new phone alerts. A newly
arriving first visitor still triggers its own alert. Media is disabled after ten
seconds without participants, with a fresh participant/state check immediately
before each action.

## Physical acceptance checklist

These checks are intentionally not marked complete by automated tests:

- Lock-screen ringing, visible acknowledgement, and the original 45-second timeout.
- Silent/vibrate modes, Do Not Disturb, and full-screen permission denied/allowed.
- FCM with the direct connection unavailable; duplicate and late deliveries.
- Screen-off/Doze BLE advertisements, service restart, and permission revocation.
- Home Wi-Fi to mobile-data transitions and return; Bluetooth/network failures.
- At least 20 representative room transitions and a normal work-session battery check.
- Real waves, initial visitors, extra visitors during conversations, and visitor departure.
- Manual meeting locations, automatic brief/break transitions, and manual break reminder.
- Microphone/camera shutdown and a participant joining immediately before shutdown.
- Laptop suspend/resume without stale requests or synthetic visitor alerts.

Enable movement only after the real-client and physical checks pass. If they do
not, leave movement disabled and retain manual positioning while correcting the
adapter or calibration.

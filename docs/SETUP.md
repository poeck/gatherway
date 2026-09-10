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
nix develop -c electron . --settings --enable-features=WebRTCPipeWireCapturer
```

The development shell and packaged launcher clear inherited `LD_LIBRARY_PATH`
so Electron uses the libraries from the project's pinned Nixpkgs. Mixing newer
host libraries with that Electron can otherwise produce `GLIBC_ABI_* not found`
errors. This does not change the parent terminal or system configuration.

NixOS graphics drivers are also loaded from `/run/opengl-driver`. An old project
lockfile can still fail to load newer system Mesa drivers after clearing
`LD_LIBRARY_PATH`. The desktop lockfile was aligned with the first target laptop's
Nixpkgs revision on September 10, 2026. Recheck this compatibility after system
upgrades if Mesa reports missing `GLIBC_ABI_*` symbols or GPU process crashes.

### Hyprland scratchpad

The window rule and shortcut must name the same special workspace. For example,
if Super+M toggles `magic`, route the `Gather` window class to `special:magic`.
Routing it to `special:gather` instead leaves the windows on a different special
workspace, even though the process keeps running. This applies to both the main
window and settings. Configure this in the host's Hyprland configuration.

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

The settings snapshot also contains `waveIntegration`. While connected and not
paused, a read-only observer subscribes to Gather's internal `WaveEvent` source.
After restarting the desktop client, receive a wave and check for `Listening`,
the current space/self identifiers, and an entry with `fromId` and `createdAt`.
Entries expire 45 seconds after the original event time. This diagnostic does not
enable ringing, movement, or media actions. Capture the result before it expires.

When building a verified profile, `"waves": { "source": "gather-events" }`
selects this source instead of DOM wave attributes. The configured identity must
match the source, and fresh baselines are required after reconnecting. Do not mark
the entire adapter verified solely because wave reception works. Check hidden
workspaces and suspend/resume with the real client as well.

The snapshot also includes `sessionIntegration`, which reads the current space,
self identity, conversation participants, nearby listeners and local media state.
Paul verified the participant distinction in locked, unlocked and absent
conversations, with media disabled in each case. Nearby listeners never count as
conversation participants. Missing state is null, not an empty conversation.

After restarting, check this diagnostic in settings with and without a conversation.
Expect `status: "Observed"`, `connected: true`, the current identity, and the other
participant's ID only while actually in a conversation. The outer snapshot may
still say `No verified Gather profile`; these diagnostics do not enable actions.

An explicit `"session": { "source": "gather-repos" }` profile entry selects the
structured identity and participant source. Media readings must agree with the
verified DOM buttons in `desktop/profiles/gather-v2-media.json`. Immediately before
each disable action, the adapter rechecks the connected identity, participants and
media state together in the page. The media fragment alone is not a complete
importable profile. Neither a successful probe nor a session source entry bypasses
adapter verification or supplies missing location and desk-visitor information.

The `locationIntegration` diagnostic reads the current user's floor and exact
coordinates. Paul's initial readings and return-to-desk check are recorded in
`VERIFICATION.md`. For his installation, paste
`desktop/profiles/otark-paul-observed.json` into the integration profile field and
choose **Save profile**. This is a partial observation profile: do not record full
adapter verification yet. At the observed desk, expect `matchedDestination` to be
`available`; the brief-away point should report `brief`, and the break-room point
`away`. Elsewhere it is null. The matching requires the profile's space/self scope
and exact floor/coordinates. No reference target triggers movement.

The optional `location.source` of `gather-repos` selects structured location
readings. The policy location ID includes space, floor, x and y, including unsaved
positions. Matching configured identity is required to feed it to policy. Coordinate
recognition alone does not establish a movement capability. Navigation remains
missing from the partial profile.

`deskIntegration` shows the assigned desk's observed occupants independently of
conversation participants. `otherOccupantIds` excludes the current user. This is
diagnostic unless the profile explicitly selects the scoped desk source. To check it, keep the
avatar at the brief-away position and have a colleague enter and leave the fixed
desk. Compare an empty desk, the visit and departure with the displayed occupant
IDs and `sessionIntegration.participants`. A null roster means unavailable, not an
empty desk. This diagnostic requires a desktop restart after updating the code,
but no profile selection is needed for the diagnostic itself. After Paul's live
arrival/departure trial, his observation profile was extended with
`deskVisitors.source: "gather-desk"`, the observed assigned desk ID and space/self
scope. Reimport the updated profile to select this source for policy. Saving a
profile resets verification; it does not enable automatic actions. Match the
configured Gather identities and finish media-state checks before recording adapter
verification. Desk visitors remain separate from actual conversation participants.

The adapter supports a declarative semantic DOM profile with the optional verified
structured sources above. A complete profile requires:

- A unique connected-state marker plus stable space and self identifiers, or the
  explicit structured session source.
- A current location identifier and distinct, observable destination controls.
- A uniquely identifiable conversation container and participant identifiers, or
  the structured session source; a separate desk visitor source is still required.
  An absent container is unknown, not empty.
- Directed wave IDs, sender IDs, and recipient IDs, or the structured wave source.
  A wave is relevant only when its recipient matches the configured self identifier.
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

### Live media shutdown trial

After the read-only signal checks, save the connection and Gather identity, import
the current observation profile, and wait for an outer snapshot with `connected:
true` and `errors: []`. Keep both media off initially. Record adapter verification
only after the listed signal checks. This activates media safety and alert policy;
it does not enable movement or establish phone delivery readiness.

While alone at the desk, enable microphone and camera manually within a few
seconds of each other. Both should turn off after about ten seconds, allowing for
the desktop polling interval and Gather UI updates. No notification is expected.
If they remain on after 15 seconds, switch them off manually, pause Gatherway and
inspect the current snapshot and bounded diagnostic codes before retrying.

Next, verify that both remain on for at least 15 seconds in an actual conversation,
even if the other participant is muted. Paul observed that Gather itself switches
both off immediately when the conversation ends, before Gatherway's timeout.
Leave them off; do not automatically re-enable media or disable Gather's safeguards.
That scenario cannot establish Gatherway's timer reset and should be recorded as
masked by host behavior. The fallback remains applicable to media that stays on
while alone. Timer reset is covered by local tests; independent live confirmation
is still outstanding. Phone presence is not required for media safety.
Pause after the trial while the remaining onboarding and failure checks are pending.

The user's historical Gather 1.0 report described a WebSocket action with
`action.$case = "teleport"` and a payload containing `mapId`, `x`, `y`, and
`direction`. This is **not evidence of a compatible Gather 2.0 command**. No old
packet is sent. A verified 2.0 teleport implementation can replace `GatherAdapter.move`
while retaining destination confirmation and manual-interruption handling.

## Calibration and behavior

Use **Presence profile** for different real-world places, such as Apartment and
Parents. Enter a name and the exact home Wi-Fi SSID, then choose **Save profile
details** to edit the selected profile or **Create new profile** for another place.
Switch manually using the profile selector. Each profile has separate measurements
and calculated thresholds. The Gather office and its destinations remain shared.
Switching stops collection, clears previous presence evidence and overrides, and
disables automatic movement until its checks are repeated. Changing a profile's
SSID retains measurements but invalidates its calculated thresholds.

The updated phone app reports its observed Wi-Fi name over the existing encrypted
connection. The desktop compares it with the selected profile's home network;
confirmed Wi-Fi disconnection remains distinct from unavailable Wi-Fi information.
An older companion cannot provide this profile-aware evidence and yields Unknown
until updated. The phone displays the selected profile after its next exchange.

Start **Record your room** in desktop settings to activate advertisements during
setup. Collection begins after a 20-second countdown. Carry the phone normally
throughout the room that should count as Available, including its farthest usual
positions. Spend time at each position rather than walking continuously. The
collection stops automatically after two minutes of valid monitoring.

Then choose **Record other rooms** and leave the Available room during the
countdown. Include the nearest usual spots in adjacent rooms, not only places
with the weakest reception. Wait for collection to finish before returning with
the phone. Each group can be stopped and resumed without losing progress; explicit
reset buttons clear one group in the selected profile. Progress is checkpointed
locally about once per second, with immediate saves on stop, reset, profile changes
and normal shutdown. Completed and partial trials survive restarts; restored
collections are stopped until explicitly resumed, without counting offline time.
The profile storage message reports success or errors. On a crash, the most recent
interval since the last checkpoint may be lost. Older versions' unsaved in-memory
trials cannot be recovered by installing this change.

The private file `presence-profiles.json` is stored beside the desktop configuration
in its Gatherway user-data directory (normally `~/.config/Gather/gatherway`). It
contains profile names, SSIDs, signal/time measurements and thresholds, without
Firebase credentials, pairing keys or conversation data. Writes use an atomic
replacement with owner-only permissions. Invalid/incompatible files are preserved
and shown as unavailable rather than silently replaced with empty measurements.
Profiles are bound to this installation's beacon. Changes to the phone, laptop
placement or radio settings require reviewing and usually repeating calibration.

Only intervals with fresh phone telemetry, active advertising, a running companion,
healthy scanning and confirmed home Wi-Fi count. Monitoring outages pause the
measurement clock. Suspend, disconnect and pause stop collection while retaining
completed intervals. A stalled desktop timer does not count as a reception gap.
The UI reports valid time, received samples, signal coverage and time without
recent reception. Coverage uses the same five-second reception window as presence.

There is no minimum packet count. Healthy monitoring with weak or zero BLE
reception outside the room is valid evidence. In the Available room, at least 90%
of valid time must have recent reception, with no continuous uncovered period
over five seconds. Time-weighted signal quantiles prevent packet bursts from
dominating the thresholds. The weak in-room quantile must exceed the strong
other-room quantile by six dBm when other-room signals exist. With no other-room
signals, the exit threshold is inferred six dBm below the in-room threshold; no
RSSI values are invented. These are calibration screening rules, not proof of
physical room separation. Select **Calculate thresholds**, then verify real
transitions before enabling movement. Thresholds are saved, but movement remains
disabled until its existing acceptance checks pass.

Completed groups show the weaker in-room signal, stronger other-room signal and
their separation in dB. These are time-weighted comparison values, not the latest
live RSSI. Good reception percentages alone do not imply that the rooms separate.
An overlap error reports the measured margin against the required six dB; do not
relax it merely to accept a trial. Keep the phone outside until collection actually
finishes, including any extra time waiting for monitoring to recover.

The classifier uses a five-second median window and a five-second dwell. This
targets roughly 5–10-second transitions in clear conditions; it is not a guarantee
of room accuracy. Verify repeated transitions within the 15-second acceptance
limit. Unknown Wi-Fi information, stopped advertising, unavailable scanning, or
phone telemetry older than ten seconds yields unknown and holds position.

The laptop remains the decision maker. Phone requests run about every two seconds
while the companion service operates. BLE advertising repeats every 250 ms, with
a sequence updated about every two seconds in the primary service-data packet.
Repeats improve the chance of intersecting the laptop's receive windows; actual
sample cadence, screen-off reliability and battery cost still require measurement.
Requests and replies are authenticated and
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

# Verification record

Updated: 2026-09-10.

## Passed locally

- 51 Node.js tests: presence, conversation/alert policy, media timing, synthetic
  adapter fixtures, the structured wave observer, Bluetooth output parsing,
  encrypted protocol, and FCM sending.
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

## Gather 2.0 observations from the user's session

Paul supplied individual button `outerHTML` snippets and confirmed that the
microphone was muted and the camera was off when copying them.

| Control | Observed selector | User-confirmed state |
| --- | --- | --- |
| Microphone | `button[data-testid="toggle-microphone-on-button"]` | Off |
| Camera | `button[data-testid="toggle-camera-on-button"]` | Off |

Both buttons also had `data-state="closed"`. This attribute has not been
established as a media-state signal and must not be used as one. The `on` suffix
identifies an enable action in these observations, not an enabled media state.

Paul subsequently reported `toggle-microphone-off-button` and
`toggle-camera-off-button` for the enabled states. The media-only profile fragment
at `desktop/profiles/gather-v2-media.json` records these mappings. It is not a
complete importable profile and is not automatically activated. Local tests use
these identifiers with synthetic surrounding office state to check both media
states, no enable clicks, and refusal of missing, ambiguous, hidden, or disabled
controls.

These observations do not establish page-wide selector uniqueness or a verified
automatic disable action. Those checks and the participant signal are still
required before automatic media shutdown can be enabled. No complete production
profile has been verified or enabled from these observations.

### Conversation panel candidate

A user-supplied panel fragment contains a `data-onboarding-task-id="WhoCanHear"`
marker with the text `Locked conversation` and two tiles. Each tile contains
`.video-tile-indicators`, a `.player-name-tag-text` label and a
`.player-muted-icon`. This is evidence for a participant-panel candidate that
can represent multiple people while muted; microphone state must not be used
to decide whether a conversation exists.

The marker is inside a header sibling of the tiles, not a container wrapping
them. The supplied outer container has only a generated CSS class. Stable
participant identifiers and a reliable self marker have not been established.
Display names and signed profile-photo URLs are not verified user identifiers;
photo URLs and signatures are intentionally not copied into this record.

Before activating a reader, compare the panel while alone and in an unlocked
conversation, find a stable enclosing container, and verify behavior when tiles
are collapsed or cameras are enabled. A missing panel must remain unknown unless
another verified signal establishes that no other participant is connected.

Paul subsequently supplied a candidate for the same panel while reporting no
conversation. The `.css-1se8sg0` element remains, but contains only an empty
wrapper with `opacity: 0`; no participant tiles or `WhoCanHear` marker appear in
the supplied fragment. Its ancestors expose only generated classes
(`_37x6ee1` and `css-1svh23u`). This supports a retained empty-panel hypothesis,
not a verified empty-conversation reader: the panel identity, completeness and
behavior when collapsed still need checking. Generated classes and opacity alone
must not establish an empty conversation or authorize media shutdown.

A larger user-supplied empty-state fragment places this panel below
`[data-test-id="content-container-inner"]`, inside
`[data-test-id="content-container"]` and `[data-panel-id="body"]`. Note the
`data-test-id` spelling, unlike the media buttons' `data-testid`. These are
candidate semantic anchors for the broader office content, not dedicated
conversation containers. The same ancestor also contains
`[data-testid="main-canvas"]` with `PlayerNamePlateWithProfiler` map overlays
for multiple people while the conversation panel is empty. Those map nameplates
must not be counted as conversation participants, and their CSS transforms are
screen positions, not verified map destinations. The panel is outside
`main-canvas` in this capture; that structural relationship still needs comparison
with an unlocked and collapsed conversation before relying on it.

A subsequent larger capture, confirmed by Paul to contain himself and one other
conversation participant, contains exactly two `.video-tile-indicators` name
labels outside `main-canvas`. It also includes an empty
`[data-testid="office-meeting-overlay-top"]` sibling and a conversation toolbar.
The capture is still a locked conversation: it includes both
`[data-testid="unlock-conversation-button"]` and `Locked conversation` text.
It must not be recorded as unlocked-state verification. The other participant
has an SVG initial avatar rather than a profile image, further demonstrating
that profile-image URLs cannot supply universal participant identifiers.

Paul then supplied an unlocked capture while still reporting the same two-person
conversation. It contains `lock-conversation-button` and the text `Nearby people
may listen in`, confirming the unlocked presentation. Crucially, only Paul's
`.video-tile-indicators` tile is present in the fragment, although the conversation
toolbar still includes both people's avatars. A right-direction control appears
beside the tile area. Pagination or virtualization is a hypothesis requiring
visual confirmation; counting rendered tiles cannot establish the full participant
set or the absence of other participants. The toolbar additionally includes a
separate group of other people's avatars, so counting every toolbar avatar is
also insufficient. Participant recognition remains unavailable pending a complete,
unambiguous source; this capture must not enable media shutdown or movement.

The subsequent grid-layout capture retains one
`[data-test-id="content-container-inner"]`, the conversation toolbar with the
same two participant avatars, and `unlock-conversation-button`. Both participant
tiles are rendered again, but their container classes and nesting differ from
the map layout. The toolbar's direct title button contains the two avatars in
all three two-person captures (locked map, unlocked map, locked grid); the
nearby-listener avatars in the unlocked capture are in a separate toolbar child.
This scoped title button is a better roster candidate than tile counting, but
its completeness for larger meetings, stable user identifiers, self identity,
and reconnect/disconnect behavior have not been verified. Names must not be
promoted to verified user IDs. These layout checks do not enable automation.

### Directed-wave notification candidate

Paul supplied a screenshot and notification HTML for a directed wave. The card
contains a sender avatar label, the text `<display name> waved to you`, a relative
age/location line (`Right now` plus a desk description),
`button[data-testid="notification-close-button"]`, and buttons labeled
`Wave back` and `Walk over`. This is a directed-wave presentation, distinct from
the separately observed request-to-join notification.

The close-button identifier is generic and cannot identify a wave by itself.
The fragment exposes no verified event ID, sender user ID, recipient user ID, or
absolute creation timestamp. A display name is not a unique sender ID, and the
relative-age text must not be treated as an exact event creation time. A repeated
observation must not generate a new alert. Compare repeated waves from the same
sender, notification replacement/stacking, disappearance, and reconnect baselines
before enabling event emission. The supplied notification is recorded as evidence
only; it does not activate wave alerts or any `Wave back`/`Walk over` action.

Paul reports that another wave from the same sender keeps a single visible card
and resets its relative age to `Right now`. The additional supplied HTML still
has no event ID or absolute timestamp and shows `1 minute ago`. Two waves within
the same relative-age bucket may have indistinguishable HTML; comparing text or
counting cards therefore cannot guarantee event deduplication and detection.
Do not invent a fresh event timestamp from each observation, or claim that a DOM
mutation necessarily represents a new wave. A structured incoming event source
must be investigated before enabling reliable wave delivery. This investigation
must remain passive: no replay or modification of Gather requests is needed.

Paul inspected the router and regional SFU Socket.IO WebSocket connections and
reports only incoming `2` and outgoing `3` packets of length one during the wave
test. In Engine.IO v4 these are ping/pong heartbeat packets, not wave events
([protocol reference](https://socket.io/docs/v4/engine-io-protocol/)). No wave
payload has been identified on either observed connection. The wave delivery
transport remains unknown; HTTP polling or another transport is a hypothesis,
not an established Gather implementation detail. Connection session parameters
are intentionally not retained in this record.

Paul reports no new Fetch/XHR requests when receiving a wave. HTTP polling is
not established. A passive inspection of the publicly served client on
2026-09-10 found a more specific integration candidate:

- The entry page references `main.ab2ded7032ce7717.js`; its startup references
  `bundle.27fda57498eab3ef.js` and `bundle.ee567632a7ee67f2.js`.
- The entry bundle initializes a `globalThis.gatherDev` object. The application
  stores its repositories under `gatherDev.Repos`.
- The notification service subscribes to `gameSpace.events` for `WaveEvent`.
  Its handler reads `senderId` and `sentTime` and uses the latter as `notifiedAt`.
- The notification card uses a sender-derived identifier and replacement of
  an existing card. This explains the single-card behavior, but that card ID
  must not be used as a unique wave-event ID.

Only public static client assets were downloaded, without authentication; no
Gather requests were replayed or modified. Source inspection establishes code
behavior, not availability or correctness in the user's current signed-in
session. The named repository/event properties are an internal interface, not a
documented compatibility guarantee. Source inspection alone does not enable
automation. Validate received event timestamps, session lifecycle and cleanup
before wiring alerts. Do not bind integration code
to bundled module numbers, generated variable names or asset hashes.

Paul ran the read-only console capability check and returned
`repositoriesAvailable: true` and `gameSpaceAvailable: true`. This verifies
presence of those objects in his signed-in session, not event delivery or
participant semantics. `scripts/probe-gather-waves.js` is a temporary console
probe that logs only sender ID, event time, local receipt time and count.

Paul returned two probe events from the same sender with distinct timestamps
5,221 ms apart. Local receipt times were 88 ms and 62 ms after their respective
event timestamps. These differences assume synchronized clocks and are not a
general delivery-latency guarantee. This verifies the incoming event shape in
that session. Live cleanup and reconnect behavior have not yet been verified.

The desktop adapter now includes a bounded, read-only page-world wave observer.
`waveIntegration` in the settings snapshot exposes its status, observed space/self
IDs and recent events, independently of whether a full DOM profile exists. The
observer checks connection identity, disposes on connection lifecycle changes,
and expires after five seconds without polling. It retains at most 128 events
until their original 45-second deadlines, rejects pre-subscription, expired and
future timestamps, and deduplicates by space/self/sender/time. Distinct waves with
identical sender and millisecond timestamp are conservatively treated as one.

An explicit profile wave source of `gather-events` is required to feed these
observations into the policy engine; matching configured identity and the existing
adapter-verification gate remain required. The observer does not grant access to
Electron, Node or device credentials. Engine tests also cover original-time expiry
and genuine input acknowledging a wave before its next polling result arrives.
All observer lifecycle and adapter-wiring checks so far use local mocks. The
built-in observer, hidden-workspace operation, and end-to-end phone delivery
still require live verification.

Paul subsequently supplied the built-in settings snapshot with wave status
`Listening`, a populated space/self identity, `baseline: false`, and one received
wave with sender ID and original event timestamp. This verifies one live receive
through the integrated observer. The outer DOM-profile snapshot remains
disconnected because no complete profile has been configured, as expected.
Hidden-workspace operation, lifecycle cleanup and phone delivery remain unverified.

### Structured conversation state

Further inspection of the already downloaded public client identifies
`Repos.avConnections.stronglyConnectedSpaceUserIds`, excluding the current user,
and a separate `ambientlyConnectedSpaceUserIds` list. Gather's own desktop power
management uses the former list's nonzero length to report `inActiveConversation`.
These getters are distinct from the paginated video-tile lists. The same reporting
code reads `Repos.localMediaSelfInfo.ownAudioEnabled` and `ownVideoEnabled`.

Paul supplied results from `scripts/probe-gather-conversation.js` for three
manually confirmed situations. All reported connected, with microphone and camera
disabled:

| Situation | Other conversation participants | Nearby listeners |
| --- | --- | --- |
| Locked conversation | One | Zero |
| Unlocked conversation | The same one | Three |
| No conversation | Zero | Four, including the former participant |

This verifies the observed distinction between actual participants and ambient
listeners in that session, independently of mute state and conversation locking.
Disconnect handling and multi-person conversation changes still require live
verification. Media-on readings were subsequently checked as recorded below.

The adapter now exposes a read-only `sessionIntegration` diagnostic without
requiring a configured profile. An explicit profile `session.source` of
`gather-repos` enables structured identity and participant mapping, requiring a
match with configured space/self IDs. Media state must agree with the observed DOM
buttons. Missing, malformed or duplicate participant lists remain unknown. Ambient
listeners are diagnostic only. Before each media disable, a synchronous page-world
check rereads connected identity, actual participants and media state, then clicks
only the observed disable button. Already-disabled media is left alone, and the
result is checked afterward. No Gather internals are modified.

Fifteen new local tests cover anonymized versions of the three observed states,
missing and malformed data, identity mismatch, disconnect and snapshot invalidation,
contradictory media, a participant joining between microphone and camera actions,
unconfirmed actions, and serialization into the page world. These tests pass, as do
the desktop suite and syntax checks. Actual ten-second media shutdown still needs
live verification. Automatic actions remain
behind the existing adapter-verification gate; no complete profile was installed.

Paul subsequently returned the integrated `sessionIntegration` diagnostic while
alone: `Observed`, connected, matching space/self identity, zero participants,
four nearby listeners, microphone/camera false and no errors. This verifies the
integrated read path in the no-conversation case. A live integrated transition into
and out of a conversation remains to be checked. The outer snapshot correctly
remained disconnected with `No verified Gather profile`.

### Current-user location observations

The previously downloaded public client reads the current user's `floorId` and
`position.x`/`position.y` for its own office view and navigation. The read-only
`scripts/probe-gather-location.js` exposes only those fields and the current
connection identity. The probe neither moves the avatar nor enables automatic
movement; no destination is inferred from the screenshot.

Paul returned four live readings after manually positioning his avatar:

| Manually chosen position | x | y |
| --- | --- | --- |
| Own desk | 37 | 61 |
| Brief absence | 37 | 59 |
| Break room | 27 | 51 |
| Return to own desk | 37 | 61 |

All readings reported connected with identical space, self and floor IDs. This
verifies a change in the observed position after a manual move within the same
floor. The measured displacement is two coordinate units along y; it does not
establish a physical distance or require changing Paul's chosen brief-away spot.
The return reproduced the original desk coordinates in this trial. These are
recorded observations, not enabled movement destinations.

The adapter now exposes `locationIntegration` without a configured profile. An
explicit `location.source` of `gather-repos` uses the observed location for policy
only when the connected identity matches configuration. Exact location identifiers
include space, floor and coordinates; unsaved positions remain distinguishable.
Unavailable data stays null. No rounding or proximity radius is assumed.

`desktop/profiles/otark-paul-observed.json` is an importable partial profile for
Paul's observed installation. Its three reference targets are scoped to his space
and identity. A single exact floor/coordinate match appears as `matchedDestination`
(`available`, `brief` or `away`) in the diagnostic. It contains no navigation
actions, so it cannot enable movement. A scoped desk-visitor source was subsequently
added after the occupancy trial below. Other installations must supply their own
observed targets and desk identity.

Eight new local tests pass for the four observed positions, exact unsaved positions,
scope isolation, invalid/missing data, ambiguous targets, page serialization,
disconnect invalidation and explicit adapter wiring. The desktop test suite and
17-file syntax check also pass.

After importing the partial profile, Paul supplied the integrated location
diagnostic at his desk: `Observed`, connected, the expected space/self/floor,
position `(37, 61)`, the corresponding exact location ID, and
`matchedDestination: "available"`. This verifies integrated desk recognition.
Paul then supplied integrated readings for brief absence `(37, 59)` with
`matchedDestination: "brief"`, the break room `(27, 51)` with `"away"`, and return
to the desk `(37, 61)` with `"available"`. All remained connected in the same
space, identity and floor. This verifies the integrated target-recognition cycle
in that trial. Destination capture and actual navigation remain unverified.

### Assigned-desk occupancy candidate

The downloaded public client exposes the current user's assigned `desk`, `deskId`
and `isAtOwnDesk`. Its desk area exposes `spaceUserIds`, `spaceUsers`, `deskOwner`
and `isFullyAVConnected`. Area occupancy must not yet be treated as a conversation
or visit: compare it with actual conversation participants and the visible visit,
including when Paul is standing at the brief-away position.

`scripts/probe-gather-desk.js` is a one-shot read-only diagnostic limited to the
current user and his assigned desk. It includes desk identity, area membership,
occupant cluster IDs and actual conversation participants. Missing desk/map/list
data stays unavailable. It neither changes the desk nor enables alerts.

Paul returned three live probe results for the same assigned desk and matching
owner/area identity, with its map available and `fullyAVConnected: true`:

| Situation | Desk occupants | Own conversation participants |
| --- | --- | --- |
| Alone at desk | Self only | None |
| Visitor at desk | Self and visitor, sharing a cluster | Visitor |
| Self briefly away, visitor remains | Visitor only, no cluster | None |

On leaving, `atOwnDesk` became false and the self area changed, while the assigned
desk remained the same. This verifies continued visibility of the visitor at the
fixed desk after the self conversation ends. It does not yet verify a new arrival
while the owner is already away, visitor departure, or that every area occupant
should trigger a conversation request.

The probe returned `occupantIds: null` in all three cases. Its collection reader
did not establish a supported value for `spaceUserIds`; do not infer an empty desk
from that field. The separate `spaceUsers` array supplied the observed occupants.

The desktop now exposes a read-only `deskIntegration` diagnostic using that array.
It checks assigned desk identity, ownership, map availability, AV-area status and
each occupant's actual area membership. `occupantIds` includes self when present;
`otherOccupantIds` excludes self. Missing, malformed or contradictory data remains
null. Desk reassignment, identity changes and disconnection invalidate observations.
Without an explicitly selected desk source, the diagnostic does not fill policy
`deskVisitors`, affect conversation protection or enable alerts.

Eight new local tests pass for the observed shapes, unknown versus empty rosters,
area/ownership mismatches, unsupported collections, identity changes, page-world
serialization, origin restriction and diagnostic isolation. The desktop suite and
18-file syntax check also pass.

Paul then confirmed the integrated arrival/departure cycle while remaining at the
brief-away position: no other occupants, the visitor's ID only after entering the
desk, then no other occupants after leaving. Gather displayed no self conversation.
This verifies actual assigned-desk occupancy transitions independently of the
owner's conversation. A visit is based on membership in the assigned AV desk area,
not on ambient listeners or a coordinate proximity radius.

The profile now selects `deskVisitors.source: "gather-desk"`, scoped to Paul's
space, self identity and observed assigned desk ID. The adapter feeds valid other
occupants into `deskVisitors` without changing `participants`. Mismatched identity,
desk reassignment or unavailable state stays null. The engine deduplicates the same
ongoing visitor across desk and avatar feeds, including sequential updates. It
cancels for departure only when both feeds confirm absence; uncertainty retains
the original expiry deadline rather than claiming the visitor left.

Five additional tests cover the wired brief-away arrival/departure cycle, identity
and desk scoping, cross-feed deduplication, uncertain departure and recovery/reconnect
baselines. The ten desk tests, twenty engine tests, full desktop suite and syntax
checks pass. Real phone ringing/cancellation remains unverified. At that checkpoint,
the saved local configuration had empty Gather identity fields, no Tailscale host
and both adapter/movement verification disabled. The agent made no configuration
changes; Paul was subsequently guided through setup for the media action trial.

### Media-state verification and live shutdown trial

Paul confirmed the integrated `sessionIntegration` readings for microphone on with
camera off, microphone off with camera on, and both off. All matched the expected
booleans, with no conversation participants. This verifies the local media flags
in both states, in addition to the previously observed explicit DOM disable buttons.
These readings alone did not verify an automatic disable action or its timing.

The action trial instructions covered saving the laptop connection and Gather identity, importing
the updated scoped desk profile, then checking the outer snapshot is connected and
has no errors. Recording adapter verification activates media safety and alert
policy; movement remains disabled and has no implementation in this profile. Test
both media turning off after ten seconds alone, then conversation protection and
timer reset when another participant joins. No activation or configuration edits
were performed by the agent in preparation for this trial.

Paul confirmed that the actual automatic shutdown worked repeatedly in the live
client, with microphone and camera switching off after approximately ten seconds
alone. This records the reported shutdown timing for that scenario. The
trial instructions asked Paul to pause afterward; current pause state is not
inferred from the success report.

In the subsequent conversation trial, Paul confirmed that microphone and camera
stayed enabled while another participant was present. He clarified that both
microphone and camera switch off immediately when the conversation ends, and
reports that this behavior predates Gatherway. Existing Gather behavior is the
reported cause; it has not been independently isolated. Neither immediate shutdown
is evidence of Gatherway's ten-second action. Both remain off until manually
enabled again, as intended: Gatherway never automatically enables either device.

Conversation protection is observed live. The planned leave/rejoin trial cannot
isolate Gatherway's timer reset because both devices are already off before that
deadline. Mark that acceptance item as masked by the host client's behavior, not
passed or failed. Local state-machine tests cover the reset; independent live
verification remains outstanding. Do not repeatedly request this same scenario
or disable Gather's own media safeguards to make the test observable. The earlier
reported ten-second shutdown while already alone is a separate observation and
does not resolve attribution in the conversation-exit scenario.

### First Pixel installation

The physical Pixel 10 was detected over USB with debugging already authorized.
ADB reported Android 17. The existing ARM64 APK was installed with a successful
`install -r` result, preserving any existing app data. The launcher activity resolved
to `com.gatherway.companion/.MainActivity`; an explicit launch returned `Status: ok`
and reported that the activity was already the top running instance.

This establishes installation and activity launch, not companion-service, BLE or
FCM reliability. Paul confirmed no Firebase project/app has been created yet.
Permission readiness, configuration, pairing and actual alert delivery remain
pending. No Android permission prompts were bypassed using ADB.

### Firebase setup and Wi-Fi onboarding update

Paul supplied the Android Firebase configuration for `gatherway-e63a4`; its Android
package matches `com.gatherway.companion`. The Pixel has granted the requested
runtime notification, Bluetooth and location permissions. Paul confirmed that its
current Wi-Fi is the intended home network. Full-screen presentation and background
delivery still require actual device trials.

The current-SSID onboarding button exposed a circular dependency: the Wi-Fi reader
required saved pairing configuration before returning a network name. The reader
now returns an observed SSID before configuration exists, while keeping availability
unknown until a home network has been configured. The ARM64 release build and native
unit tests passed; the updated APK was installed successfully and its activity
launched on the Pixel. The corrected SSID button still needs confirmation in use.

Direct text injection did not reliably populate both configuration fields. At
Paul's request, a temporary localhost page was delivered through USB forwarding
with explicit copy buttons so he can paste each value himself. Pairing data and
Firebase configuration were kept out of diagnostic output. Saving configuration,
FCM token readiness and phone-to-laptop connectivity remain unverified. Firebase
sender credentials have not yet been configured on the laptop.

### Saved phone configuration and service-start return value

Paul confirmed both Pairing and FCM token show Ready after saving. Home Wi-Fi
shows `home`, which is the network classification, not the SSID. Starting the
companion produced `Connected - working` alongside an Expo rejection reporting
an unsupported `android.content.ComponentName` return type.

The native start lambda implicitly returned the result of `startForegroundService`.
It now ends with `Unit`, matching the JavaScript `Promise<void>` contract. The
release APK build and native unit tests passed. These checks do not exercise the
Expo bridge on the physical device; a start through the updated UI is required.
The updated APK was installed successfully, preserving configuration. The phone UI
showed BLE advertising Active, both readiness indicators Ready, and notification
and full-screen request permissions Allowed. A Stop companion click was executed,
but the subsequent start check could not complete because the start control was
not visible and then Gatherway was no longer in the foreground. A successful
start without a bridge error remains to be confirmed by Paul.
Paul subsequently confirmed that starting the updated app returns
`Connected - working` without an error. The service-start bridge regression is
therefore verified on the Pixel. Firebase sender configuration and actual alert
delivery are the next outstanding setup steps.
The initial connection status is evidence of communication, not FCM alert delivery
or reliable BLE presence recognition.

### Laptop Firebase sender credential

The supplied service-account file was validated as an RSA private key for the
same Firebase project as the Android configuration. It was copied to the private
Gatherway configuration directory outside the repository with owner-only file
permissions; the downloaded copy was also restricted to its owner. No key or
access-token values were printed or committed.

The existing FCM sender successfully obtained an OAuth access token from Google
using that credential. No notification was sent. Selecting the protected file
through the running desktop's Choose Firebase credentials action remains pending;
the on-disk app configuration was not edited behind the running process. OAuth
success does not establish messaging permission, API enablement, or phone delivery.
The ordinary test-alert action uses both Tailscale and FCM, so a received alert
alone will not isolate FCM delivery; a separate FCM-only trial is still required.

### Initial phone alert trials

After the sender-selection and test-alert instructions, Paul reported that the
initial call alert and phone acknowledgement worked. He subsequently reported
success for the short locked-screen trial, whose instructions included waiting
about 30 seconds before sending and letting the alert expire within 45 seconds
of creation. Exact measured latency, duration and lock-screen presentation style
were not separately supplied. These are user-reported device observations, not
an isolated FCM delivery test or a Doze acceptance result. Tailscale was still
available as a parallel delivery path.

### FCM delivery without the direct connection

Paul reported success for the trial that disconnects Tailscale on the phone,
keeps Internet access and the companion service running, waits 15 seconds, locks
the screen, then sends a new desktop test alert and acknowledges it on the phone.
This records user-confirmed FCM delivery without the direct Tailscale path in
that trial. The desktop FCM status text and measured latency were not separately
provided. Long idle/Doze delivery and the other failure scenarios remain untested.

### Interruption modes and Gather acknowledgement

Paul reported success for the three requested alert trials: silent mode produced
neither sound nor vibration, vibration mode produced vibration without sound,
and Do Not Disturb produced neither sound nor vibration. Exact notification
presentation under each mode was not separately reported.

Paul also confirmed the Gather interaction trial: switching focus to Gather alone
kept the test alert ringing, while subsequent genuine interaction inside Gather
stopped it without phone acknowledgement. The instructions allowed either mouse
movement or a harmless click; the specific input used was not separately supplied.

### Real directed wave to the phone

Paul confirmed the real-wave trial: at his desk without a conversation, with
presence temporarily overridden to Available, a colleague's directed wave
triggered the locked phone alert and was acknowledged on the phone. This verifies
the observed Gather wave integration through the alert policy to the phone in
that scenario. It does not establish BLE-derived availability or visit behavior.

### Visitor alert blocked before movement destinations were captured

Paul reported no phone alert when Martin arrived at his desk, although the
session reader correctly listed Martin as a participant. The persisted setup had
an active verified adapter and observed profile targets, but `locations` was empty.
The engine only recognized a desk through captured movement destinations, so the
new visit was silently ineligible at Available presence. The diagnostic position
match was not exposed to the alert policy.

The adapter now exposes `matchedDestination` only through the explicitly selected,
identity-matched structured location integration. The engine uses it when a
captured destination is absent; captured destinations take precedence. The same
classification supports break-room conversation exceptions and reminders. This
does not create movement destinations or enable automatic movement.

Regression tests reproduced the missing desk alert and missing break-room policy
before the fix. Tests now cover arrivals through either feed, deduplication,
conversation suppression, departure cancellation, unknown position, identity
mismatch, and captured destination precedence. All 90 tests passed using
`node --test --test-isolation=none tests/*.test.js`; the syntax check passed.
Desktop restart and a repeated real visitor trial remain required. No new phone
build is needed for this correction.

### Repeated real visitor trial after the position-policy fix

Paul confirmed success after the desktop restart: with presence overridden to
Available and an empty desk baseline, Martin's arrival triggered the phone alert,
and his departure ended it without phone acknowledgement or Gather interaction.
This verifies the initial visitor alert and departure cancellation in the real
desk scenario. Additional-arrival/wave suppression during an established
conversation and desk visits during brief absence remain separate live checks.

### Wave suppression during an established conversation

Paul tested with one colleague and confirmed that a repeated directed wave during
their established conversation produced no additional phone alert after the
initial visitor alert had been acknowledged. He could not test another participant
joining and intends to do that later. Additional-arrival suppression remains
unverified live; the automated coverage is not a substitute for that trial.

### Desk visit while briefly away

Paul confirmed the brief-absence trial: his avatar stayed at the previously
observed brief-away position, presence was overridden to Briefly away, and one
colleague visited the fixed desk without waving or approaching his avatar. The
phone alerted despite Paul having no conversation, and departure ended the alert
without acknowledgement. This verifies fixed-desk monitoring during brief absence;
physical proximity classification was still manually overridden for the trial.

### Break-room notification rules

Paul confirmed the break-room trial with presence overridden to Longer away:
a directed wave produced a normal notification rather than sustained ringing,
and a subsequent visit to his fixed desk produced no additional notification or
alarm. This verifies the combined break-room/longer-away scenario; it does not
independently test break-room rules with a contradictory Available override or
physical away detection.

### BLE discovery failure and BlueZ 5.87 workaround

Paul reported zero calibration samples and `Bluetooth discovery unavailable` with
the Pixel within 15–30 cm. Android showed active advertising and the expected
beacon prefix; the laptop controller was powered. Local service logs recorded
repeated BlueZ 5.87 daemon segmentation faults. The retained stack metadata
included `btd_adapter_device_found` and the same non-executable-address failure
shape documented in [BlueZ issue #2282](https://github.com/bluez/bluez/issues/2282).
The evidence is consistent with that UUID discovery-filter regression.

Gatherway now performs LE discovery without the affected BlueZ UUID filter and
filters observations locally to the paired beacon. It waits for controller power
readiness, requires its own discovery-start acknowledgement rather than another
client's global discovery state, and retries after startup failure, process exit,
timeout or discovery loss. It never powers Bluetooth on automatically. Explicit
stop cancels retries, and old-process callbacks cannot change the replacement
scanner's health. The old Gatherway scanner child was stopped before live testing;
the OS Bluetooth package and configuration were not changed.

All 93 automated tests and the desktop syntax check passed. A standalone run of
the replacement scanner received one paired-phone RSSI value of -69 dBm in 22
seconds. A subsequent 35-second run produced no matched samples. The Bluetooth
daemon PID/start time remained unchanged during these workaround checks. This
supports avoiding the observed crash, but does not establish reliable reception
or adequate sampling cadence. A desktop restart and further in-app sampling are
required before calibration can proceed. The phone companion was restarted via
its UI during diagnosis; no phone build changed. No calibration or movement gates
were enabled.

### First RSSI shown by the running desktop app

After another initially empty in-app collection attempt, BlueZ was observed
actively discovering with a cached RSSI for the paired Pixel and no new daemon
restart. A diagnostic observer received real RSSI and ServiceData changes for that
same device; the existing parser produced a sample. Paul then reported the desktop
showing RSSI -70 while Collecting was stopped. Zero stored calibration samples in
that state is expected. This confirms in-app reception, but sampling cadence and
room separation remain unverified. The next step is a timed in-app collection,
not calculating thresholds from the single displayed RSSI value.

### Sparse BLE reception and explicit LE discovery

Paul reported only four calibration samples in two minutes, then enabled
unrestricted Android battery usage. This cadence is inadequate for presence
classification. The companion was updated to put its service identity and a
changing sequence directly in the primary advertisement. Updates run separately
from HTTP exchanges, with timeout handling and cancellation when the service
stops. The laptop reader now emits each RSSI observation only once, does not
refresh cached RSSI timestamps on metadata changes, and ignores invalid RSSI zero.

A two-second advertising interval still yielded one sample in a 45-second trial.
A 250-ms repeat interval yielded 16 samples in 45 seconds. Paul clarified that he
started the companion a few seconds after installation, which may explain that
trial's initial delay. A second trial with the companion already running yielded
14 samples in 45 seconds, including a 16.9-second gap. Paul confirmed that the
phone remained in the same room, moved within about one meter, and the companion
ran continuously. These results show improvement, but do not pass reception
reliability or room-transition acceptance.

The BlueZ 5.87 client source revealed that `scan on` resets a previously selected
transport filter. Gatherway now starts with `scan le` explicitly, avoiding its own
request for interleaved classic inquiry and LE scanning. The UUID-filter workaround
remains in place. A desktop restart is required to remove the old scan request;
multiple discovery clients have their filters merged. The Bluetooth daemon stayed
running during the preceding measurements. Its package and configuration were
not modified.

All 94 desktop tests, desktop syntax checks, six native unit tests and the Android
release build passed. The updated APK was installed with pairing preserved.
The next standalone measurement with explicit LE discovery received 28 samples
in 45 seconds, with a longest gap of 4.866 seconds and RSSI from -74 to -57 dBm.
This is useful initial cadence evidence after the correction, not proof of room
separation or sustained reliability. The running desktop must load the new scanner
before fresh in-app calibration. Longer continuous reception, screen-off operation,
room separation and battery use still require device validation. No calibration or
movement gate was enabled.

### First calibration groups after the scan correction

Paul reported 55 Available-room samples in somewhat less than two minutes, with
the last displayed RSSI at -72 dBm. He then reported 12 other-room samples in
approximately three minutes, with the last displayed RSSI at -99 dBm. The latter
is a weak received signal and may explain reduced reception, but a single final
RSSI value does not establish distribution separation. The other-room group is
below the required 15 samples. No thresholds have been calculated from these
reported results. The current collection action replaces its selected group;
starting another other-room collection retains the 55 Available-room samples
but replaces the existing 12 other-room samples.

### Timed calibration replaces the packet-count minimum

At Paul's request, calibration now records two minutes of healthy monitoring per
group after a 20-second preparation countdown. It stops automatically, can resume
partial trials, and resets groups explicitly. Fresh phone telemetry, home Wi-Fi,
advertising, companion operation and scanner readiness are required for valid
time. Invalid intervals and desktop timer stalls never become no-signal evidence.
Suspend, pause and disconnect stop collection while preserving accumulated data.

The other-room group can contain fewer than 15 packets or no packets at all.
The Available-room group still needs regular reception. Time-weighted quantiles
screen for overlap without letting bursts dominate. Far-room gaps do not mask
strong observed far-room signals. When far-room RSSI is entirely absent, the exit
threshold uses a six-dBm margin below the measured in-room boundary. This inferred
margin still requires physical transition trials. No packet values or monitoring
duration are reconstructed from Paul's older sample counts.

Automated checks cover zero/sparse far-room reception, in-room reception failure,
overlap, burst versus duration, missing sensor health, stale telemetry, timer
stalls, countdown, stop/resume/reset, UI progress and controller movement gating.
The phone APK did not change for this work. The timed workflow and resulting
thresholds remain unverified on the actual devices. A desktop restart and fresh
timed groups are required. No calibration or movement setting was enabled in
Paul's running installation.

### First timed room trial rejected by separation screening

Paul reported a completed in-room trial with 120 valid seconds, 72 samples,
98% signal availability and two seconds without recent reception. The other-room
trial had 120 valid seconds, 38 samples, 70% signal availability and 36 seconds
without recent reception. Calculate thresholds passed the duration and in-room
reception checks, then rejected the data with the combined overlap/weak-signal
error. The displayed final RSSI was -65 dBm; that is a current reading, not a
stored trial quantile. These summaries do not reveal the actual separation.

Diagnostics now expose the weaker in-room and stronger other-room quantiles,
their margin and the unchanged six-dBm minimum. A too-weak baseline has a separate
error. Automated checks cover these messages and their UI presentation; all 104
desktop tests and the syntax check passed, and the UI tests passed again after
adding the final presentation assertion.
No threshold or calibration guard was relaxed. The running instance retains its
measurements in memory; it has not loaded these diagnostic changes. Paul was asked
whether the phone stayed outside until collection actually completed. He clarified
that he used a stopwatch, entered another room after 15 seconds (before the
20-second collection countdown ended), and returned after approximately three
minutes. This provides about 40 seconds beyond the nominal countdown plus trial
duration, so premature return is not established as the cause. Exact comparison
values remain unavailable from the running version's summary. Physical separation
remains unverified.

### Persistent measurements and multiple real-world profiles

At Paul's request, named profiles now persist independent home SSIDs, measurements
and thresholds in `presence-profiles.json` beside desktop configuration. Checkpoints
run about once per second and save immediately at stop, reset, profile changes and
normal shutdown. Atomic file replacement uses mode 0600. Loaded trials are validated
and always stopped; no offline time, recent RSSI or running timer is restored.
Corrupt/incompatible files are preserved with a visible storage error. Profiles
are scoped to the installation's beacon without storing pairing or Firebase keys.

Switching clears old phone/presence state, overrides and movement verification.
Per-group reset preserves other groups and profiles. Updating an SSID keeps measured
data but requires threshold recalculation. The companion now reports versioned
SSID telemetry and shows the selected profile; unknown Wi-Fi and confirmed Wi-Fi
disconnection remain distinct. Old companion telemetry does not silently use the
wrong home's classification.

All 111 desktop tests, syntax checks for 20 desktop modules and the mobile
TypeScript check passed. The Android release build and six existing native unit
tests passed; the APK was installed with pairing preserved. Tests cover file
reload, selection and threshold retention, partial-trial recovery, invalid files,
failed atomic replacement, reset isolation, UI selection and movement/freshness
gating. Real restart recovery with Paul's newly recorded data and switching between
his apartment and parents' Wi-Fi remain to be verified. A subsequent read-only
check found the user-created active profile saved with mode 0600 and empty trial
groups. The updated phone displayed that profile, Connected · working, active BLE
and home Wi-Fi. This confirms initial live profile synchronization and metadata
persistence, but not yet restart recovery of a recorded trial. Existing measurements in
the pre-update running instance have not been recovered or written to disk. No
profile-dependent calibration or movement was enabled in his running desktop.

## Still required

- Complete and verify the Gather 2.0 profile. Media selectors, incoming waves and
  conversation-state and location probes now have live evidence. Integrated location
  capture and destination controls remain unverified. Desk occupancy transitions
  have been observed live; first desk-visitor phone alerts and departure cancellation
  have also been confirmed. Remaining conversation and absence scenarios need live
  checks. The generic test
  profile is still synthetic, distinct from Paul's observed installation profile.
- Verify any 2.0 teleport mechanism separately. The supplied 1.0 packet has not
  been sent or assumed compatible.
- Extend the initial alert trials to long idle periods,
  notification/full-screen presentation, cancellation, foreground
  services, screen-off BLE, Wi-Fi visibility, and battery use on physical devices.
- Calibrate and validate real room transitions; capture and test actual destinations.
- Run the colleague-based end-to-end acceptance checklist in `SETUP.md`.
- Build/install the Nix package and verify desktop UI behavior in the user's session.

Media safety was activated for the live shutdown trial. Remaining conversation and
failure scenarios are still pending. Movement remains unverified and requires
calibration, three distinct saved destinations, and successful
destination tests. These gates are intentional; passing synthetic tests does not
establish real Gather compatibility.

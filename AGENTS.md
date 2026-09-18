# Gatherway

## Purpose and audience

Gatherway helps Paul stay reachable in otark's Gather virtual office without
constantly watching the screen. It has two main goals:

- Make requests to talk noticeable on his phone, with an alert resembling an
  incoming call.
- Keep his avatar's position consistent with his real-world availability.

The initial audience is Paul. Setup should be repeatable for his brother later,
but broader company rollout is not currently in scope. Preserve the existing
Gather experience and the reliability of everyday office use.

## Language and collaboration

- Keep application text, documentation, and code comments in English.
- Conversation with Paul may be in German.
- Treat the rules below as established product decisions. Do not silently change
  them when making implementation choices.
- Distinguish requested behavior, implemented behavior, and behavior verified in
  actual use. A successful automated test does not prove real-world reliability.

## Availability and avatar position

| Real-world situation | Availability | Intended position |
| --- | --- | --- |
| In the same room as the laptop | Available | Own desk |
| Elsewhere inside the house | Briefly away | Approximately three steps away from the desk |
| Outside the house | Longer away | Break room in the upper-left part of the office |
| Presence cannot be determined reliably | Unknown | Keep the current position |

- Aim to recognize room changes in about five seconds; up to 15 seconds is
  acceptable if needed for reliability.
- Time spent elsewhere inside the house never becomes longer absence merely
  because time has passed.
- The phone represents Paul's presence. If he leaves it at the desk, the system
  may consider him present. Provide a manual override for exceptions.
- Automatic movement starts only from the desk or a position previously chosen
  by the automation. Manually chosen locations remain under the user's control.
- A conversation with another participant protects the current position, even
  when everyone is muted. Conversations in the break room are the exception and
  must not prevent an automatic return.
- Never automatically return from a manually chosen break. After five continuous
  minutes near the laptop while on that break, send one phone notification and
  one desktop reminder instead.
- Walking and teleporting are both acceptable if reliable and verified for the
  current Gather version. Correct arrival matters more than the movement method.

## Requests to talk

| Situation | Directed wave | New visitor |
| --- | --- | --- |
| Available or briefly away | Ring | Ring |
| In the break room or longer away | Normal notification | Ignore |
| Already in a conversation outside the break room | Ignore | Ignore |

- During brief absence, a visit to either the fixed desk or the current avatar
  counts. Mere proximity is not sufficient evidence of a conversation.
- The first visitor can establish a conversation automatically. That connection
  must not suppress the visitor's own initial alert.
- Use actual conversation participants to recognize conversations, not whether
  the microphone or camera happens to be enabled.
- Busy status does not change these alert rules.
- Ring with sound and vibration for at most 45 seconds from the original request.
  Respect silent mode and Do Not Disturb.
- Genuine keyboard or mouse interaction inside Gather acknowledges the alert.
  Merely focusing the window or moving the avatar programmatically does not.
  Also provide explicit acknowledgement on the phone.
- Stop a visitor alert when the visit ends. Duplicate or delayed delivery must
  not restart an acknowledged, canceled, or expired alert.

## Microphone and camera

- After ten continuous seconds without another conversation participant,
  automatically disable both microphone and camera without a notification.
- Reset that timer when another participant joins.
- Never automatically enable microphone or camera. Uncertain conversation or
  media state must not cause a guessed action.

## Working sessions and reliability

- Tie work behavior to being connected to the configured Gather office and provide
  a manual pause control.
- Laptop standby and disconnection are acceptable. On return, wait for a fresh
  connection and fresh state before resuming automation.
- Do not replay old requests or treat existing participants as new arrivals after
  reconnecting.
- Missing presence information means unknown, not absent. Keep the current avatar
  position and make unavailable functionality visible.
- Enable automatic movement only after real destinations and presence recognition
  have been tested successfully. Favor predictable behavior over unsupported
  claims of accuracy.

## Current readiness and reference documents

The application foundation and a phone test build exist. The test APK has been
installed and launched on Paul's Pixel 10 running Android 17. Phone permissions
have been granted; Paul confirmed pairing and FCM token readiness, home-network
recognition, and an initial "Connected - working" status. The start error has been
fixed and verified on the phone. Sender credentials were prepared, and Paul reported
successful initial call-alert/acknowledgement and short locked-screen expiry trials.
Paul also reported successful locked-screen FCM delivery with the phone's
Tailscale connection disabled. Silent, vibration and Do Not Disturb modes passed
the user trials. Paul confirmed that focus alone does not acknowledge an alert,
while genuine Gather interaction does. A real directed wave triggered the phone
alert with availability manually set to Available. After a position-policy fix,
Paul confirmed a real desk visitor triggers the phone alert and departure cancels
it. Paul confirmed that further waves during an established conversation produce
no additional alert. Suppression when another participant joins remains untested
live and is deferred until more colleagues are available. Paul confirmed that a
fixed-desk visit during brief absence alerts without a self conversation and that
departure cancels the alert. These alert trials used manual presence overrides;
long idle behavior and BLE presence accuracy still require testing.
Initial BLE calibration was blocked by missing samples and BlueZ 5.87 daemon
crashes. The scanner now avoids BlueZ UUID filtering, filters for the paired phone
locally, and recovers from discovery failures. Subsequent trials improved sampling
but still contained a 17-second gap with the phone continuously in the same room.
The scanner now explicitly requests LE discovery; its previous start command reset
that choice. One standalone trial after this correction received 28 samples in
45 seconds with a longest gap of 4.9 seconds. Fresh in-app calibration, sustained
reception and room separation remain unverified. Do not treat a Scanning status
alone as proof of proximity detection.
Calibration now uses two minutes of healthy monitoring per group, including
weak or missing BLE reception in other rooms, rather than a minimum packet count.
It includes a countdown, automatic stop, resume and per-group reset. In-room
reception quality and overlapping signal distributions still gate calibration.
Paul completed the first timed groups (in-room 98% signal availability, other
rooms 70%), but threshold calculation rejected their separation/weakness check.
Room separation is not verified. Diagnostics now show the comparison quantiles
and margin; do not infer successful separation from reception percentages alone.
Old sample counts alone cannot establish a timed trial.
Named presence profiles now keep independent home networks, timed measurements
and thresholds in local persistent storage. Progress and the selected profile
survive restarts; collection resumes only on explicit request. Switching places
is manual and resets presence evidence and movement verification. The companion
update for profile-aware Wi-Fi reporting has been installed. Persistence and
switching have automated checks; Paul's real restart and multi-home trials remain
pending. Do not claim that measurements from older in-memory-only versions were
recovered.
Paul subsequently reported a successful threshold calculation: 120 valid seconds
per group, 90% in-room and 72% other-room signal coverage, with -84/-90 dBm
thresholds meeting the 6 dB minimum separation. Paul then reported approximately
three minutes of stable "In your room" on the phone, followed by "Elsewhere at
home" a few seconds after entering another room. This confirms an initial live
outbound transition and the phone's presence display. After being asked to repeat
room changes and returns, Paul reported several successful trials and explicitly
accepted the current profile's room detection as good enough for now. Do not
require further calibration trials before continuing the project. Exact transition
times, carrying positions and long-session reliability were not recorded; leaving
home and other presence profiles have not been accepted by this trial.
The Android home page now separates actual Gather position from inferred presence,
shows live diagnostics and recent changes, and keeps the companion start/stop
control prominent. Pairing and permissions are on a separate Settings page.
Manual destination requests require verified movement and individually tested
saved destinations. Paul confirmed that the button internally named
`leave-meeting-button` returned him to his desk outside a conversation and the
phone showed "At your desk". Desk return is now implemented for that observed
identity and desk, gated by no active conversation and confirmed arrival. Its
programmatic desktop test subsequently moved Paul to the exact desk coordinates
but failed its arrival confirmation. Position-only confirmation now retries
temporary unreadable states during the walking animation within 15 seconds and
reports specific failure diagnostics. The retry confirmed cancellation during the
walk. Ordinary clicks, scrolling and typing now acknowledge alerts without
canceling navigation; explicit movement input still cancels it. Same-document
Gather route updates no longer count as disconnects, and diagnostics retain the
specific interruption source. Paul confirmed the corrected desktop destination
test returns to his desk without errors. Programmatic desk return and its arrival
confirmation are now live-verified outside a conversation. Paul also confirmed
the phone-triggered Go to desk trial, including return and arrival confirmation.
Paul subsequently verified a guarded console call to
`MoveController.moveSpaceUserToTile(user.position.updatedCopy(37, 59), floorId)`
for brief-away movement. The native Position instance is required; a plain
coordinate object failed. The supplied implementation shows that updatedCopy
creates a separate instance. Paul then confirmed the same guarded movement to
the break-room target (27, 51). Both routes are integrated as scoped native
coordinate actions with independent arrival confirmation. The desktop's Set up
coordinate movement action enables manual phone trials for these exact observed
routes. Paul confirmed the requested phone sequence: Step away, Go to break room,
and Go to desk. All three manual phone destinations are now live-verified outside
conversations. Confirmed non-no-op phone movements
count as destination checks, but do not enable automatic movement. Keep automatic
movement disabled until Paul enables it. The first automatic room-transition
trial remains pending, and movement from active break-room conversations is still
unavailable in the current integration.
Incoming waves have been
received through the real Gather 2.0 integration. Conversation-state probes have
been checked in locked, unlocked and absent conversations; the integrated reader
has also been checked without a conversation. Position recognition has been checked
at the desk, brief-away point, break room and on return to the desk. Assigned-desk
occupancy has been checked for visitor arrival and departure while Paul stays
briefly away, without a self conversation. Automatic microphone/camera shutdown
after approximately ten seconds alone has been reported in live use. Conversation
protection has also been confirmed. Paul separately observed immediate microphone
and camera shutdown on conversation exit, which he reports predates Gatherway.
Manual reactivation remains intentional. This host behavior masks the live
leave/rejoin timer-reset test; do not mark that test passed or repeatedly request
the same scenario. Movement and physical-device
behavior remain unverified. Media safety was activated for testing; movement stays
disabled. Update this description as milestones progress.

- [Setup and acceptance checklist](docs/SETUP.md): setup guidance and the scenarios
  to verify with the actual office and phone.
- [Verification record](docs/VERIFICATION.md): completed checks and remaining gaps.

Paul supplied a historical Gather 1.0 teleport example. Its existence does not
establish compatibility with Gather 2.0; do not describe teleporting as supported
until it has been verified there.

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

At the time this file was created, the application foundation and a phone test
build existed, but the real Gather 2.0 connection and physical-device behavior
still required verification. Automatic actions intentionally remained disabled.
Update this description as those milestones are completed.

- [Setup and acceptance checklist](docs/SETUP.md): setup guidance and the scenarios
  to verify with the actual office and phone.
- [Verification record](docs/VERIFICATION.md): completed checks and remaining gaps.

Paul supplied a historical Gather 1.0 teleport example. Its existence does not
establish compatibility with Gather 2.0; do not describe teleporting as supported
until it has been verified there.

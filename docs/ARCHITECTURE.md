# Architecture

## Phase 1

The browser loads a single React page with anchor navigation and a connection status. The page requests `GET /api/health` on its own origin. FastAPI responds with HTTP 200 and `{"status":"ok"}`. The frontend reports a connection failure for a network error, an unexpected response, or a request that exceeds five seconds.

- In local development, Vite serves the UI on port 5173 and proxies `/api/` to Uvicorn on port 8000.
- In Compose, a Node build stage compiles the static frontend. Nginx serves it and forwards `/api/` to the FastAPI container. Compose waits for the backend health check and publishes the frontend port on loopback.
- The backend is the only source of API status. The browser uses the same relative URL in both environments, so the application needs no cross-origin configuration.
- State is limited to the browser's connection status. Phase 1 has no database, audio capture, or provider integrations.

## Phase 2 speech feasibility

The landing page links to a dedicated Speech Lab at `/?view=speech-lab`. The query URL works with the existing Vite and Nginx configurations. The lab supports live microphone recognition and an independent text-only sample mode.

The UI starts a session through the `SpeechProvider` interface. Its browser adapter checks for the standard and prefixed Web Speech constructors, then reports microphone activity, cumulative interim and final results, and terminal events. Each session uses one manually selected language. The provider interface is the integration point for future Sarvam, Gnani, or Whisper adapters.

Speech recognition runs in the browser, which may use its own remote speech service. Results are held in the current view’s memory for inspection and cleared when the user changes mode, starts another run, clears results, or leaves the page. Pasted and scripted sample text never enters the live recognition provider. In Speech Lab, FastAPI receives transcript text only after the user selects **Analyze**.

## Phase 3 transcript analysis

`POST /api/analyze` accepts either a transcript of up to 20,000 Unicode characters or up to eight finalized fragments with text, session-local IDs, and ordered finalization timestamps. It accepts a language (`auto`, `te`, `hi`, `en`, or their `-IN` locale forms) and an optional `session_id`. All rule sets run on every request to cover code-switching. Requests are independent, stay in request memory, and use `no-store` responses. The endpoint receives text only.

The normalizer builds a Unicode-normalized token view with source offsets and a curated lexicon for script variants, spaced acronyms, and common ASR errors. It collapses adjacent repeats of selected words and identical adjacent clauses while retaining separate labeled turns. The engine treats normalized text as a matching representation. Evidence uses exact slices of the input, with zero-based Unicode code-point offsets and an exclusive end. Negation markers stay explicit. Bounded patterns match requests, claims, or threats, and common legitimate contexts suppress specific signals.

### Scoring policy

Adjust the category weights, combinations, and thresholds in `ScoringPolicy` in `backend/app/scam/engine.py`.

| Signal | Points |
| --- | ---: |
| Authority impersonation | 16 |
| Arrest or legal threat | 26 |
| Secrecy or isolation | 18 |
| Financial manipulation | 24 |
| Credential theft | 22 |
| Urgency | 12 |
| Parcel scam | 18 |
| Coercion | 21 |

The engine selects the strongest related group, using one contribution per category. A neutral clause, explicit speaker boundary, or a gap over 12 seconds separates candidate groups. A timestamped group spans at most 25 seconds. A targeted condition or an unfinished request can match across close fragments. Speech Lab text without timestamps uses the available text boundaries. The browser supplies no speaker identification.

Within a group, authority + legal threat + financial manipulation adds 20, credential theft + financial manipulation adds 12, and authority + secrecy adds 10. An authority claim paired with a direct or digital arrest threat adds 12 when there is no payment demand. A safe-account demand with both isolation and call control adds 12. Direct credential demands, safe-account demands, and account-blocking pressure have a caution floor. Direct arrest, explicit disconnect-linked arrest threats, and payment demanded to avoid arrest have a spoken-warning floor. Scores cap at 100 and require multiple categories to reach critical.

Match quality indicates whether an alias was used. Transcript quality describes the available tokens and duplicate removal. Neither changes the score. Quoted text, common reporting cues, and local negation are guarded, but unusual phrasing and ambiguous intent remain possible sources of misses or false alerts.

| Score | Risk level | Recommended action |
| --- | --- | --- |
| 0–29 | Low | `CONTINUE_LISTENING` |
| 30–49 | Suspicious | `SHOW_CAUTION` |
| 50–69 | High caution | `SPOKEN_WARNING` |
| 70–100 | Critical | `FAMILY_RESCUE` |

The score is a heuristic. The engine cannot verify a caller’s identity. Speech Lab displays the result for review.

## Phase 4 Live Guardian

Live Guardian at `/?view=live-guardian` reuses the Web Speech provider with an explicit Start control. It sends bounded, timestamped finalized fragments to the same analyzer used by Speech Lab. Interim text appears only in diagnostics. The browser keeps up to eight unique fragments and 1,600 characters in memory, and expires fragments after 45 seconds even without new speech. The timestamps represent finalization, which can lag the actual utterance.

The latest request supersedes the previous one. Each request has an eight-second deadline, and only the current request can update the score. Errors leave recognition running and the next new speech tries analysis again. Stop, navigation, and recognition termination discard session state and cancel work. The browser’s recognition service may process audio remotely. FastAPI receives transcript text only.

The response action maps to `LISTENING`, `CAUTION`, `WARNING`, or `CRITICAL`. Live Guardian uses the returned evidence fragment IDs to identify continuing warning episodes. Related new evidence can raise the displayed state immediately. A new automatic warning requires fresh supporting evidence, a distinct episode, and a 45-second cooldown. Expiry-only refreshes never play audio. Expired evidence clears the assessment it supported. Otherwise, de-escalation uses two lower assessments at least eight seconds apart. The main view displays Telugu guidance and the analyzer’s availability. Detailed scores and evidence are in collapsed diagnostics. Critical risk directs the elder to contact trusted family.

Playback prefers a Telugu browser synthesis voice and falls back to a bundled Telugu WAV generated offline with eSpeak NG. The microphone is suspended during playback and starts a fresh recognition stream afterward. Browser policy can block automatic playback or automatic microphone resumption. The UI keeps the warning visible on playback failure and shows a restart prompt when recognition ends.

## Phase 5 trusted family voice rescue

Family Setup at `/?view=family-setup` lets a family member record a message up to 30 seconds using MediaRecorder, preview it, and save it alongside a display name and matching caption. It negotiates common browser audio formats and uses the browser default if a listed format is unavailable. Saving replaces one record in this origin’s IndexedDB. The draft stays in memory until saved, and Delete removes the saved record. Browser site-data deletion also removes it. The app sends no family audio, name, or caption to FastAPI. The recording is specific to the browser profile and site origin.

Live Guardian opens the rescue panel on a new, evidence-supported `FAMILY_RESCUE` episode or when the user selects **కుటుంబ సహాయం**. Playback uses one channel for the existing warning, ringtone, and family message. The channel cancels the old playback before starting a new intervention and suspends microphone recognition during audio. It restarts recognition with a new stream after playback or dismissal if monitoring was active. A rescue-specific cooldown limits automatic audio between independent episodes. The panel remains available until dismissed, and replay skips the ringtone.

The panel identifies a saved voice as a prerecorded message. If the record is missing or unreadable, or the browser cannot play its format, a bundled Telugu safety message plays instead. The caption remains visible if the browser blocks playback. If recognition cannot safely restart, the app shows its usual recognition error and the elder can restart monitoring. Calls and remote notifications require separate future workflows.

## Phase 6 family alerts

One family browser and one elder browser share a pair on the same backend. The family device receives a 12-character cryptographically random code and a five-minute deadline. The browser generates a QR locally, with the code in the URL fragment. The elder page removes the fragment, previews the family name, and confirms before the server consumes the code. Invalid attempts are rate limited per source and globally. Pairing issues independent 256-bit opaque bearer credentials. The server keeps hashes, the browser keeps its own credential in origin-scoped local storage, and unlinking either device revokes both credentials and removes the pair and alerts. Unconfirmed devices expire after 30 minutes. Confirmed credentials expire after seven days.

`/api/family/socket` accepts an `auth` message within five seconds after upgrade. Credentials travel in the first WebSocket message. The server returns a `snapshot` scoped to the authenticated pair and broadcasts updated snapshots on presence, protection, publication, or acknowledgement changes. Clients send `ping` every ten seconds and the server returns `pong`. An idle socket expires on the server after 35 seconds. The client reconnects with backoff and stops retrying invalid credentials. Only the elder can send `status` and `publish`. Only the family device can send `ack`, and it must identify the alert and the severity it reviewed. An upgrade resets acknowledgement.

Live Guardian publishes one alert per serious episode and can upgrade it under the same ID. A notice contains a random ID, a threat category, and a protection state. The server adds its timestamp, the configured elder name, a fixed safety explanation, and acknowledgement status. No evidence excerpt, transcript, or audio is sent through the alert channel. Ordinary speech, caution, and manual local rescue without a detected serious episode do not publish alerts. The family sees queued server alerts on reconnect. The elder distinguishes server confirmation from a human acknowledgement. A pending browser alert can retry while Live Guardian stays open. The local warning and recorded voice do not depend on family connectivity.

The store is behind the `FamilyStore` interface. The prototype uses one process, keeps up to 40 alerts per pair, and loses pairings, credentials, and alerts on restart. A durable store and shared pub/sub would be needed for multiple workers. Pairing grants authority to the browser profile that holds the credential. The server validates and scopes events, but does not independently prove that a paired browser’s alert came from speech analysis. It is a prototype without audited production controls. Use trusted HTTPS and WSS, validate origin and host at ingress, and configure trusted proxy addresses and upgrade forwarding.

## Planned boundaries

Interactive demos can use clearly labeled scripted conversations and exercise the downstream assessment and warning flow. External recognition providers require explicit configuration and consent.

Call audio and transcripts remain transient and excluded from logs. Incident reports will use user-approved details and plain text suitable for a Wispr Flow-assisted workflow.

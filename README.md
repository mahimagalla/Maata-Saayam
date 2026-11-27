# Maata-Saayam

Maata-Saayam is a voice safety prototype for older adults in India, with Telugu as the first language priority. The landing page links to Speech Lab and Live Guardian and displays the FastAPI health status.

Speech Lab uses a browser microphone for short recognition tests. Live Guardian listens through the device microphone near a speakerphone. The application does not access native cellular calls.

## Phase 6 family alerts

[Family Guardian](http://127.0.0.1:5173/?view=family-guardian) pairs an elder’s browser with a family member’s browser using a single-use code or QR. The code expires after five minutes, and the elder must confirm the displayed family name and consent. Either device can unlink the pair.

Serious warnings and critical rescue send a categorized alert to the paired family dashboard. The elder can see when the server accepted an alert and when the family member acknowledged it. The alert channel carries no call audio, transcripts, or matched phrases. If the elder voluntarily entered a number, **Contact elder** opens the phone dialer when selected.

Family Setup stores the prerecorded rescue voice separately in the elder’s browser. Local warnings and playback remain available with the family device offline, as long as the analyzer is reachable. Ordinary speech and caution do not send alerts.

## Test Live Guardian

1. Open [Live Guardian](http://127.0.0.1:5173/?view=live-guardian) in a regular desktop Chrome tab. Choose a recognition language and select **పర్యవేక్షణ ప్రారంభించండి** (Start monitoring). Allow microphone access.
2. Set the language to English (India) and say “My son works in the police department.” Expect quiet monitoring. Then try “Send me your OTP for verification” and look for a Telugu instruction to keep the OTP private.
3. Stop, start a fresh session, and say “I am a CBI officer. We will arrest you. Transfer money to the safe account.” Look for **తీవ్ర హెచ్చరిక** (Critical) and listen for the Telugu audio. Results depend on the transcript the browser returns. Expand **విశ్లేషణ వివరాలు** to see the score and evidence.
4. Try the same flow with Telugu selected and say “నేను పోలీస్ అధికారిని. మీరు డిజిటల్ అరెస్ట్ అయ్యారు. వెంటనే డబ్బులు సేఫ్ అకౌంట్ లోకి పంపండి.” Use **హెచ్చరిక మళ్లీ వినండి** (Play warning again) to repeat the warning or recover from a browser playback block.
5. Select **పర్యవేక్షణ ఆపండి** (Stop monitoring). Confirm that the microphone turns off and the session text disappears.

To test the audio fallback, use a device without a Telugu synthesis voice. The [bundled Telugu warning](http://127.0.0.1:5173/audio/telugu-safety-warning.wav) also opens directly in the browser. To test recovery, deny microphone permission, stay silent in a session, or stop the backend while the frontend is running. Live Guardian reports the problem and keeps listening during analysis failures. Use Start again after recognition ends.

## Test trusted family voice rescue

1. Open [Family Setup](http://127.0.0.1:5173/?view=family-setup). Enter a display name such as **అబ్బాయి**. Edit the Telugu caption to match what you will say.
2. Choose **రికార్డ్ చేయండి** (Record), allow the microphone, speak, and stop recording. Preview the draft and save it. Record again and preview a replacement before saving if you want to change the message.
3. Open [Live Guardian](http://127.0.0.1:5173/?view=live-guardian) in the same browser profile. Select **కుటుంబ సహాయం** (Family help). Expect the ringtone, the saved voice and caption, and **ముందుగా రికార్డ్ చేసిన సందేశం** (Prerecorded message). Try replay and dismiss.
4. Start monitoring in English (India). Say “My daughter is calling me” and confirm rescue stays closed. In a fresh session, say “Don't tell your family. Don't hang up. Transfer your money to the safe account.” If the browser captures the whole example, expect the critical rescue panel. Dismiss and verify that monitoring resumes.
5. Delete the saved recording from Family Setup and try manual rescue again. Expect the built-in Telugu safety message. If automatic playback is blocked, press **సందేశం మళ్లీ వినండి** (Replay message).

IndexedDB storage is local to the current site address and browser profile. Saving a replacement or selecting Delete changes the single saved recording. Clearing site data also removes it. Rescue playback is a local intervention. To call a family member, use the phone directly.

## Speech Lab

1. Open the application in a regular desktop Chrome tab at `http://127.0.0.1:5173` and select **Speech Lab**.
2. In **Live microphone**, choose **Telugu (te-IN)**. Select **Start microphone** and allow microphone access when prompted.
3. Say “నమస్తే, మీరు రేపు వస్తారా?” first. Then try “సరే, please call me when you arrive.” Watch the interim text and use **Stop** to let the browser return its final text.
4. Repeat the same mixed phrase under **English (India) (en-IN)**. Under **Hindi (hi-IN)**, try “नमस्ते, आप कल कितने बजे आएँगे?” followed by “ठीक है, please bring the notebook.” Compare the final text with what you said.
5. Switch to **Sample transcript** to paste text or load either bilingual example. This mode works without a microphone. Use **Clear sample** to discard it.

The browser must expose Web Speech recognition and the page must run over HTTPS or loopback. The selected locale is a request to the browser engine. Interim results, locale availability, and mixed-language accuracy depend on that engine, the device, and the network. The browser may send audio to its speech service. Maata-Saayam does not persist audio or transcript text.

## Analyze a transcript

In Speech Lab, select **Sample transcript** and load the scripted scam example or paste your own test text. Select **Analyze** to see the score, evidence, scoring explanation, and recommended action. In live mode, stop recognition and select **Analyze** below the final transcript. Analysis sends only the selected text to the local FastAPI service.

The score is a heuristic for practicing and reviewing suspicious patterns. Recommended actions are displayed for review. The engine requires no external service, API key, or LLM. See the [scoring rules](docs/ARCHITECTURE.md#phase-3-transcript-analysis).

You can also test the endpoint with PowerShell:

```powershell
$body = @{ transcript = 'I am a CBI officer. We will arrest you. Transfer money to the safe account.'; language = 'en-IN' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:5173/api/analyze -Method Post -ContentType 'application/json' -Body $body
```

## Docker Compose

Install and start Docker Desktop with Linux containers enabled. In PowerShell at the repository root, run:

```powershell
docker compose up --build
```

Open [the application](http://127.0.0.1:5173). To verify the API through the same frontend origin, run the following in another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:5173/api/health
```

The response has a `status` field with the value `ok`. In the application, the status should read **Backend connected**. Run `docker compose down` from the repository root to stop and remove the containers. If port 5173 is in use, copy `.env.example` to `.env` and set `APP_PORT` to an available port.

## Windows development without Docker

Install Node.js 24 and Python 3.12 with the Windows Python launcher. Use two PowerShell windows opened at the repository root.

**Terminal 1 · FastAPI**

```powershell
Set-Location backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 · Vite**

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run dev
```

Open [the development application](http://127.0.0.1:5173). The same health check works through Vite. Stop both servers with Ctrl+C before starting Compose on the default port.

## Tests and build

From the repository root after installing the development dependencies:

```powershell
Push-Location backend
.\.venv\Scripts\python.exe -m pytest -q
Pop-Location

npm.cmd --prefix frontend run test
npm.cmd --prefix frontend run build
docker compose config
```

Package and image downloads require network access. Startup requires no external API keys. See [architecture](docs/ARCHITECTURE.md) and the [implementation plan](docs/IMPLEMENTATION_PLAN.md).

## Pair and test on two Windows or mobile devices

Use test names and omit real phone numbers on an HTTP LAN. For an HTTPS deployment, use a trusted certificate on both devices. The default Compose port is loopback-only. To run a LAN test, connect both devices to the same private Wi-Fi and run these commands in PowerShell on the host:

```powershell
Get-NetIPConfiguration
$env:APP_BIND = '0.0.0.0'
docker compose config
docker compose up --build
```

Choose the private IPv4 address from the host’s Wi-Fi adapter. If Windows blocks incoming connections on the private network, run the following in an elevated PowerShell and remove the rule after testing:

```powershell
New-NetFirewallRule -DisplayName 'Maata-Saayam LAN test' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -Profile Private -RemoteAddress LocalSubnet
# After testing
Remove-NetFirewallRule -DisplayName 'Maata-Saayam LAN test'
```

If using the Windows development commands instead of Docker, keep Uvicorn bound to `127.0.0.1:8000`, change the frontend command to `npm.cmd run dev -- --host 0.0.0.0`, and expose only port 5173. The browser must reach the frontend proxy. Do not expose port 8000. Where the Wi-Fi network isolates clients, use a private network that allows device-to-device traffic.

1. On the **family device**, open `http://<host-ip>:5173/?view=family-guardian`, choose **Family device**, enter a display name, and generate a code.
2. On the **elder device**, open Live Guardian and select **కుటుంబ పరికరాన్ని జత చేయండి** (Pair family device). The same link is on the homepage. Enter the code under **జత చేసే కోడ్**, select **కుటుంబ పేరును చూడండి**, and verify the displayed family name. Enter the elder’s name, check the consent box, and select **జత చేయండి · Confirm pairing**. After pairing, Live Guardian’s **జతను చూడండి లేదా తొలగించండి** link opens connection status and **జత తొలగించండి**. This flow is separate from Family Setup, which records the local voice message. Scanning the QR with a phone camera opens the same workflow with the code filled in. The QR uses the current app address, so a QR generated on localhost only works on that machine.
3. For an HTTP LAN test, use the **host computer as the elder device** and open the app at `http://127.0.0.1:5173`. Enter the code manually. This allows microphone access where the browser treats loopback as trustworthy, while the physically separate family device uses the host’s LAN address. For an elder on a different device, serve the app through trusted HTTPS. The browser may block microphone access on a plain LAN IP.
4. Leave Family Guardian open. Enable alert sound if desired. On the elder device, open Live Guardian, start monitoring in English (India), and say “You are under arrest” for a warning. In a new session, say “Do not tell anyone do not disconnect the call transfer the money to a safe account immediately” for critical rescue. If recognition captures the complete utterance, expect **75/100** in diagnostics, the ringtone and saved local voice (or fallback), and one **Family rescue** alert on the phone.
5. Acknowledge the alert in Family Guardian and check the Telugu acknowledgement on the elder’s screen. Close the family page, produce a new serious episode, then reopen it to check delivery from server memory. Unlink either device to revoke both browser credentials.

For deployment, terminate TLS at a trusted proxy and serve the UI and API under one origin. Forward WebSocket upgrades, preserve the public Host header, and forward the original scheme to Uvicorn over a protected hop. If TLS terminates outside the bundled Nginx, configure Nginx to preserve the scheme from that trusted proxy or route `/api/` directly from the TLS proxy to the backend. Set `FAMILY_REQUIRE_HTTPS=1` and `FORWARDED_ALLOW_IPS` to the specific upstream proxy IP or trusted CIDR. Keep the backend and any plain HTTP ingress private. Use one backend process for the in-memory prototype.

### Current limits

- A single backend process holds pairing credentials and up to 40 alerts per pair in memory. Restarting or recreating that backend erases pairings and alert history. Choose **Set up again · మళ్లీ జత చేయండి** and pair again after a restart.
- The family dashboard must be open for immediate alerts. Reopening it after a disconnect shows missed alerts still retained by the same backend. The prototype does not send background push notifications. Audible notifications also depend on browser playback permissions.
- Unconfirmed alerts can retry while the elder’s Live Guardian page remains open. Closing that page discards its pending queue.
- Pairing connects one elder browser and one family browser. It uses device credentials and a shared code, without account identity verification. Clearing browser site data removes the local credential and any saved voice.

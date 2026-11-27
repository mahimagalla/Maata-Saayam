# Maata-Saayam

Maata-Saayam is a voice safety prototype for older adults in India, with Telugu as the first language priority. The landing page links to Speech Lab and Live Guardian and displays the FastAPI health status.

Speech Lab uses a browser microphone for short recognition tests. Live Guardian listens through the device microphone near a speakerphone. The application does not access native cellular calls.

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

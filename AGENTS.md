# Maata-Saayam

Maata-Saayam is a functional prototype for the Scaler × Wispr Flow Build for Bharat Hackathon. It is a multilingual voice guardian for older adults in India, with Telugu as the first language priority.

## Product requirements

- Support microphone-based speakerphone monitoring with explicit consent and interactive scam and genuine-call demos. Never claim to intercept native cellular calls.
- Plan for pluggable multilingual speech recognition, contextual scam risk assessment, spoken warnings, trusted family voice intervention, cross-device guardian alerts, and post-call recovery with Wispr Flow-compatible incident reporting.
- Treat risk assessments as guidance. Make warnings accessible, easy to understand, and actionable in Telugu and English.
- Keep the prototype functional without external API keys. External AI integrations must be optional and configurable. Use actual service behavior for implemented features and clearly label scripted demos.

## Engineering conventions

- Use React, TypeScript, Vite, Tailwind CSS, Python 3.12, and FastAPI. Use WebSockets for real-time events and Web Audio API and MediaRecorder for browser audio when their phases begin.
- Keep dependencies small, commit the frontend lockfile, and run Vitest, Pytest, and the frontend build for relevant changes.
- Keep `docker compose up --build` working from the repository root and document setup changes in the README.
- Use semantic HTML, visible keyboard focus, screen reader announcements, and text alongside audio warnings. Identify Telugu text with `lang="te"`.
- Get approval before advancing beyond Phase 6. Speech Lab analysis stays user-initiated. Live Guardian analyzes finalized speech only after monitoring starts and can play Telugu warnings and a locally recorded family message.

## Privacy constraints

- Never commit secrets. Keep local configuration ignored and put only safe examples in `.env.example`.
- Never persist call recordings or raw transcripts. Keep processing data in memory, discard it when the session ends, and exclude it from logs and analytics.
- Ask for explicit consent before capturing microphone audio, sending audio to an optional provider, or sharing information with a guardian. Minimize shared information.
- Store deliberately recorded family safety messages in this browser's IndexedDB only. Record only after an explicit action and save only after confirmation in Family Setup. Provide replacement and deletion controls. Keep call audio and transcripts out of this storage.
- Pair devices only with explicit consent. Share approved display names, optional contact details, and categorized serious alerts. Keep codes, credentials, audio, transcripts, and matched phrases out of alert payloads and logs. Deploy family pairing over HTTPS and WSS.

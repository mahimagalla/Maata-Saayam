# Implementation plan

Each future phase requires approval before implementation begins.

| Phase | Milestone | Verification |
| --- | --- | --- |
| 1 | Project scaffold, landing navigation, live health endpoint, Docker packaging, and smoke tests | Run Windows development and Compose startup checks where available. Verify health through the frontend origin. |
| 2 | Speech Lab feasibility with browser microphone recognition, a provider interface, and bilingual sample transcripts | Verify lifecycle, denial, silence, and browser fallback. Manually compare Telugu, Hindi, and English on target devices. |
| 3 | Multilingual transcript normalization, rule-based risk assessment, analysis API, and on-demand Speech Lab results | Verify original evidence, multilingual scam patterns, genuine-call regressions, and end-to-end analysis without external providers. |
| 4 | Live Guardian speakerphone monitoring with incremental analysis, risk states, and Telugu spoken warnings | Verify consent, session cleanup, request ordering, warning timing, and the bundled fallback. |
| 5 | Local Family Setup and trusted voice rescue | Verify recording, replacement and deletion, automatic and manual rescue, fallback playback, and microphone recovery. |
| 6 | Cross-device family pairing, live alerts, acknowledgement, and user-initiated elder contact | Verify pairing consent and revocation, role isolation, reconnect, and local protection during outages. |
| 7 | Complete. Telugu-first post-call safety guidance and user-initiated links to official reporting channels | Automated regression coverage for deliberate stop, interruption, rescue playback, fallback audio and ephemeral cleanup. Recovery and the existing alert flow were manually verified on the Docker laptop and phone setup. See the README for setup and limitations. |

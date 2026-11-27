# Implementation plan

Each future phase requires approval before implementation begins.

| Phase | Milestone | Verification |
| --- | --- | --- |
| 1 | Project scaffold, landing navigation, live health endpoint, Docker packaging, and smoke tests | Run Windows development and Compose startup checks where available. Verify health through the frontend origin. |
| 2 | Speech Lab feasibility with browser microphone recognition, a provider interface, and bilingual sample transcripts | Verify lifecycle, denial, silence, and browser fallback. Manually compare Telugu, Hindi, and English on target devices. |
| 3 | Multilingual transcript normalization, rule-based risk assessment, analysis API, and on-demand Speech Lab results | Verify original evidence, multilingual scam patterns, genuine-call regressions, and end-to-end analysis without external providers. |
| 4 | Live Guardian speakerphone monitoring with incremental analysis, risk states, and Telugu spoken warnings | Verify consent, session cleanup, request ordering, warning timing, and the bundled fallback. |
| 5 | Local Family Setup and trusted voice rescue | Verify recording, replacement and deletion, automatic and manual rescue, fallback playback, and microphone recovery. |
| Later | Cross-device guardian alerts, post-call recovery, and Wispr Flow-compatible incident reporting | Verify authorized pairing, delivery, report editing, and deletion of transient session data. |

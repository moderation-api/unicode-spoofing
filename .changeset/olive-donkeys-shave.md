---
'@moderation-api/unicode-spoofing': minor
---

Export the constants behind the analysis, so callers can enumerate values instead of hardcoding strings: `SCRIPT_NAMES` (every script `dominantScript` and `words[].scripts` can report), `SUPPORTED_SCRIPTS`, `PSEUDO_SCRIPTS`, `FORMAT_CHAR_SCRIPTS`, `LEGITIMATE_SCRIPT_COMBINATIONS`, `ZALGO_MARK_RUN`, and the `primaryScript(char)` classifier.

Script-typed fields now use the new `ScriptName` union instead of `string`: `AnalysisResult.dominantScript`, `WordFinding.scripts` and `AnalyzeOptions.expectedScripts`. Runtime behavior is unchanged, but TypeScript callers passing a plain `string[]` to `expectedScripts` will need `ScriptName[]` — which is the point: `expectedScripts: ['Cyrilic']` no longer compiles.

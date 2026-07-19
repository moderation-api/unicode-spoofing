# @moderation-api/unicode-spoofing

## 0.1.1

### Patch Changes

- [#8](https://github.com/moderation-api/unicode-spoofing/pull/8) [`183fae9`](https://github.com/moderation-api/unicode-spoofing/commit/183fae9a23010d3b5b93cc0be424b453b2316c7d) Thanks [@chrisdengso](https://github.com/chrisdengso)! - Docs: document the `illegal` signal (control, non-character, and replacement
  code points) in the signals table, and note that declaring `expectedScripts`
  enables whole-script confusable detection (e.g. all-Cyrillic `аррӏе` → `apple`
  when Latin is expected). No runtime changes.

# Contributing

Thanks for your interest in improving `@moderation-api/unicode-spoofing`.

## Development setup

This repository uses [pnpm](https://pnpm.io/) (see `packageManager` in
`package.json`; `corepack enable` will pick the right version automatically).

```bash
pnpm install
pnpm test        # run the test suite (Vitest)
pnpm build       # emit dist/ (ESM + CJS + types) via tsup
```

Useful scripts:

| Command                         | What it does                                       |
| ------------------------------- | -------------------------------------------------- |
| `pnpm test` / `pnpm test:watch` | Run tests once / in watch mode                     |
| `pnpm test:coverage`            | Tests with coverage report                         |
| `pnpm check-types`              | Typecheck with `tsc --noEmit`                      |
| `pnpm lint`                     | ESLint                                             |
| `pnpm format`                   | Format with Prettier                               |
| `pnpm publint` / `pnpm attw`    | Validate the published package's exports and types |
| `pnpm generate:data`            | Regenerate the UTS #39 confusables table           |

## Found a string we handle wrong? Start with a case (test-first)

The easiest, most valuable contribution is a **case**: a string plus the
behaviour you expected. You don't need to write a fix to open a useful PR.

Everything lives in [`test/cases.data.ts`](./test/cases.data.ts) — a plain array
of cases with a copy-paste template at the top. The flow:

1. **Add your case** to the `CASES` array with `status: 'unsupported'`:

   ```ts
   {
     category: 'digit systems',
     name: 'flags fullwidth digits masquerading as ASCII (１２３)',
     input: 'order １２３ now', // paste RAW — don't "clean" it
     status: 'unsupported',
     expect: { spoofed: true },
     ref: 'https://github.com/moderation-api/unicode-spoofing/issues/123',
   }
   ```

   `unsupported` means "this is a known gap." CI **stays green** — the case
   documents the desired behaviour without breaking the build. Assert only what
   your case is about (`spoofed`, specific `signals`, `normalized`, or an
   affected `word`). Open the PR here; that alone is a great contribution.

2. **Want to fix it too?** Implement it in `src/`. As soon as the library
   satisfies your case, the test runner **fails on purpose** with a message
   telling you to flip `status` to `'supported'`. Do that in the same PR — now
   it's a permanent regression guard.

This applies to false positives as much as misses: a case that says a
legitimate string must **not** be flagged (`expect: { spoofed: false }`) is
just as welcome. False-positive regressions are treated as seriously as missed
detections.

For anything outside the case registry (API changes, new options, refactors),
add ordinary tests alongside the code.

## Before opening a PR

1. Fork and branch from `main`.
2. Run `pnpm lint && pnpm check-types && pnpm test && pnpm build`. CI runs all of
   these plus `publint` and `attw`.
3. **Add a changeset** describing the change:

   ```bash
   pnpm changeset
   ```

   Pick the semver bump and write a one-line summary aimed at users. Commit the
   generated file with your PR. Docs-only or internal-only changes don't need one.

## Updating the Unicode data

The confusables table is generated, not hand-edited. See the README's
"Updating the Unicode data" section. A scheduled workflow opens a PR when the
Unicode Consortium publishes new security data.

## Code style

Prettier and ESLint are the source of truth; run `pnpm format` before pushing.
Keep functions small and prefer clarity over cleverness.

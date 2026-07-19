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

## Making a change

1. Fork and branch from `main`.
2. Add tests. This library is about correctness on adversarial and multilingual
   input — a change without a test that demonstrates it will usually be asked to
   add one. False-positive regressions (flagging legitimate text) are treated as
   seriously as missed detections.
3. Run `pnpm lint && pnpm check-types && pnpm test && pnpm build` before opening
   a PR. CI runs all of these plus `publint` and `attw`.
4. **Add a changeset** describing the change:

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

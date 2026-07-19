# Releasing

Releases are automated with [changesets](https://github.com/changesets/changesets)
and published to npm via **Trusted Publishing (OIDC)** — there is no long-lived
`NPM_TOKEN` secret.

## Day-to-day flow

1. Every user-facing PR includes a changeset (`pnpm changeset`).
2. When those PRs land on `main`, the **Release** workflow opens or updates a
   PR titled **"chore: version packages"** that bumps the version and rewrites
   `CHANGELOG.md`.
3. Merge that PR. The workflow then builds and runs `changeset publish`, which
   publishes the new version to npm, creates the git tag, and pushes a GitHub
   Release.

You never run `npm publish` by hand.

## One-time setup (required before the first publish)

Trusted Publishing must be enabled on npm, and it can only be configured by a
maintainer of the `@moderation-api` npm org:

1. Go to <https://www.npmjs.com/package/@moderation-api/unicode-spoofing/access>
   (or, before the first publish, the org's **Packages → Add trusted publisher**
   flow / your account's publishing settings).
2. Add a **GitHub Actions** trusted publisher with:
   - **Repository:** `moderation-api/unicode-spoofing`
   - **Workflow filename:** `release.yml`
   - **Environment:** _(leave blank)_
3. Ensure two-factor "authorization and publishing" on the org allows automation
   / trusted publishing (Settings → Members / Publishing).

### Bootstrapping the very first version

Trusted Publishing can only be attached to a package name that npm already knows
about. If `@moderation-api/unicode-spoofing` has never been published, do one
manual publish to reserve the name, then switch to the automated flow:

```bash
pnpm build
npm publish --access public --provenance   # requires npm login with 2FA
```

After that first publish, configure the trusted publisher (above) and all
subsequent releases go through the Release workflow with no token.

## Verifying a published package locally

```bash
pnpm build
pnpm publint     # exports/packaging sanity
pnpm attw        # are-the-types-wrong: ESM/CJS type resolution
npm pack --dry-run   # inspect exactly what ships
```

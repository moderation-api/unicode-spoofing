# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).
When you make a user-facing change, add a changeset describing it:

```bash
pnpm changeset
```

Pick the semver bump (patch / minor / major) and write a short summary. The file
it creates is committed alongside your PR. When changesets are merged to `main`,
the release workflow opens (or updates) a "Version Packages" PR; merging that PR
versions the package, updates `CHANGELOG.md`, tags the release, and publishes to
npm.

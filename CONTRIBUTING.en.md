# Contributing · dsh-notify-windows

Thank you for your interest in contributing to this project!

> A DeepSeek Harness (DSH) plugin that sends Windows desktop notifications when the agent needs your attention.

---

## Before you start

- **Environment**: Node.js **>= 20**
- **Package manager**: **npm** (the repo ships a `package-lock.json`) — do not mix in another package manager (it changes dependency resolution and the lockfile).
- **Clone and install**:

  ```bash
  git clone https://github.com/SeverusZh/dsh-notify-windows.git
  cd dsh-notify-windows
  npm ci
  ```

## Local development

### Common commands

| Command | Purpose |
| --- | --- |
| `npm test` | Tests (`node --test "test/*.test.mjs"`) |
| `node scripts/smoke-test.mjs` | Manual smoke test |

### Layout

- `lib/index.js` — plugin entry (host half)
- `lib/notify.ps1`, `lib/launcher.ps1` — Windows-side PowerShell notification implementation
- `test/probe.test.mjs` — tests
- `scripts/smoke-test.mjs` — smoke script
- `cordis.patch.yml` — DSH plugin manifest

## Testing expectations

Pure-logic changes should have tests; changes that affect the actual Windows notification should include Windows-side evidence (screenshot/log) in the description.

- Run everything locally before opening a PR, and paste the real output in the description.

## Notes for this repo

- **This plugin targets Windows**: changes must not break behaviour on **native Windows**.
- Path-related changes (e.g. WSL scenarios) must keep a **fallback** — for example only translate the path when `wslpath` is present and otherwise return it unchanged; **never hard-code a WSL path**.
- Without a Windows machine locally, at least keep the pure-logic parts (argument assembly, escaping, switch decisions) covered by tests.

---

## DSH version compatibility

This plugin runs on top of DeepSeek Harness (DSH). **Compatibility is decided by the
peer declarations in `package.json`** — not by promises in documentation.

### How the gate works

At startup DSH inspects the plugin's `peerDependencies`: entries under the
`@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` prefixes are checked with
**`semver.satisfies(..., { includePrerelease: true })`**. If any entry does not
match the running host, DSH **skips the entire plugin** (the log line tells the
operator they may grant an exact-version exemption with `dsh plugin allow-version`).

> Note: `@deepseek-ai/cordis` is **not** part of this check (the prefix does not
> match), so do not use it to express DSH compatibility.

### How to write the range

Use an **open-ended `>=<lowest verified version>`** (currently `>=0.1.7-rc.1`)
rather than `^0.x`:

- `^0.1.7-rc.1` only covers `0.1.x` in semver, so every host minor bump (e.g.
  0.2.0) re-opens the gate;
- `>=0.1.7-rc.1` covers later versions **provided they were actually verified**,
  so the range does not need editing on every host release.

Widening this range is a **public commitment** and must be backed by real testing.

### The `dsh.compatibility.dshReleases` matrix

`dsh.compatibility.dshReleases` in `package.json` declares compatibility
**per version** (marketplaces/registries read it). Rules:

- **List only versions you actually tested**, marked `compatible`;
- Do **not** list untested versions, and never mark them `compatible` — leave
  them out rather than overstate;
- After upgrading the host, run the commands above first, then add the entry.

## Commits and branches

- **Write commit messages in Chinese**, stating what changed and why; one commit, one purpose.
- **Branches**: use `dev-<DSH version>` for migration/development work (e.g.
  `dev-0.2.1.alpha.2`); **releases go through `main`**.
- Do not force-sync `main` and `dev-*` into each other — they carry different
  responsibilities, and one trailing the other is a normal state.

## Release process (maintainer)

1. **Verify on the `dev-<DSH version>` branch**, then publish an **npm beta**:
   ```bash
   npm publish --tag beta   # never touches latest
   ```
2. **`latest` follows DSH's rc releases only**:
   - adaptations for DSH's **alpha / next** lines ship as **beta only** and do
     not go to `latest`;
   - once the corresponding DSH release reaches **rc**, publish formally.
   > Rationale: the alpha/next interfaces are still moving; binding `latest` to
   > them would leave ordinary users stuck behind the compatibility gate.
3. A **formal release** (to `latest`) requires: a `package.json` version bump, a
   matching `CHANGELOG.md` section, a git tag, a GitHub Release, and
   `npm publish` (default `latest`).
4. **A beta commit only bumps `package.json` and adds no CHANGELOG section**
   (those are written for formal releases).

## Opening a PR

- One PR, one purpose. Keep the scope small.
- Explain the **why** in the description (motive / symptom / root cause); let the
  diff speak for the implementation.
- **Attach reproducible evidence**: which commands you ran and what they actually
  printed. "Tests pass" alone is not evidence.
- PRs that touch `peerDependencies` or the compatibility matrix must include the
  host-version test results.
- CI must be green (where CI exists).

## License

This project is released under the **MIT** license. By contributing you agree to
publish your changes under the same license.


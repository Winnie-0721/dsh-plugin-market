<h1 align="center">deepseek-harness-market</h1>

<p align="center"><strong>English</strong> · <a href="https://github.com/Winnie-0721/dsh-plugin-market/blob/main/plugin-market/README.zh.md">简体中文</a></p>

<p align="center">
  <a href="https://www.npmjs.com/package/deepseek-harness-market"><img alt="npm version" src="https://img.shields.io/npm/v/deepseek-harness-market?label=npm" /></a>
  <a href="https://www.npmjs.com/package/deepseek-harness-market"><img alt="npm downloads" src="https://img.shields.io/npm/dt/deepseek-harness-market?label=downloads%20total" /></a>
  <a href="https://github.com/Winnie-0721/dsh-plugin-market/releases/latest"><img alt="GitHub release" src="https://img.shields.io/github/v/release/Winnie-0721/dsh-plugin-market" /></a>
  <a href="https://github.com/Winnie-0721/dsh-plugin-market/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/Winnie-0721/dsh-plugin-market" /></a>
  <a href="https://github.com/Winnie-0721/dsh-plugin-market/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img alt="DeepSeek Harness 0.2.0-rc.2" src="https://img.shields.io/badge/DeepSeek%20Harness-0.2.0--rc.2-blue" /></a>
</p>

<p align="center"><strong>A plugin market that lives inside DeepSeek Harness.</strong></p>
<p align="center">One entry at the bottom of the sidebar: browse and search the community catalog, install, update, enable / disable, uninstall — all without leaving the GUI.</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Winnie-0721/dsh-plugin-market/main/docs/assets/market-discover.png" alt="Plugin market: Discover / Installed / Updates tabs, search, categories and real plugin cards" width="880" />
</p>

<p align="center">
  <a href="#quick-start"><strong>Install</strong></a> ·
  <a href="#ui-at-a-glance">Gallery</a> ·
  <a href="https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/PLUGIN-MARKET.md">Design doc</a> ·
  <a href="https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md">API contract</a> ·
  <a href="https://github.com/Winnie-0721/dsh-plugin-market/releases/latest">Releases</a>
</p>

## Why it exists

**One-line positioning: this is a DeepSeek Harness plugin market that works like a phone app store** —
browse, inspect, install, update, enable/disable and uninstall, all inside the sidebar, using the same
mental model you already have from installing apps on your phone. Everything below is that positioning made concrete:

- **A big catalog that loads fast.** The community-curated [awesome-dsh-plugin](https://awesome-dsh-plugin.com/plugins.json) catalog with 4400+ entries (updated daily); it reads **npm mirror first with the official URL as fallback**, and fetching, caching, retries and degradation all happen in the host process — the browser only talks to our own endpoints, so the list is always instant.
- **Every update step is visible.** The left button is one merged state machine: “Check for updates → Update all (N) / Check again”; each row updates to x.y.z on its own; every result stays on its own row and a run ends with one **honest** summary (restart-pending counts as success, failure reasons are written verbatim on that row — no sugar-coating).
- **The market updates itself.** It checks for a new build once at startup; when one exists the button goes straight to “Update to x.y.z”. All four states are covered: Update the market → Updating… → Update succeeded → Check again; downloads pass three checks (path shape + `sha256` + artifact self-verification), and after installing it **never pretends it already took effect** — it offers a one-click “Restart DSH” (a detached waiter that relaunches only after the old process is really dead, and the page only reloads after observing the host die once).
- **A tight boundary.** Only installs plugins **in the catalog**, only through the host `pluginManager`, write operations only accept same-origin POST (64 KiB), catalog bundles must pass `dist.integrity` checks, and the market refuses to uninstall itself.
- **It feels like part of the host.** Colors only use the host `--dsw-*` theme tokens (with fallbacks); copy is zh / en and follows the host language; dark / light, narrow viewports and `prefers-reduced-motion` are all handled honestly (the e2e watches every one of them).

## UI at a glance

**The entry sits at the bottom of the sidebar, above the account row, with an updates badge:**

<p align="center">
  <img src="https://raw.githubusercontent.com/Winnie-0721/dsh-plugin-market/main/docs/assets/market-entry-sidebar.png" alt="Plugin market entry at the bottom of the sidebar, with an updates badge" width="640" />
</p>

**The “Updates” page: merged state machine (Update all (2) / Check again), per-row “Update to x.y.z”, inline results and the summary**
(the screenshot below is the acceptance environment: the list is a pair of injected fixture updates — one succeeds pending restart, one fails with a file lock):

<p align="center">
  <img src="https://raw.githubusercontent.com/Winnie-0721/dsh-plugin-market/main/docs/assets/market-updates.png" alt="Updates page: update-all, per-row updates to a specific version, inline success and failure results" width="880" />
</p>

## Quick Start

```sh
dsh plugin --profile web add deepseek-harness-market
```

1. After installing, restart `dsh web` once (or let the desktop app recompose) and refresh — the entry appears at the **bottom** of the sidebar, above the account row.
2. On **Discover**, search or filter by category → click “Install”; the **Installed** tab manages enable / disable and uninstall.
3. The **Updates** tab carries a count badge: the left button runs “Check for updates → Update all (N)” sequentially — one failure never blocks the rest; the right button (“Update the market / Check again”) manages the market's own updates.
4. One-shot Windows install (with profile backup and rollback):

   ```powershell
   pwsh -File scripts\install-into-profile.ps1 -Profile desktop
   ```

5. You can also install straight from the [GitHub Release](https://github.com/Winnie-0721/dsh-plugin-market/releases/latest) assets — every release page lists one copy-paste command.

> Compatible with DSH **0.2.0-rc.2**; the npm package and the GitHub Release are published together; versioning rules and the release process live in [docs/RELEASING.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/RELEASING.md).
> No DSH yet? `npx @deepseek-ai/dsh web` starts a local instance.

## How it works

One npm package carries both halves, installed into the host per the official plugin spec:

- **Host half (repo process)**: a Cordis function plugin that only named-exports `name` / `inject` / `apply`; `ctx.webServer` registers a single prefix route, and `ctx.get('pluginManager')` optionally bridges install capabilities. Catalog fetching, caching, retries, verification and self-update downloads all happen here — **the browser never touches the network or the filesystem**.
- **Client half (browser)**: `lib/client.js`, a single-file bundle registered through `window.__ModuleLoader__.load({ id, factory })`, with zero dependencies beyond `require("react")`.
- **Seats and declarations**: the entry registers the official `sidebar.footer.action`, the panel registers the `plugin-market` key on `main`, navigation goes through `ctx.layout.selectPanel`; `package.json` declares `dsh.bundle.patch` (the bundle patch layer) and `dsh.client` (`platform: web` plus the `./client` export).
- **The contract is frozen**: host ↔ client endpoints, responses and error codes are governed by [docs/API-CONTRACT.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md) — update the docs and regression tests before changing the contract; the line-by-line comparison against the official spec is in [docs/PLUGIN-MARKET.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/PLUGIN-MARKET.md).

## Data sources

| Order | Source | Address | Measured locally |
|---|---|---|---|
| 1 | **npm mirror (preferred)** | the `dsh-plugin-catalog` package | **289 ms** |
| 2 | Official URL (fallback) | `awesome-dsh-plugin.com/plugins.json` | 25–93 s (times out) |

The fallback is necessary: DSH only honors the `HTTP(S)_PROXY` environment variables and ignores the Windows system proxy, while the official source sits on GitHub Pages.
Override the defaults with `DSHM_REGISTRY_URL` / `DSHM_NPM_MIRROR`.

This project **re-implements** the official plugin spec, taking catalog sources and product decisions from [dsh-market](https://github.com/dsh-market/dsh-market) as a reference but copying none of it: the feature surface is narrowed down to one loop — installing and managing plugins from the sidebar.

## Security boundary

- Only plugins **in the catalog** may be installed; catalog entries carrying `dist.integrity` must pass verification before use.
- Install / uninstall / enable / disable go only through the host `pluginManager` — the same path and the same build-script approval rules as `dsh plugin add`.
- Write operations only accept **same-origin POST** (64 KiB cap); no cross-origin requests, no GET that mutates state.
- The market **refuses to uninstall itself**.
- The self-update trust anchor is a manifest hash (three checks: path shape + `sha256` + artifact self-verification): new versions take `sha256` straight from the GitHub attachment `digest`, older ones from `index.json`; it stops corruption, truncation and single-point replacement, but not “manifest and artifact swapped together” — stated honestly in [API-CONTRACT §2.9](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md), never masquerading as an independent signature.

[Design & security decisions](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/PLUGIN-MARKET.md) · [Known limitations](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/PLUGIN-MARKET.md#7-已知限制与后续工作) · [API contract](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md)

## Development and acceptance

```sh
# Real-browser e2e: boots a scratch host + headless Edge, asserts on the real engine and saves screenshots
pwsh -File verify\ui-check.ps1

# Release gate: node --check + every verify/*.test.mjs (no version bump, no packing, no publishing)
pwsh -File scripts\release.ps1 -LocalOnly

# Official release (local stops here): gate → bump → commit → tag → push
# The pushed tag triggers GitHub Actions: pack → GitHub Release assets → npm (rollbacks download the assets too)
pwsh -File scripts\release.ps1 -Bump patch
```

All regression tests live in `verify/*.test.mjs` (copy keys, state machines, install spec, self-update channel, source classification…), and the release gate runs them one by one;
the independent acceptance report is [verify/REPORT.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/verify/REPORT.md).

## Repository layout

| Path | Contents |
|---|---|
| [plugin-market/](https://github.com/Winnie-0721/dsh-plugin-market/tree/main/plugin-market) | The plugin package itself: host half (`lib/index.js` / `catalog.js` / `catalog-npm.js` / `http.js` / `self-update.js` / `restart*.js`) + web client half (`lib/client.js`, single-file bundle) + `cordis.patch.yml` |
| [docs/API-CONTRACT.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md) | The frozen host ↔ client contract (endpoints, response conventions, catalog fetching strategy) |
| [docs/PLUGIN-MARKET.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/PLUGIN-MARKET.md) | Design and line-by-line comparison with the official spec, data-source decisions, security decisions, limitations, acceptance results |
| [docs/TEAM-BRIEF.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/TEAM-BRIEF.md) | Implementation-period environment facts and API signatures (for collaboration / reproduction) |
| [scripts/](https://github.com/Winnie-0721/dsh-plugin-market/tree/main/scripts) | Install / rollback and release scripts |
| [verify/](https://github.com/Winnie-0721/dsh-plugin-market/tree/main/verify) | Regression tests + real-browser e2e + the independent acceptance report |

## License

MIT. The catalog data and its source repository are licensed by [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin); this repository contains no third-party source code.

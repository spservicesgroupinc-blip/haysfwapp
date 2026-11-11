# PWA Code Inspector

A DeepSeek Harness plugin that is a professional PWA web app developer:
it inspects web apps, formats them for smartphones, and finds issues with
flows in logic — from a panel in the DSH Web UI.

## What it does

- **Smartphone formatting audit** — viewport meta, device-width, zoom
  availability, small fonts, fixed pixel widths, missing media queries.
- **PWA readiness audit** — manifest (name, icons 192/512 + maskable,
  start_url, display), service worker reachability, HTTPS, theme-color,
  Apple touch icon.
- **Logic-flow static scan** — assignment-in-condition, loose equality in
  conditions, switches without default, string timers, unhandled promise
  chains, `document.write`, blocking dialogs, `for…in` misuse — with
  locations and fix guidance.
- **Device preview** — iPhone SE / 14, Pixel 7, iPad, and desktop widths;
  the fetched page renders in a sandboxed frame (scripts disabled) so the
  static layout at device width is visible.
- **Expert handoff** — one click copies a prompt that asks the assistant to
  act as a professional PWA web app developer and fix the findings.

## Entry points

| Surface | How |
|---|---|
| Sidebar panel | The PWA Code Inspector icon in the sidebar |
| Agent tool | `webapp_inspect` — callable by the assistant |
| Chat command | `/pwa-inspect https://example.com` |
| Skill | `pwa-webapp-inspector` — the expert persona in the skill catalog |

## Structure

- `index.js` — Host half: inspection engine, `/pwa-inspector/inspect` data
  route, the `webapp_inspect` tool, the `/pwa-inspect` command, and the
  `pwa-webapp-inspector` skill.
- `client.js` — Client half: sidebar icon and the main panel (React from the
  platform module table, theme-token styling).
- `cordis.patch.yml` — bundle patch with one row named after the package.
- `locale/` — display metadata in English and Chinese.

No build step and no runtime dependencies; the bundle installs as-is.

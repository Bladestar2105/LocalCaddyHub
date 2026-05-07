# LocalCaddyHub admin UI kit

Hi-fi recreation of the LocalCaddyHub admin interface, redesigned with the BW.Tech system.

## Files
- `index.html` — entrypoint, mounts the React app
- `admin.css` — all admin styles + tokens
- `Icons.jsx` — Lucide-style stroke-only inline SVG icons
- `Sidebar.jsx` / `Topbar.jsx` — chrome
- `PageGeneral.jsx` — global Caddy config (server/logging/TLS/timeouts)
- `PageReverseProxy.jsx` — Domains / Subdomains / Handlers / Access lists / Basic auth / Headers (subtabs)
- `PageLayer4.jsx` — TCP/UDP routes
- `PageCerts.jsx` — ACME table + PFX export
- `PageControl.jsx` — process control + raw Caddyfile
- `PageLogs.jsx` — live log viewer with filters
- `PageStats.jsx` — KPI grid; also exports `Modal` and `AuthScreen`

## Click-through
- Default lands authed on Reverse Proxy. Sidebar navigates between every tab. "+ Add" buttons in RP/L4 open a modal. Apply Configuration switches from "pending" to "applied" with the green inline status box.
- To preview the auth screen, change `useState(true)` → `useState(false)` in `App` inside `index.html` (default-on so the kit demos the populated UI).

## Scope cuts
- No live API binding; all data is in `DATA` / `L4_ROWS` / `CERTS` / `STATS` / `LOG_LINES` constants in `index.html`.
- DnD reordering is visual only.
- 2FA flow shown but not validated.

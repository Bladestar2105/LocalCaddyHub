# BW.Tech / LocalCaddyHub Design System

A unified design system for **BW.Tech** — a German "Cloud by Design" consultancy (bw.tech) — and its open-source product **LocalCaddyHub**, a web admin UI for Caddy with NTLM and Layer-4 support.

This system replaces the existing Bootswatch-Darkly look with a fresh, brand-coherent visual language that ties the marketing site (bw.tech) and the product (LocalCaddyHub) together. Functionality is preserved 1:1 — only the surface is new.

## Sources

- **Codebase:** [github.com/Bladestar2105/LocalCaddyHub](https://github.com/Bladestar2105/LocalCaddyHub) — files imported into `static/` (index.html, login.html, setup.html, app.js).
- **Marketing site:** [bw.tech](https://bw.tech) — content scraped (German), brand imagery is hotlink-protected; we work from descriptions and placeholders.
- **Product README:** [github.com/Bladestar2105/LocalCaddyHub/blob/main/README.md](https://github.com/Bladestar2105/LocalCaddyHub/blob/main/README.md)

## Products covered

1. **bw.tech marketing site** — German B2B landing site for cloud/backup/managed-services/AI-hosting solutions. Conversion goal: contact form. Existing site uses Elementor + WordPress.
2. **LocalCaddyHub admin UI** — single-page web app to manage a Caddy instance: domains, subdomains, handlers, access lists, basic auth, headers, layer-4 routes, TLS certificates, process control, raw Caddyfile, live logs. The redesign keeps every tab and field, modernizes layout/density/typography, and unifies it with the BW.Tech brand.

## What we are NOT changing

- API surface, route names, field names — `app.js` keeps working.
- Tabs and tab structure of the admin UI.
- The German + English bilingual story (`i18n.js`).

## Index — files in this system

| File | Purpose |
|---|---|
| `README.md` | this file — context, content + visual foundations, iconography |
| `colors_and_type.css` | CSS custom properties for colors, type scale, semantic tokens |
| `SKILL.md` | Agent-skill descriptor — `bwtech-design` |
| `assets/` | logos, icons, marks, brand imagery (placeholders where not accessible) |
| `fonts/` | webfonts (Google Fonts CDN — see colors_and_type.css) |
| `preview/` | individual design-system cards (Type, Colors, Spacing, Components, Brand) |
| `ui_kits/localcaddyhub/` | hi-fi recreation of the Caddy admin app |
| `ui_kits/bwtech_marketing/` | hi-fi recreation of the bw.tech marketing site |
| `static/` | original LocalCaddyHub source (imported, read-only reference) |

## Content fundamentals

### Voice — bw.tech (marketing)

- **Language:** **German first**, English second. The marketing surface is German.
- **Address form:** formal **"Sie"** — never "du". This is a B2B IT consultancy speaking to decision-makers (CIOs, IT-Leiter, Geschäftsführer).
- **Tone:** trustworthy, plain-spoken, confident-but-modest. Self-described values: *ehrlich, offen, kundenorientiert* (honest, open, customer-focused). The site's signature line — "Maßgeschneiderte Cloud-Lösungen, die Sie voranbringen. Mit BW.Tech erhalten Sie nicht nur die Lösung, die Sie wollen – sondern die, die Sie brauchen." — is the canonical voice: a contrast pair, em-dash for emphasis, no superlatives.
- **Casing:** sentence case for body, Title Case for nav/headings. The brand mark is **BW.Tech** (period in the middle, capital B-W-T). The tagline is **Cloud by Design** (not "Cloud-by-Design").
- **Buzzwords to avoid:** "synergy", "leverage", "next-gen", "revolutionary". The site uses concrete nouns: *Backup*, *Restore*, *Desaster-Recovery*, *Datenverfügbarkeit*, *serverübergreifende Sicherung*.
- **Emoji:** none. Never.
- **Punctuation quirks:** German em-dash (–, the en-dash with spaces, German typographic convention) for asides. "Anführungszeichen" („…") in testimonials.

### Voice — LocalCaddyHub (product)

- **Address form:** terse imperative — "Apply Configuration", "Validate", "Start", "Stop", "Reload", "+ Add Domain". Buttons are verbs, not noun-phrases.
- **Field labels:** noun phrases — "HTTP Port", "Read Body Timeout", "TLS Email". Help text in italics, prefixed with "(?)".
- **Tone:** sysadmin-direct. Assume the reader knows what NTLM, ACME, ECDSA, SNI mean. Don't explain — link or footnote.
- **Casing:** Title Case for tab labels, sentence case for help text, ALL CAPS only for log levels (INFO/WARN/ERROR/DEBUG) and protocol acronyms.
- **Status writing:** factual, no exclamations. "Configuration applied." not "Configuration applied! 🎉". Errors are blunt: "Invalid username or password."
- **Bilingual:** every visible string runs through `i18n.t()`. German translations are formal-Sie matching the marketing voice.

### Universal rules

- One sentence per idea. Long technical paragraphs split into short ones.
- Lists over prose for any enumeration ≥ 3 items.
- Code, file paths, env vars, ports, durations always in `monospace` inline.
- Don't capitalize random Words. Don't use ™ or ®.

## Visual foundations

### Color philosophy

The system is built on a **dark, instrument-panel aesthetic** — this is admin software for infrastructure people, and the marketing site sells reliability. The brand color anchors are:

- **Deep navy** (`#0B1B2B`) — primary surface, replaces Darkly's washed-out `#222`. Reads as serious, datacenter.
- **Steel blue** (`#3D8BFF`) — primary accent for actions, links, focus rings. Not the cliché SaaS-blue; pulled toward a slightly cooler, more electric tone to work on dark.
- **Caddy teal** (`#2EBFA5`) — secondary accent, used for "running"/"healthy"/"go" states. Honors the original `#008080` Caddy nod, but with more vibrancy.
- **Amber** (`#F5A524`) — warnings, "reload required", reverse-proxy diff badges.
- **Crimson** (`#E5484D`) — destructive actions, errors, stop button.
- **Neutrals:** a 12-step gray ramp (`--gray-1` … `--gray-12`) running near-black to off-white, all slightly blue-tinted to harmonize with the navy.

Color usage rules:
- **Never** combine teal and amber in the same component (low contrast).
- Status dots/badges use solid color + 12% tint background, never gradient.
- Imagery is treated **cool** — desaturated, slight blue-shift in shadows. No warm sepia or grain.

### Typography

- **Display + UI:** **Geist** (Vercel, OFL — Google Fonts). Sharp, geometric, modern; excellent German diacritics. Replaces the marketing site's default Elementor font. Weights used: 400, 500, 600, 700, 800, 900.
- **Body fallback:** system stack — `'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, ...`
- **Monospace:** **Geist Mono** for the raw Caddyfile, log viewer, code snippets, port numbers in tables. Same family DNA as the display face — they pair perfectly. 400, 500, 600, 700.
- **Scale (admin UI, dense):** 12 / 13 / 14 / 16 / 20 / 24 / 32. Body is 14px; tab labels 13px; field labels 12px uppercase tracked.
- **Scale (marketing, expressive):** 16 / 20 / 28 / 40 / 56 / 80 / 112. Hero headline is 80–112px on desktop, with `text-wrap: balance`.
- **Letter-spacing:** tight on display (-0.02em at 56px+), neutral on body, +0.06em on uppercased eyebrows/labels.

### Spacing

- 4px base grid. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.
- Admin UI density: form-row gap 12px, section gap 32px, card padding 16–20px.
- Marketing density: section vertical rhythm 96–128px, content max-width 1200px.

### Backgrounds

- **Admin:** flat navy (`--gray-2`) base. **No gradients on chrome.** Cards are 1 step lighter (`--gray-3`) with a 1px border in `--gray-5`. The login screen uses a single, very subtle radial glow centered on the card to add depth without noise.
- **Marketing:** alternating navy and pale-slate sections to chunk content. **One** full-bleed hero image at the top. Cards on light sections: white with 1px border `--gray-4-light`, hairline shadow.
- **Patterns:** a subtle dot-grid (1px dots, 24px spacing, 6% opacity) is allowed on hero/empty states. No noise textures, no glassmorphism.
- **Gradients:** allowed exactly twice — (1) a 30% navy→transparent **scrim** under hero text, (2) a thin 1px-tall navy→teal underline that decorates the active tab.

### Animation

- **Easing:** standard `cubic-bezier(0.2, 0, 0, 1)` (out-expo-ish) for nearly everything. Spring/bounce only on the dnd handles in the admin UI (subtle).
- **Duration:** 120ms (micro: hover), 200ms (default: tabs/menus), 320ms (page-level: modals). Never longer than 400ms.
- **Fades:** crossfade on tab switch (200ms). No slide-in from the side — felt aggressive in testing.
- **Reduced motion:** respected — `@media (prefers-reduced-motion: reduce)` collapses all transitions to 0ms.

### Hover / press

- **Hover (buttons):** background lightens by ~6% (admin) or darkens by ~6% (marketing light cards). 120ms.
- **Hover (text links):** underline-thickness goes 1→2px, no color change.
- **Hover (table rows):** `--gray-3` → `--gray-4` background tint, full row.
- **Press:** `transform: translateY(1px)` + 8% darker bg. 80ms.
- **Focus:** **always** a 2px outline in `--blue-9` with 2px offset. We do not remove focus rings.
- **Disabled:** 40% opacity, `cursor: not-allowed`. No grayscale filter.

### Borders + radii

- Hairlines: 1px, `--gray-5` (admin) / `--gray-4-light` (marketing).
- Radii — **deliberately small**: `--radius-1: 4px` (inputs, buttons, tags), `--radius-2: 8px` (cards), `--radius-3: 12px` (modals, hero cards). Pills (`9999px`) only for status badges. We avoid the "everything is 16-24px rounded" SaaS look.

### Shadows + elevation

A 4-step elevation system, **subtle on dark, more pronounced on light**:
- `--shadow-1`: `0 1px 2px rgba(0,0,0,0.4)` — table rows, sticky bars.
- `--shadow-2`: `0 4px 12px rgba(0,0,0,0.35)` — dropdowns, popovers.
- `--shadow-3`: `0 12px 32px rgba(0,0,0,0.45)` — modals.
- `--shadow-4`: `0 24px 64px rgba(0,0,0,0.55)` — full-screen overlays / hero cards on marketing.
- **No inner shadows** anywhere except on `<input>` focus, where a 0 0 0 3px tinted glow stands in for an inset.

### Cards

Three card variants:
1. **Data card** (admin) — `--gray-3` bg, 1px `--gray-5` border, `--radius-2`, no shadow. Header row uses `--gray-4` bg.
2. **Action card** (admin sidebar / quick-actions) — `--gray-3` bg, 1px `--blue-7` accent border on the left edge **only when active** (otherwise 1px `--gray-5` all sides). 4px hover-lift.
3. **Marketing card** — white bg, 1px `--gray-4-light` border, `--radius-3`, `--shadow-2` on hover.

We **do not** use the "rounded card with colored left-stripe" pattern as a default — it's overused and signals "AI slop". The accent border above appears only on active state.

### Layout rules

- **Admin shell:** persistent left sidebar (240px), top bar (56px), main content. Sidebar collapses to 64px icon-rail on `<1280px`.
- **Marketing:** sticky transparent → solid-on-scroll top nav (72px), full-width sections, content max-width 1200px, gutters 24px.
- **Z-index scale:** 10 (sticky), 100 (dropdown), 1000 (modal), 9999 (toast).

### Transparency + blur

- **Sticky top nav** uses `backdrop-filter: blur(12px)` over a 60% navy background once scrolled. Never on the admin UI.
- **Modal backdrop:** flat `rgba(0,0,0,0.6)`, no blur — speed matters in admin tools.
- **Tooltips:** opaque, no blur.

### Imagery treatment

- All photography is **cool and slightly desaturated** (saturation 85%, +3 blue tint in shadows). bw.tech's team photos and contact imagery follow this.
- **No stock-photo gradients overlaid.** A single 30% navy scrim from bottom for caption legibility, that's it.
- **No grain, no noise filters.** Clean images.
- Logos of partner companies on the marketing page are rendered in `--gray-9` (medium gray) so they sit calmly and don't fight for attention; full-color on hover.

### Layout fixed elements (admin)

- Top bar: `Apply Configuration` and `Validate` buttons stay sticky-left; language picker, 2FA, logout stay sticky-right. The status box appears inline between them, not as a toast.
- Tab strip is sticky at the top of the content area (under top bar) when scrolling long forms.

## Iconography

We use **Lucide** ([lucide.dev](https://lucide.dev), MIT) loaded from CDN. The original LocalCaddyHub UI ships **zero icons** — the redesign adds a curated set:

- **Stroke-only**, 1.5px stroke weight, 20px default size (16px in dense tables, 24px in section headers).
- Color follows context — `currentColor` is the rule, no multicolor icons.
- Common-use mapping:
  - `globe` — Domain
  - `git-branch` — Subdomain
  - `arrow-right-left` — Handler / Reverse Proxy
  - `network` — Layer 4
  - `shield-check` — TLS Certificates
  - `terminal` — Control & Raw / Caddyfile
  - `scroll-text` — Live Logs
  - `users` — Access Lists
  - `key-round` — Basic Auth
  - `play` / `square` / `refresh-cw` — Start / Stop / Reload
  - `circle-check` / `circle-alert` / `circle-x` — Status states

**Brand mark:** `assets/bwtech-logo.svg` — drawn for this system as a placeholder (the bw.tech site logo is hotlink-protected and could not be imported). It uses the typographic mark **BW.Tech** in Manrope ExtraBold with the period in `--blue-9`. **⚠ This is a substitution — please provide the official BW.Tech logo SVG and we will swap it in.**

**Product mark:** `assets/localcaddyhub-mark.svg` — a small geometric mark pairing the network glyph with the BW.Tech wordmark.

**Emoji:** none, anywhere.

**Unicode chars used as icons:** none in chrome. Inside log output, `→` for redirects and `✓`/`✗` for status are allowed (monospace context).

## Caveats

- **Logo / brand asset substitution:** bw.tech's CDN is hotlink-protected. The logos and team photos in this system are placeholders drawn in code or solid colored blocks. Please drop the official BW.Tech logo (SVG preferred), partner logos, and team photos into `assets/` to make this production-ready.
- **Font choice:** **Geist + Geist Mono** (Vercel, OFL). Coherent display + mono pair, sharp, modern, excellent diacritics for German. If you have a brand-defined typeface, drop a `.woff2` in `fonts/` and update `colors_and_type.css` if you want a different family.
- **No Figma:** none was attached, so the spacing and component definitions here are derived from reading the LocalCaddyHub source directly and inferring marketing-side patterns from the rendered site.

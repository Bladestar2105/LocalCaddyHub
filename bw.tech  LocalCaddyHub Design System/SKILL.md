---
name: bwtech-design
description: Use this skill to generate well-branded interfaces and assets for BW.Tech (a German "Cloud by Design" consultancy) and its open-source product LocalCaddyHub (a Caddy admin UI with NTLM and Layer-4 support), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick map

- `README.md` — voice, content fundamentals, visual foundations, iconography (read this first)
- `colors_and_type.css` — copy this into any new HTML to inherit the full token system
- `assets/` — brand marks (BW.Tech wordmark, LocalCaddyHub mark, light variant)
- `preview/` — small per-token cards (colors, type, spacing, components, brand) — useful to grep for the exact value of a token
- `ui_kits/localcaddyhub/` — reference recreation of the Caddy admin app: copy `Icons.jsx`, `Sidebar.jsx`, page components straight into a new prototype
- `ui_kits/bwtech_marketing/` — reference recreation of the German B2B marketing site

## Two products, two voices

- **bw.tech (marketing):** German-first, formal "Sie", trustworthy + plain. No emoji, no buzzwords. Display type **Geist** at 800/900, big numbers, dark stats bands.
- **LocalCaddyHub (admin):** sysadmin-direct, terse imperatives ("Apply Configuration", "Reload"). Dense forms, dark navy chrome, **Geist Mono** in tables/logs, status dots + tinted badges.

When unsure which product, default to admin tone for technical surfaces and marketing tone for any consumer-facing copy.

# bw.tech Marketing UI kit

A static HTML/CSS recreation of the BW.Tech marketing site, refreshed for the new design system. German-first copy, formal "Sie" voice.

## Files
- `index.html` — full single-page site (hero · solutions · product spotlight · stats · testimonial · services · CTA · footer)
- `site.css` — all marketing styles, scoped under `.m-*` / token vars

## Sections
1. **Sticky nav** with brand mark, German nav links, language toggle (DE active), primary CTA
2. **Hero** — display headline (~96px), Cloud-by-Design eyebrow, code-mockup of generated Caddyfile in the visual slot
3. **Logos strip** — placeholder partner names rendered as muted wordmarks (replace with real SVGs)
4. **Solutions grid** (4 cards) — Backup & Restore · Desaster Recovery · Managed Cloud · KI-Hosting
5. **Product spotlight** — LocalCaddyHub with feature checklist + live status mock
6. **Dark stats band** — 4 KPI numbers with `--brand-blue` units
7. **Testimonial** — long-form German quote with avatar attribution
8. **Service packages** — 3 tiers (Discover / Build & Hand-Over / Managed Ops)
9. **CTA band** — dark navy with dot-grid pattern
10. **Footer** — 4-column with Impressum/Datenschutz/AGB

## Tokens used
All `--m-*` tokens are defined locally in `site.css`. They mirror the global `colors_and_type.css` scale but reverse fg/bg for light-mode marketing surfaces.

## Replace before production
- Partner logos (logos-strip): currently `<span class="logo">` text — drop in real SVGs.
- Hero visual: currently a code-mockup of a Caddyfile. Could become a product screenshot or team photo.
- Testimonial avatar: currently a gradient initial; replace with `<img>`.

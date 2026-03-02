## 2024-03-14 - Modal Input Accessibility
**Learning:** The LocalCaddyHub UI heavily relies on dynamically generated Bootstrap 5 modals in `static/app.js` (`app.ui.initModals`). These dynamically injected forms lacked `id` attributes on inputs and corresponding `for` attributes on labels, causing accessibility issues for screen readers and preventing click-to-focus behavior.
**Action:** When working with dynamically generated HTML strings in this codebase (especially for modals), always ensure standard HTML accessibility attributes (`id`, `for`, `aria-*`) are explicitly included in the template strings, as they are not automatically applied.

## 2024-05-19 - Fix Dark Theme Readability
**Learning:** Bootstrap utility classes like `bg-light` can cause unreadable text (white-on-white) when inheriting text colors in dark themes like Bootswatch Darkly. Additionally, default text colors like `.text-muted` or link colors may lack sufficient contrast against very dark backgrounds.
**Action:** Always verify text and background color combinations when using utility classes. Avoid mixing light backgrounds with inherited text in dark themes, and override classes like `.text-muted` or custom link colors to meet contrast requirements (e.g., `#adb5bd`) on dark backgrounds.

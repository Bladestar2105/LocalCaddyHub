## 2024-05-14 - Loading States for Primary Actions
**Learning:** This application involves multiple user actions that trigger backend API calls (saving config, validating config, logging in, setup). Since there was no visual feedback indicating that a request was in progress, users might be tempted to click the buttons multiple times, potentially leading to redundant API calls or confusion. Adding a visual loading indicator (like a spinner) and disabling the button prevents multiple submissions and significantly improves the perceived responsiveness of the application.
**Action:** Always verify if async UI actions, especially ones triggering backend configuration changes or authentication requests, provide clear loading states and temporarily disable their triggers to prevent duplicate submissions.

## 2025-02-12 - Add Loading State to Caddy Control Buttons
**Learning:** Async operations like starting, stopping, or reloading the Caddy process lacked visual feedback, which could lead to duplicate clicks and confusion.
**Action:** When implementing async actions that take time (e.g., process control via API calls), always provide a visual indicator (like a loading spinner) and temporarily disable the trigger button to prevent duplicate submissions and improve user confidence. This can be easily achieved by modifying the function to accept the button element (`this`) and updating its state before and after the `fetch` request.
## 2024-03-14 - Modal Input Accessibility
**Learning:** The LocalCaddyHub UI heavily relies on dynamically generated Bootstrap 5 modals in `static/app.js` (`app.ui.initModals`). These dynamically injected forms lacked `id` attributes on inputs and corresponding `for` attributes on labels, causing accessibility issues for screen readers and preventing click-to-focus behavior.
**Action:** When working with dynamically generated HTML strings in this codebase (especially for modals), always ensure standard HTML accessibility attributes (`id`, `for`, `aria-*`) are explicitly included in the template strings, as they are not automatically applied.

## 2024-05-19 - Fix Dark Theme Readability
**Learning:** Bootstrap utility classes like `bg-light` can cause unreadable text (white-on-white) when inheriting text colors in dark themes like Bootswatch Darkly. Additionally, default text colors like `.text-muted` or link colors may lack sufficient contrast against very dark backgrounds.
**Action:** Always verify text and background color combinations when using utility classes. Avoid mixing light backgrounds with inherited text in dark themes, and override classes like `.text-muted` or custom link colors to meet contrast requirements (e.g., `#adb5bd`) on dark backgrounds.
## 2024-05-18 - Fix unreadable table rows in dark theme
**Learning:** Bootstrap 5 `table-striped` and `table-hover` with custom table backgrounds (or transparent backgrounds) in Darkly theme can cause text color for alternating/hovered rows to fall back to dark body text color making it unreadable on a dark background.
**Action:** explicitly set `--bs-table-striped-color: #fff;` and `--bs-table-hover-color: #fff;` to `.table` class when `--bs-table-color: #fff;` is used.
## 2026-03-04 - Accessible Close Buttons
**Learning:** Bootstrap 5 `.btn-close` elements used across the application's modals (both static and dynamically generated) lacked visible text or an `aria-label`, making them inaccessible to screen readers.
**Action:** Always explicitly add `aria-label="Close"` to `<button class="btn-close">` elements in both static HTML and JavaScript template literals to ensure screen reader accessibility.

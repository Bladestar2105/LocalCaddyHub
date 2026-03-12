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

## 2025-02-13 - Add Loading State and Fading Status to File Upload
**Learning:** File uploads are asynchronous operations that can take time, especially for larger files or slow connections. Without visual feedback during the upload (`uploadCert`), users might repeatedly click the upload button, causing redundant requests. Furthermore, status messages (like "File uploaded successfully!") shouldn't persist indefinitely as they become stale UI context if left unaddressed.
**Action:** Always provide a visual indicator (e.g., loading spinner) and disable the submit trigger on async actions like file uploads. Ensure success/error status messages fade out automatically after a short duration (e.g., 5 seconds via `setTimeout` and `.fadeOut()`) to maintain a clean UI.

## 2025-02-13 - Explicit Accessibility Labels for Standalone Inputs
**Learning:** Many standalone inputs (like file uploads) and textareas (like raw configuration viewers) in this application lack explicit `<label>` elements or `aria-label` attributes. This makes them difficult or impossible for screen reader users to identify and interact with properly.
**Action:** Always ensure that every `<input>`, `<textarea>`, and interactive element has either a clearly associated `<label for="...">` or a descriptive `aria-label="..."` attribute, particularly when the element's purpose is implied visually but not semantically.

## 2025-02-13 - Reliable Clipboard Copy in Non-Secure Contexts
**Learning:** Adding a "Copy to Clipboard" button next to raw configuration outputs (like the Raw Caddyfile) is a highly desired UX enhancement. However, the modern `navigator.clipboard` API requires a secure context (HTTPS or localhost). Since LocalCaddyHub is often accessed over a local network using a direct IP address and HTTP, relying solely on `navigator.clipboard` causes the copy function to silently fail.
**Action:** When implementing copy-to-clipboard functionality, especially in tools deployed in local or mixed environments, use `document.execCommand('copy')` as a robust fallback to ensure the feature remains functional for users accessing the app over non-secure connections. Always provide visual feedback (e.g., temporarily changing the button text to "Copied!") upon successful copy.

## 2024-03-11 - Loading feedback for authentication flows
**Learning:** During asynchronous operations like 2FA verification, users need immediate visual feedback (e.g., a loading spinner) and the action button must be temporarily disabled to prevent duplicate submissions or confusion about the system's state.
**Action:** When implementing or modifying authentication or critical action buttons, always ensure a loading state is present and the button is disabled during processing, using a `finally` block to reliably restore the original state.

## 2024-05-15 - [Dynamic Status ARIA Labels]
**Learning:** Many dynamic status and error messages in the application, specifically those updated via Javascript textContent/innerText but present in the DOM (like validation success, upload status, save success, or login failures), are entirely missed by screen readers because they lack ARIA live regions.
**Action:** Always add `role="status" aria-live="polite"` to dynamically updating informational elements and `role="alert" aria-live="assertive"` to error message containers so that screen reader users are notified when these background operations complete or fail.

## 2024-05-24 - Fix Command Injection in Caddy Startup
**Vulnerability:** Command injection vulnerability in `src/index.js` caused by executing Caddy startup with `exec()` and passing `appPaths.caddyfile` unescaped. While `appPaths.caddyfile` currently resolves safely, if it is modified in the future to depend on user input or environment variables without sanitization, it could execute arbitrary commands.
**Learning:** Never use `child_process.exec()` with any dynamically resolved arguments, even if the resolution seems safe currently. It establishes a risky pattern that can lead to remote code execution (RCE) if paths change. `exec()` runs in a shell and evaluates shell metacharacters.
**Prevention:** Use `child_process.execFile()` instead, which executes the executable directly without invoking a shell. Pass arguments as an array to ensure they are treated as literal arguments rather than executed.
## 2024-05-24 - SameSite=Strict Cookie for Defense-in-Depth
**Vulnerability:** The session cookie generated during login was lacking the `SameSite` attribute. While API endpoints are protected by checking for `X-Requested-With` header (which naturally prevents CSRF in AJAX requests), `GET` endpoints, like `/logout`, are unprotected by this check. An attacker could potentially log a user out via CSRF.
**Learning:** Relying solely on custom headers like `X-Requested-With` for CSRF protection is inadequate for `GET` endpoints or simple form submissions.
**Prevention:** Always configure session cookies with `SameSite=Strict` or `SameSite=Lax` to instruct the browser not to send cookies on cross-site requests, providing a robust defense-in-depth layer against CSRF.
## 2024-05-20 - Add Rate Limiting to Login Endpoint
**Vulnerability:** The `/login` POST endpoint was vulnerable to brute force attacks because it lacked rate limiting. Attackers could repeatedly attempt to guess passwords without restriction.
**Learning:** Even internal or local-first administration panels must implement brute-force protections because they may be exposed to wider networks or attacked via SSRF.
**Prevention:** Implement an IP-based rate limiter on authentication endpoints that temporarily locks out users after a certain number of failed attempts.

## 2025-03-07 - [Timing Attack in safeCompare]
**Learning:** Returning early when lengths mismatch in a timing-safe comparison function (like `safeCompare`) can still leak the expected input's length via timing side-channels.
**Action:** Use HMAC-based comparison for `safeCompare` to ensure both buffers have the same length (e.g., 32 bytes for SHA256) regardless of the original input's length, thus neutralizing length-based timing attacks.
## 2026-03-08 - Fix Rate Limiter Memory Leak (DoS Vulnerability)
**Vulnerability:** In-memory rate limiter using Map `loginAttempts` did not evict entries for IP addresses that failed fewer times than the threshold.
**Learning:** In-memory rate limiters must implement active eviction strategies to periodically remove stale entries and prevent memory leaks and out-of-memory errors over a long period.
**Prevention:** Always implement an active eviction strategy when using an in-memory Map structure for a rate limiter by using `setInterval` or equivalent methods, and store timestamps like `lastAttempt`.
## 2026-03-09 - Fix CSRF Bypass via Case-Sensitive Middleware Path Check
**Vulnerability:** The application used a case-sensitive check (`req.path.startsWith('/api/')`) in `src/auth.js` to enforce the presence of the `X-Requested-With` header for CSRF protection and to return a 401 instead of a redirect. However, Express routes are case-insensitive by default. By sending a cross-origin request to an uppercase path like `/API/config/structured`, an attacker could bypass the CSRF protection and successfully execute state-changing API operations.
**Learning:** When using middleware to enforce security checks on paths (such as enforcing headers or authentication mechanisms on API endpoints), always ensure the path matching logic accurately reflects the routing framework's case-sensitivity behavior. Relying on strict case-sensitive string matching for validation while the underlying router handles paths case-insensitively will create security bypasses.
**Prevention:** Convert paths to lowercase (e.g. `req.path.toLowerCase().startsWith('/api/')`) or use case-insensitive regular expressions when performing path-based security checks in middleware, or ensure the routing framework strictly enforces case sensitivity.
## 2026-03-11 - Fix Denial of Service (DoS) via unhandled `req.query` array/object expansion
**Vulnerability:** The application reads `req.query.file` without validating that it is a string. If an attacker sends multiple query parameters with the same name (e.g., `?file=a&file=b`) or an object (e.g., `?file[includes]=..`), Express parses `req.query.file` as an array or object. Passing this to methods like `.includes()` or `path.join()` causes unhandled exceptions that crash the server, leading to a DoS.
**Learning:** Always validate the type of query parameters before performing string-specific operations on them, as frameworks like Express can parse them into objects or arrays unexpectedly.
**Prevention:** Ensure that `req.query` parameters used in string operations or file paths are strictly validated as strings (e.g., `if (typeof filename !== 'string') return ...`).

## 2026-03-21 - Remove Overly Permissive CORS Policy
**Vulnerability:** The application used `cors()` without options in `src/index.js`, which enabled Cross-Origin Resource Sharing (CORS) for all origins. This allowed any website to make cross-origin requests to the application's API.
**Learning:** Enabling CORS by default or with overly permissive settings (`Access-Control-Allow-Origin: *`) in an application intended for same-origin use unnecessarily expands the attack surface. It could potentially lead to sensitive data exposure if other security controls (like CSRF protection or authentication) are bypassed or misconfigured.
**Prevention:** Avoid using CORS in same-origin applications. If cross-origin access is required, restrict it to specific, trusted origins using the `origin` option in the `cors` middleware.

## 2026-03-12 - Fix username enumeration timing attack in login endpoint
**Vulnerability:** The login logic allowed an attacker to determine if a username was correct by measuring response times. When a username was incorrect, the expensive `bcrypt.compare` call was short-circuited, resulting in a much faster response compared to a correct username guess.
**Learning:** Conditional execution of expensive cryptographic operations based on user input (like matching a username first) creates an observable timing side-channel that leaks valid system accounts.
**Prevention:** Always perform the expensive cryptographic comparison (like `bcrypt.compare` or `safeCompare`) irrespective of the success or failure of previous validation checks (like matching a username). This ensures that login endpoint responses take a consistent amount of time for both valid and invalid usernames.

## 2026-02-28 - Optimize generateCaddyfile allocations
**Learning:** `strings.Builder` reallocates several times when constructing a large Caddyfile, resulting in excess allocations (approx. 13 allocs/op).
**Action:** Adding a dynamic `sb.Grow(estimatedSize)` call before building the string drastically reduces reallocation steps (to 10 allocs/op) and improves time per operation. The formula used for `estimatedSize` uses basic constants for `Domains`, `Subdomains`, `Handlers` and `Layer4`.

## 2026-02-28 - Optimize generateCaddyfile allocations
**Learning:** `strings.Builder` reallocates several times when constructing a large Caddyfile, resulting in excess allocations (approx. 13 allocs/op).
**Action:** Adding a dynamic `sb.Grow(estimatedSize)` call before building the string drastically reduces reallocation steps (to 10 allocs/op) and improves time per operation. The formula used for `estimatedSize` uses basic constants for `Domains`, `Subdomains`, `Handlers` and `Layer4`.

## 2025-03-01 - Optimize Handler Iteration Inside Domain Loop
**Learning:** Pre-grouping related arrays of configurations into dictionary lookups can significantly reduce the algorithmic complexity and dramatically decrease computation time when generating configurations. Repeated loop scanning on static structures, especially nested deep inside configuration generation steps, scales very poorly and leads to O(N*M) or O(N^2) bottlenecks. In Javascript, objects or Maps provide O(1) hash table access. For Caddyfile generation, mapping Handlers and Subdomains to Domains avoids repeated array searches. Handlers can map either directly via `handler.reverse` or indirectly via `handler.subdomain`. Both need to be accounted for when building the map so no handlers are missed.
**Action:** When working on generation tasks that process sets of related items (like generating a structured file), ensure any related config values are pre-indexed into lookup Maps or dictionaries to avoid repeated iteration inside outer loops. Always handle both direct and indirect relation edge cases during indexing.

## 2025-03-03 - Avoid Synchronous FS Methods in Express Routes
**Learning:** In an Express application, using synchronous Node.js `fs` methods (like `fs.readdirSync`, `fs.statSync`, `fs.renameSync`, or `fs.unlinkSync`) will block the main thread and event loop, severely degrading concurrent request handling performance. Additionally, filtering directories using `fs.readdirSync` combined with `fs.statSync` introduces an O(N) penalty (performing N individual system calls). Using `existsSync` before manipulating a file introduces a Time-of-Check to Time-of-Use (TOCTOU) race condition and is less efficient than just performing the action and handling the `ENOENT` error.
**Action:** Always prefer `fs.promises` equivalent methods (e.g., `await fs.promises.readdir`, `await fs.promises.rename`, `await fs.promises.unlink`) in Express route handlers to prevent blocking the event loop. Optimize directory reads by passing `{ withFileTypes: true }` to `readdir` to fetch file types in a single operation, eliminating the need for subsequent `stat` calls. Rely on `try/catch` around operations instead of `existsSync` checks to safely handle missing files without race conditions.

## 2026-03-04 - Cache db.prepare() SQL Statements in Express Middlewares
**Learning:** Re-preparing SQL statements via `db.prepare(sql)` on every incoming request in Node.js with `better-sqlite3` causes unnecessary parsing overhead and increases execution time significantly (~85% slower in high-throughput endpoints).
**Action:** Always extract static `db.prepare(...)` statements to module-level scope and cache the compiled statement instances, then call `.get()` or `.run()` inside the request handler/middleware.

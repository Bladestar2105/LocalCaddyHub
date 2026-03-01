## 2026-02-28 - Optimize generateCaddyfile allocations
**Learning:** `strings.Builder` reallocates several times when constructing a large Caddyfile, resulting in excess allocations (approx. 13 allocs/op).
**Action:** Adding a dynamic `sb.Grow(estimatedSize)` call before building the string drastically reduces reallocation steps (to 10 allocs/op) and improves time per operation. The formula used for `estimatedSize` uses basic constants for `Domains`, `Subdomains`, `Handlers` and `Layer4`.

## 2026-02-28 - Optimize generateCaddyfile allocations
**Learning:** `strings.Builder` reallocates several times when constructing a large Caddyfile, resulting in excess allocations (approx. 13 allocs/op).
**Action:** Adding a dynamic `sb.Grow(estimatedSize)` call before building the string drastically reduces reallocation steps (to 10 allocs/op) and improves time per operation. The formula used for `estimatedSize` uses basic constants for `Domains`, `Subdomains`, `Handlers` and `Layer4`.

## 2025-03-01 - Optimize Handler Iteration Inside Domain Loop
**Learning:** Pre-grouping related arrays of configurations into dictionary lookups can significantly reduce the algorithmic complexity and dramatically decrease computation time when generating configurations. Repeated loop scanning on static structures, especially nested deep inside configuration generation steps, scales very poorly and leads to O(N*M) or O(N^2) bottlenecks. In Javascript, objects or Maps provide O(1) hash table access. For Caddyfile generation, mapping Handlers and Subdomains to Domains avoids repeated array searches. Handlers can map either directly via `handler.reverse` or indirectly via `handler.subdomain`. Both need to be accounted for when building the map so no handlers are missed.
**Action:** When working on generation tasks that process sets of related items (like generating a structured file), ensure any related config values are pre-indexed into lookup Maps or dictionaries to avoid repeated iteration inside outer loops. Always handle both direct and indirect relation edge cases during indexing.

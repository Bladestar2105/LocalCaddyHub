## 2026-02-28 - Optimize generateCaddyfile allocations
**Learning:** `strings.Builder` reallocates several times when constructing a large Caddyfile, resulting in excess allocations (approx. 13 allocs/op).
**Action:** Adding a dynamic `sb.Grow(estimatedSize)` call before building the string drastically reduces reallocation steps (to 10 allocs/op) and improves time per operation. The formula used for `estimatedSize` uses basic constants for `Domains`, `Subdomains`, `Handlers` and `Layer4`.

## 2026-02-28 - Optimize generateCaddyfile allocations
**Learning:** `strings.Builder` reallocates several times when constructing a large Caddyfile, resulting in excess allocations (approx. 13 allocs/op).
**Action:** Adding a dynamic `sb.Grow(estimatedSize)` call before building the string drastically reduces reallocation steps (to 10 allocs/op) and improves time per operation. The formula used for `estimatedSize` uses basic constants for `Domains`, `Subdomains`, `Handlers` and `Layer4`.

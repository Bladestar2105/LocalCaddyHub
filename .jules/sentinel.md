## 2024-05-24 - Add basic auth form middleware
**Learning:** Adding cookie-based authentication requires protecting both API and static file routes, leaving `/login` and `/login.html` accessible. Session cookies need `HttpOnly` to protect against XSS.
**Action:** When adding auth barriers in Go, implement middleware that intercepts requests before reaching the main mux (or applies to all mux routes), and explicitly permit login pages/endpoints.

# Security Audit Command

Perform a comprehensive security audit of the application, identifying vulnerabilities across all layers.

## Arguments

- `$ARGUMENTS` - Optional scope and flags:
  - No arguments = **full sweep** across all areas (wide audit)
  - Specific scope = **deep dive** into that area (e.g., `auth`, `api-routes`, `sdk`, `services`, `cors`, `jwt`, `config`, `widgets`)
  - Multiple scopes supported (e.g., `auth cors jwt`)

## Instructions

### 1. Determine Audit Scope

Parse `$ARGUMENTS` to determine scope:

- **No arguments (full sweep):** Audit ALL areas listed below. Launch 15-20+ explorer agents in parallel — one per attack surface. Go wide, cover everything.
- **Specific scope (deep dive):** Launch 5-10 agents focused exclusively on the specified area(s). Go deep — read every file, trace every data flow, check every edge case.

### 2. Context7 Documentation Lookup

Query Context7 for up-to-date security documentation relevant to the audit scope:
- **Always query:** Next.js security (API routes, CORS, headers, middleware, Server Actions)
- **If auth in scope:** NextAuth / Auth.js security advisories, JWT best practices
- **If SDK in scope:** Vite security (library mode, source maps, env variable exposure)
- **If widgets in scope:** Web Components / Shadow DOM XSS vectors

Use findings to inform what to look for in the codebase. Note any framework-specific vulnerabilities that apply.

### 3. Launch Audit Agents

Launch explorer agents covering the relevant areas. For a **full sweep**, cover ALL of these. For a **deep dive**, cover only the matching areas but with more thoroughness.

#### Authentication & Authorization
- JWT implementation (algorithm, secret management, signing, verification, claims)
- Init token validation (signature, expiration, revocation)
- OAuth/OIDC configuration (state parameter, session fixation, CSRF)
- Session management (cookie flags, token storage, logout invalidation)
- Route protection (auth bypass, missing auth checks, privilege escalation)
- `requireWidgetAuth()` coverage across all API routes

#### CORS & Origin Validation
- OPTIONS preflight handlers (wildcard fallback patterns)
- Origin allowlist logic (subdomain matching, protocol validation)
- Development mode bypasses
- Consistency across all 57+ embed API routes
- `Vary: Origin` header presence

#### Injection & Input Validation
- SQL/OData filter injection in MPHelper calls (string interpolation in `filter` params)
- Zod schema usage (routes using `.safeParse()` vs raw type casting)
- Query parameter and request body validation completeness
- Idempotency key format validation
- Numeric parameter type coercion

#### Web Component / SDK Security
- XSS vectors (innerHTML usage, escapeHtml vs escapeAttr, user content rendering)
- Token handling (Bearer headers, auto-refresh on 401, localStorage storage)
- External script loading (SRI hashes, CDN integrity)
- API host validation (attribute injection, protocol enforcement)
- `customcss` attribute injection potential
- Source map exposure in production bundles

#### Secret & Token Management
- Hardcoded secrets in source, demos, docs, public files
- Environment variable fallback defaults (weak dev secrets in production)
- Init tokens in public HTML or documentation
- Source maps exposing internal code
- Console logging of sensitive data (tokens, GUIDs, auth details)

#### Financial & Sensitive Data
- Amount tampering (pledge amounts, invoice manipulation)
- IDOR (accessing other users' invoices, profiles, subscriptions)
- PII over-fetching (phone numbers, emails in search results)
- Donor/financial data authorization checks
- Idempotency for financial operations (in-memory vs distributed)

#### Infrastructure & Headers
- Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Rate limiting (session endpoint, financial endpoints, file upload, AI calls)
- File upload validation (MIME type spoofing, magic bytes, path traversal)
- Open redirect vectors
- SSRF potential (user-controlled URLs fetched server-side)

#### Data Exposure
- Error response information leakage (stack traces, field names, internal details)
- Tenant isolation in multi-tenant widget system
- API response over-fetching (returning more fields than needed)
- Log exposure of PII

### 4. Compile Report

After all agents complete, compile a single consolidated report organized by severity:

#### Severity Levels
- **CRITICAL** — Actively exploitable, data breach risk, authentication bypass
- **HIGH** — Exploitable with moderate effort, significant security impact
- **MEDIUM** — Defense-in-depth failures, requires specific conditions to exploit
- **LOW** — Minor issues, best-practice violations, informational

#### Report Format
For each finding include:
- Severity level
- Descriptive title
- File path and line number(s)
- Code snippet showing the vulnerability
- Impact description (what an attacker can do)
- Recommended fix

#### Summary Table
Include a summary table at the end:
```
| Priority | Action | Files |
|----------|--------|-------|
| P0 — Today | ... | ... |
| P1 — This Week | ... | ... |
| P2 — Next Sprint | ... | ... |
| P3 — Backlog | ... | ... |
```

### 5. Write Report to File

Generate a timestamped filename and write the report:

```bash
# Generate timestamp: YYYY.MM.DD.HHMM
TIMESTAMP=$(date +"%Y.%m.%d.%H%M")
FILENAME="docs/TODO/security_audit-${TIMESTAMP}.md"
```

- Create `docs/TODO/` directory if it doesn't exist
- Write the full report to `docs/TODO/security_audit-{YYYY}.{MM}.{DD}.{HHMM}.md`
- Include metadata header in the report: date, scope, agent count, total findings

### 6. Offer P0 Remediation

After writing the report, if any **CRITICAL (P0)** findings were identified:

1. List the P0 items clearly
2. Ask the user: **"Found {N} critical (P0) vulnerabilities. Would you like me to begin fixing them now?"**
3. If the user agrees, begin fixing P0 items in priority order:
   - Remove hardcoded secrets/tokens from public files
   - Remove insecure fallbacks (JWT signing, default secrets)
   - Add startup validation for required env vars
   - Fix injection vulnerabilities (parameterized filters)
   - Fix CORS wildcard fallbacks
4. After each fix, briefly report what was changed
5. Do NOT auto-commit — let the user review changes first

## Scope Keywords Reference

| Keyword | Areas Covered |
|---------|--------------|
| `auth` | JWT, OAuth, sessions, login/logout, NextAuth config, init tokens |
| `api-routes` | All `/api/embed/*` routes, input validation, auth checks, CORS per-route |
| `sdk` | Vite config, Web Components, base-widget, api-client, cdn-loader, demo pages |
| `services` | All 22 service files, MPHelper usage, filter construction, authorization |
| `cors` | Origin validation, OPTIONS handlers, wildcard patterns, subdomain matching |
| `jwt` | Token signing/verification, algorithm, secrets, claims, expiry, revocation |
| `config` | next.config, security headers, env vars, tenant config, source maps |
| `widgets` | All 20 nw-* components, XSS, innerHTML, escaping, attribute handling |
| `financial` | Pledge, invoice, donor, subscription services and routes |
| `secrets` | Hardcoded tokens, env fallbacks, public file exposure, logging |

## Example Usage

```
# Full sweep — audit everything
/security-audit

# Deep dive into authentication
/security-audit auth

# Deep dive into multiple areas
/security-audit auth cors jwt

# Focus on the SDK and widgets
/security-audit sdk widgets

# Focus on financial security
/security-audit financial services
```

## Notes

- Always include file paths and line numbers for every finding
- Report ALL severity levels (CRITICAL through LOW)
- Use Context7 to cross-reference framework-specific security advisories
- For full sweeps, maximize parallelism — launch all agents in a single message
- For deep dives, prioritize thoroughness over speed
- Never auto-fix without asking the user first
- The report file is timestamped so historical audits are preserved

# 47. The rate limiter logs on every request while the session store is unreachable

**Depends on:** nothing.
**Risk:** low, but a store outage floods the logs with one `console.error` per rate-limited
request, which buries the first, useful line.
**Size:** small.

Filed 2026-10-11 from the comparison-remediation epic's close-out.

## Where

`src/lib/embed/rate-limit.ts`, `checkRateLimit()`. The `catch` around
`getSessionStore().incr(...)` logs `"checkRateLimit: session store unavailable; …"` on every
call. The fail-open / fail-closed behaviour is deliberate and must not change.

## Do

Throttle the log. For example, log the first failure, then at most once per window with a
count of suppressed failures, and log once when the store recovers.

## Done when

A unit test with a failing store shows one log line for many requests in one window, and the
allow/deny results are unchanged.

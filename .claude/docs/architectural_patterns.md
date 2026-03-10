# Architectural Patterns

Patterns confirmed across the codebase in [index.js](../../index.js).

---

## 1. Token Caching (Lazy Authentication)

ThingsBoard requires a JWT token. Rather than authenticating on every request, the token is cached in memory and re-fetched only when expired (~1 hour TTL).

- Cache variables: [index.js:25-27](../../index.js#L25-L27)
- Cache check + lazy refresh: [index.js:49-54](../../index.js#L49-L54)
- Login call that populates cache: [index.js:30-47](../../index.js#L30-L47)

**Implication:** Token state is process-local. A crash/restart forces re-authentication on the next request.

---

## 2. Query-Parameter-Driven Route Branching

A single route (`GET /nodeapi/sendsms/:deviceId`) handles three distinct notification flows. The branch is chosen by query parameters, not by separate endpoints.

- Branching logic: [index.js:197-344](../../index.js#L197-L344)
- `gerador` param → generator alerts: [index.js:203-250](../../index.js#L203-L250)
- `type=rede` → network change alerts: [index.js:252-282](../../index.js#L252-L282)
- `type=created|updated|cleared` → general alarms: [index.js:283-344](../../index.js#L283-L344)

**Convention:** When adding a new notification type, add a new `else if` branch in this section and document the query param in CLAUDE.md's API table.

---

## 3. Parallel Asset Enrichment with Promise.all

Phone numbers are fetched per-asset concurrently, not sequentially. The pattern is `array.map(async fn)` wrapped in `Promise.all`.

- Usage: [index.js:172-184](../../index.js#L172-L184)

**Convention:** Use this pattern whenever fetching a property for every item in a list. Avoids N serial round-trips to ThingsBoard.

---

## 4. Per-Item Error Isolation in Loops

When sending SMS to multiple recipients, each send is wrapped in its own `try/catch`. A failure for one recipient does not prevent sending to others. Both successes and failures are collected and returned in the response.

- Generator alert loop: [index.js:232-249](../../index.js#L232-L249)
- General alarm loop: [index.js:330-342](../../index.js#L330-L342)

**Convention:** Always use this pattern in fan-out loops (one action per recipient/asset). Never let a single failure abort the entire batch.

---

## 5. Message Template via Switch Statement

The SMS message body is constructed from a `switch` on `type` (alarm lifecycle state). This keeps all message strings in one place.

- Template switch: [index.js:313-323](../../index.js#L313-L323)
- Numeric value formatting (decimals, units): [index.js:299-308](../../index.js#L299-L308)

**Convention:** Add new alarm lifecycle states by extending this switch. Boolean alarms skip numeric formatting (checked at [index.js:299](../../index.js#L299)).

---

## 6. Self-Signed Certificate Bypass (HTTPS Agent)

The ThingsBoard server uses a self-signed TLS certificate. A custom `https.Agent` with `rejectUnauthorized: false` is attached to the axios instance.

- Axios instance definition: [index.js:18-23](../../index.js#L18-L23)

**Trade-off:** Allows the service to connect to the internal ThingsBoard server without a CA-signed cert, but disables MITM protection. Acceptable on a trusted internal network; do not apply to public-facing connections.

---

## 7. Environment-Based Configuration via dotenv

All credentials and endpoints are loaded from `.env` at startup. No hard-coded secrets in source.

- Load call: [index.js:1](../../index.js#L1)
- Variable destructuring: [index.js:3-16](../../index.js#L3-L16)

**Convention:** Add new config values to `.env` and destructure from `process.env` at the top of `index.js` alongside existing variables. Document new vars in CLAUDE.md's Environment Variables table.

---

## 8. Graceful HTTP Error Reporting

The main route wraps all logic in a top-level `try/catch`. On unhandled errors, it returns a structured JSON `500` response rather than crashing.

- Top-level error handler: [index.js:353-360](../../index.js#L353-L360)

**Convention:** Internal helper functions (`getTbToken`, `sendSms`, etc.) throw on failure and let the route's top-level handler catch them. Do not swallow errors silently in helpers.

# CLAUDE.md — Sonorgas IoT Node Service

## Project Overview

IoT Alert & SMS Notification Gateway for Sonorgas. Bridges **ThingsBoard** (IoT platform) with an **SMS provider (EZ4U Team)** to send real-time alerts to on-call technicians when industrial devices (generators, sensors, network units) trigger alarms.

Deployed as a Linux systemd service on an IoT hub server.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Web framework | Express 5.1.0 |
| HTTP client | axios 1.13.2 |
| Config | dotenv 17.2.3 |
| Deployment | systemd (`node_service.service`) |

## Project Structure

```
Node Service/
├── index.js                  # Entire application (single-file service)
├── package.json              # Dependencies and scripts
├── .env                      # Runtime credentials (not in git)
└── node_service.service      # Systemd unit for auto-start/restart
```

**This is a flat, single-file project.** All routing, business logic, API calls, and SMS dispatch live in [index.js](index.js). There are no subdirectories for modules, controllers, or routes.

## Key File References

| Concern | Location |
|---------|----------|
| App bootstrap & middleware | [index.js:1-16](index.js#L1-L16) |
| ThingsBoard axios instance (SSL bypass) | [index.js:18-23](index.js#L18-L23) |
| Token cache variables | [index.js:25-27](index.js#L25-L27) |
| `getTbToken()` — lazy auth with caching | [index.js:49-54](index.js#L49-L54) |
| Main route `GET /nodeapi/sendsms/:deviceId` | [index.js:162](index.js#L162) |
| Asset/phone enrichment pipeline | [index.js:162-195](index.js#L162-L195) |
| Query-param branching (gerador / rede / alarm) | [index.js:197-344](index.js#L197-L344) |
| Generator alert logic | [index.js:203-250](index.js#L203-L250) |
| Network change alert logic | [index.js:252-282](index.js#L252-L282) |
| General alarm logic + message templates | [index.js:283-344](index.js#L283-L344) |
| `sendSms()` helper | [index.js:130-160](index.js#L130-L160) |
| Server listen | [index.js:366](index.js#L366) |

## Environment Variables

Defined in `.env` (excluded from git). Required variables:

```
PORT                    # Defaults to 5555
TB_URL                  # ThingsBoard HTTPS base URL
TB_USER / TB_PASS       # ThingsBoard login credentials
SMS_API_URL             # EZ4U SMS gateway endpoint
SMS_API_ACCOUNT         # SMS account ID
SMS_API_LICENSEKEY      # SMS license key
SMS_API_ALFASENDER      # SMS sender name/ID
```

## Run Commands

```bash
# Install dependencies
npm install

# Run directly
node index.js

# Systemd (production)
systemctl start node_service
systemctl enable node_service   # auto-start on boot
```

No test suite is configured (`npm test` returns exit code 1).

## API Endpoint

`GET /nodeapi/sendsms/:deviceId`

Query parameters control which notification branch runs:

| Param | Values | Branch |
|-------|--------|--------|
| `gerador` | truthy | Generator start/stop alerts |
| `type` | `rede` | Network config change alerts |
| `type` | `created` \| `updated` \| `cleared` | General alarm alerts (default) |

## Additional Documentation

Check these files when relevant:

- [.claude/docs/architectural_patterns.md](.claude/docs/architectural_patterns.md) — Design patterns, conventions, and key trade-offs found across the codebase. Read when modifying business logic, adding routes, or refactoring.

# FAQ — for Reddit / launch comments

Short, copy-paste-friendly answers. Numbers are from the Community Edition release on 2026-11-06; update them if you re-measure.

---

### What is Sovereign OS?

A self-hosted monitoring and alerting stack for a home or small site. Sensors publish over MQTT, history goes into Postgres/TimescaleDB, and alerts fan out to Telegram, Discord and LINE. It also ships the boring-but-necessary parts: invite-code signup without SMTP, TOTP MFA, audit log and consent records.

### Why not just use Home Assistant / Grafana / Uptime Kuma?

If you already have those and only need dashboards or device integrations, use them — they are better at those jobs. Sovereign OS is for people who want ingest + history + multi-channel alerts + user management in one compose file, without wiring five services together. It is not a Home Assistant replacement and does not try to control every smart-home protocol.

### Do I need to know MQTT?

A little. The bundled broker is EMQX, and the topic format is `sovereign/<node>/sensor/<metric>`. The payload can be a bare number (`23.4`) or JSON (`{"value":23.4}`). There is also `sovereign/<node>/heartbeat` for device liveness. If your devices speak HTTP instead, the REST API is there, but MQTT is the happy path.

### Does it work on a Raspberry Pi / ARM?

The images are built for `linux/amd64` and `linux/arm64` on every `v*` tag, and the compose file is plain Linux containers. I have only tested on Windows 11 + Docker Desktop so far — Pi reports are welcome. Minimum is 2 GB RAM and ~10 GB disk.

### Are there prebuilt images?

Yes — the `Publish images (GHCR)` workflow builds both api and web for amd64 + arm64 on every `v*` tag. For release `v1.2.0` the published tags are `1.2.0` (pin this one), `1.2` and `latest`, so set in `.env`:

```env
API_IMAGE=ghcr.io/krisakornutama/sovereign-origin/api:1.2.0
WEB_IMAGE=ghcr.io/krisakornutama/sovereign-origin/web:1.2.0
```

Then run `docker compose up -d --pull always`. Building from source still works and remains the default.

> Image tags drop the leading `v` from the git tag: `v1.2.0` publishes `1.2.0`, not `v1.2.0` (the latter returns 404). `main` and `sha-<commit>` tags also exist; `latest` follows the newest build.

> Note: GHCR packages are private by default. After the first publish, open the package settings and switch visibility to public.

### Why is there no SMTP / email signup?

Because a self-hosted single-user install should not need a mail server to add its second user. Admins create invite codes (CLI, API or UI); codes are stored as SHA-256, single-use by default, with expiry, max uses and revocation. No open registration, no email deliverability problems.

### How do I add a user?

```bash
docker compose exec api node dist/scripts/make-invite.js --role OPERATOR --uses 1 --days 7
```

Send the printed `/register?code=SG-...` link. The same thing is available in the Users page and via `POST /api/users/invites`.

### Does it phone home?

No vendor account and no cloud dependency for the core features. Outbound traffic happens only for things you configure: Telegram/Discord/LINE, optional threat-intel feeds and news for the risk module, and updates you trigger. Telemetry/analytics consent is opt-in per user.

### Which alert channels actually work?

Telegram is verified end-to-end. Discord and LINE payloads are verified against local stub endpoints (format, headers, plain-text conversion, `@allowed_mentions` hardening) but have not been fired at real webhooks yet. That is the next thing on the list; I would rather say it than pretend.

### What happens if one alert channel is down?

The fanout runs channels in parallel and reports each outcome separately. A dead webhook or a 500 from one channel does not block the others and does not crash the API.

### Is it safe to expose to the internet?

Not as-is. The API binds to `127.0.0.1` by default; put a TLS reverse proxy (Caddy/Nginx/Cloudflare Tunnel) in front, keep the MQTT port on a trusted network, and enable MFA. The compose file's EMQX listener allows anonymous MQTT — add authentication/TLS before exposing it beyond your LAN.

### What is the license?

AGPL-3.0. Use it, modify it, run it commercially. If you run a modified version as a network service, you have to publish your changes. The Pro modules live in a separate private repo and are not covered by this license.

### So it is open core — what is missing from CE?

POS/retail, treasury/accounting and the fleet control plane are Pro. CE is pure: no hidden imports, no dead stubs. If a Pro module is absent, its API returns a 404 naming the module instead of crashing, and CI fails the build if CE ever imports Pro code.

### Can I use it at work / in a business?

Yes, AGPL-3.0 allows commercial use. If you modify it and offer it to others as a network service, you must make your modified source available. If you need the Pro modules, that is a separate conversation.

### How much RAM does it use?

Measured idle on Windows 11 + Docker Desktop: api 94 MiB, web 61 MiB, Postgres 78 MiB, EMQX 141 MiB — about 374 MiB total for the four long-running containers. The first build is heavier (Node compile); give Docker a few GB of RAM during install.

### Where is my data?

In named Docker volumes: `sovereign_pgdata` (database), `sovereign_api_data` (app state + field-encryption key), `sovereign_api_backups`, `sovereign_emqx_data`. Back up with `docker compose exec db pg_dump -U sovereign sovereign | gzip > backup.sql.gz`, and keep `sovereign_api_data` with it — the encryption key lives there.

### Is there an API?

Yes, REST under `/api/*` on port 3001, plus MQTT ingest. The dashboard uses the same API. There is no separately versioned public API contract yet — treat it as moving.

### Does it work offline?

The core does: Postgres, MQTT, alerts and the PWA dashboard run on your LAN. Features that need the internet (Telegram/Discord/LINE, threat feeds, news) degrade gracefully when offline.

### What is the AI involvement?

Disclosed up front: AI coding assistants were used heavily for implementation, tests and docs. Architecture, data model, product decisions, code review and release sign-off are mine. The gate before anything lands is 1,823 backend tests + 1,287 tooling/CI tests, with `tsc` and `next build` clean. If you find something that looks AI-generated and wrong, open an issue — that is exactly the feedback I want.

### Known limitations?

- Tested on Windows 11 + Docker Desktop only; macOS/Pi untested.
- Discord/LINE not yet fired at real webhooks.
- No mobile app (the web UI is a PWA).
- MQTT auth/TLS is not preconfigured in the CE compose.
- Pro modules are intentionally absent.

### How do I report a bug or contribute?

Open a GitHub issue with your OS, Docker version, the compose file you used and the relevant `docker compose logs`. PRs are welcome; they need to keep `npm run verify` green (backend build/tests, frontend typecheck/build, tooling tests and the architecture gates).

### What is next?

Real Discord/LINE verification, ARM/Pi testing, and prebuilt images as the default install path. After that I will pick from launch feedback — retention and import paths are the obvious candidates.

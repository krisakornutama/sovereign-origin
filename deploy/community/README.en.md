# Sovereign OS — Community Edition

Self-hosted monitoring and automation for a home or small site: TimescaleDB, MQTT, API and dashboard, all in Docker Compose — **no Node.js required on the host**.

**English** · [ไทย](README.md)

> All commands below run from this directory (`deploy/community`).
> From the repo root, prefix them with `-f deploy/community/docker-compose.yml` instead of `cd`.

## Requirements

- Docker Engine + Compose v2 (Windows/macOS: Docker Desktop)
- RAM ≥ 2 GB, free disk ≥ 10 GB
- x86_64 or arm64 (Raspberry Pi 4/5 should work; see the note in "Known limitations")

## Install (two commands)

```bash
cp .env.example .env
# open .env and fill POSTGRES_PASSWORD, EMQX_PASSWORD, JWT_SECRET (and optionally SEED_ADMIN_PASSWORD)
docker compose up -d --build
```

Wait 1–3 minutes on the first run (the api and web images are built from source), then open:

- Dashboard — http://localhost:3000
- API health — http://localhost:3001/healthz
- EMQX dashboard — http://localhost:18083

Log in as `admin` with the password from `SEED_ADMIN_PASSWORD`.
If you left it empty, the system generates one — read it from `docker compose logs migrate` (it is printed once).

> Change the admin password after the first login (Settings → Security).

### Prebuilt images (optional)

CI publishes multi-arch images (amd64 + arm64) to GHCR on every `v*` tag:

| Service | Image |
|---|---|
| API | `ghcr.io/krisakornutama/sovereign-origin/api:1.3.0` |
| Web | `ghcr.io/krisakornutama/sovereign-origin/web:1.3.0` |

> Image tags drop the leading `v`: pushing git tag `v1.3.0` publishes `1.3.0`, `1.3` and `latest`.
> `v1.3.0` is not a valid image tag and will fail to pull. `latest` / `main` follow the newest build.

Point `API_IMAGE` / `WEB_IMAGE` in `.env` at a published tag and run:

```bash
docker compose up -d --pull always
# no --build: the images are pulled instead of compiled
```

The published `web` image is built with `NEXT_PUBLIC_API_URL=http://localhost:3001` (browser on the Docker host).
For a LAN address, rebuild `web` from source with your URL (see "Access from another machine on the LAN").

> First publish only: the package is private by default even on a public repo.
> Open the package page → Package settings → Danger Zone → Change visibility → Public.

## Add members with invite codes

CE has no SMTP and does not allow open registration — new members need an invite code created by an admin.

**Option 1 — CLI (fastest)**

```bash
docker compose exec api node dist/scripts/make-invite.js --role OPERATOR --uses 1 --days 7
```

You get a code like `SG-XXXX-XXXX-XXXX` plus a `/register?code=...` link to send to the user.

**Option 2 — API (requires SUPERADMIN)**

```bash
curl -X POST http://localhost:3001/api/users/invites \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"role":"OPERATOR","label":"sales team","maxUses":5,"expiresInHours":72}'

# list:    GET /api/users/invites
# revoke:  DELETE /api/users/invites/<id>
```

**Option 3 — Web UI (/users, no terminal needed)**

Log in as SUPERADMIN → Users → the "Invite codes" card.
Pick a role, a label, max uses and expiry, then click "Create invite code".
The code and link are shown once, with a copy button; the table below lets you revoke them.

The user then opens `/register?code=SG-...` and enters the code, a username and a password.

> Codes are stored as SHA-256 only (they cannot be read back from the DB) · limited by `maxUses` · expire · revocable.
> Registration records the "required for service" consent automatically and lets the user opt in to telemetry/analytics.

## Verify everything came up

```bash
docker compose ps          # every service healthy/running (migrate = exited 0)
curl http://localhost:3001/healthz
```

## Access from another machine on the LAN (e.g. a Raspberry Pi)

1. In `.env`:

   ```env
   API_BIND=0.0.0.0
   NEXT_PUBLIC_API_URL=http://192.168.1.50:3001   # IP of the machine running Docker
   ```

2. `docker compose up -d --build web`
3. Open `http://192.168.1.50:3000` from the other machine.

`NEXT_PUBLIC_API_URL` is baked in at build time — changing it requires rebuilding the `web` service every time.

## Common commands

```bash
docker compose logs -f api        # backend logs
docker compose restart api        # restart the API only
docker compose down               # stop (data is kept)
docker compose down -v            # stop + delete all data (careful!)
docker compose up -d --build      # update after git pull
```

## Three alert channels

Configure them in `.env`, then `docker compose up -d api` — set any channel; unset = skipped.

| Channel | What to set |
|---|---|
| Telegram | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (or set them in Settings) |
| Discord | `DISCORD_WEBHOOK_URL` — Server Settings → Integrations → Webhooks |
| LINE | `LINE_CHANNEL_ACCESS_TOKEN` + `LINE_TO` (Messaging API; recipient starts with U/C/R) |

Verify delivery before relying on it:

```bash
# log in to the web UI → F12 → Application → localStorage → sovereign-token
curl -X POST http://localhost:3001/api/telegram/channels/test \
  -H "Authorization: Bearer <token>"
# → {"success":true,"channels":[{"channel":"discord","ok":true,...},{"channel":"line","ok":true,...}]}
```

## Where the data lives

| Volume | Contents |
|---|---|
| `sovereign_pgdata` | the whole database |
| `sovereign_api_data` | app state files (including the field-encryption key) |
| `sovereign_api_backups` | backups created by the app |
| `sovereign_emqx_data` | MQTT broker data |

Back up the database with one command:

```bash
docker compose exec db pg_dump -U sovereign sovereign | gzip > sovereign-$(date +%F).sql.gz
```

> Keep `sovereign_api_data` together with the database backup: it holds `field-crypto.key`,
> which is required to decrypt credentials stored in the DB.

## Security

- The API binds to `127.0.0.1` by default — do not expose `API_BIND=0.0.0.0` directly to the internet.
- To expose the app externally, put it behind a TLS reverse proxy (Caddy/Nginx/Cloudflare Tunnel) and restrict allowed paths.
- The MQTT listener on port `1883` is published to your LAN and allows anonymous connections in this compose file.
  Keep it on a trusted network, or add EMQX authentication/TLS before exposing it.
- `.env` contains secrets — never commit it.

## Troubleshooting

| Symptom | Check |
|---|---|
| `web` does not come up | `docker compose logs web` — usually a build failure caused by the Node version in the image |
| `api` restart loop | `docker compose logs api` — usually a wrong `DATABASE_URL` / `JWT_SECRET` |
| `migrate` exited ≠ 0 | `docker compose logs migrate` — the database was not ready, or the password is wrong |
| Page loads but API returns 401/network error | Check that `NEXT_PUBLIC_API_URL` matches the URL you actually open |

## ✅ Verified (2026-11-04)

Installed on a real empty database with `docker compose up -d --build`, succeeded in one pass:

| Step | Result |
|---|---|
| db (TimescaleDB) | healthy |
| migrate (schema + seed) | exited 0 · created `admin` from `SEED_ADMIN_PASSWORD` |
| api :3001 (tested on :3100 here) | `/healthz` = 200 |
| web :3000 (tested on :3101) | 200 · dashboard loads |
| login | `POST /api/auth/login` = 200 |

> Note: the `migrate` service uses `prisma migrate deploy` (baseline 20261107190000), not `db push`,
> because the migration history has drift — a fresh database would be incomplete and seeding would fail (`P2022`).
> The existing production deployment still uses `migrate deploy` and is unaffected.

## Known limitations

- Tested on Windows 11 + Docker Desktop. The compose file is plain Linux containers, but macOS and Raspberry Pi are untested — reports welcome.
- Telegram alerting is verified end-to-end. Discord and LINE payloads are verified against local stub endpoints (format, headers, plain-text conversion), not yet against real webhooks.
- No mobile app; the dashboard is a PWA.
- Pro modules (POS, accounting, fleet control) are not in this repository by design — see [`docs/OPEN-CORE.md`](../../docs/OPEN-CORE.md).

## License

[AGPL-3.0](../../LICENSE) — use it, modify it, ship it. If you run a modified version as a network service, you must publish your changes.

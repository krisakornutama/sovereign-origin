# Launch draft — r/selfhosted

> Status: draft for review. Numbers below were measured on this machine (CE stack, Docker Desktop on Windows 11, 04/11/69).

**Title**

Show r/selfhosted: Sovereign OS — local-first IoT + asset monitoring OS, one command to run, invite-code signup (no SMTP), fanout alerts to Telegram/Discord/LINE, AGPL-3.0 core

**Body**

Hi r/selfhosted,

I got tired of "smart home" stacks that phone home, need an email server for a single user, or break when the vendor shuts down an API. So I built Sovereign OS: a self-hosted system that watches your environment (temperature, power, water, network), keeps history, and shouts at you through whatever channel you already use — all on your own hardware.

It is AGPL-3.0 and runs with one command.

**Quickstart (Community Edition)**

```bash
git clone https://github.com/krisakornutama/sovereign-origin
cd sovereign-origin
cp deploy/community/.env.example deploy/community/.env
docker compose -f deploy/community/docker-compose.yml up -d --build
# web: http://localhost:3000   api: http://localhost:3001/healthz
```

No Node.js needed on the host. Postgres, MQTT broker, API and web come up together, DB schema is applied automatically, and an admin user is seeded from `.env`.

**What it actually does**

- **Telemetry ingest** over MQTT (`sovereign/<node>/sensor/<device>`), stored in Postgres, with dashboard, history and alert rules.
- **Alert fanout**: one alert → Telegram, Discord and LINE in parallel. A channel that fails (500, bad webhook) is reported per-channel and never takes the others down.
- **Invite-code registration instead of SMTP**: you generate a code in the UI or CLI, it is stored only as a SHA-256 hash, single-use by default, with expiry, max uses and revocation. No mail server, no open signup.
- **Consent + privacy built in** (PDPA-style): consent records per purpose, telemetry/analytics are opt-in, and privacy policy ships with the app.
- **Operational basics that homelabbers actually need**: health endpoints, backup, audit log, TOTP MFA for admin, offline-capable PWA.

**Measured footprint** (4 containers, idle; Windows 11 + Docker Desktop)

| Container | RAM |
|---|---|
| api | 94 MiB |
| web | 61 MiB |
| postgres | 78 MiB |
| mqtt (EMQX) | 141 MiB |

**Open-core, done honestly**

The community repo is pure CE: no hidden Pro imports, no dead stubs. Commercial modules (retail/POS, treasury, fleet control plane) live in a separate private repo. If a Pro module is absent, its API returns a 404 that says so instead of crashing the server — and a CI gate fails the build if CE ever imports Pro code.

**Honest limitations**

- Telegram alerting is verified end-to-end. Discord and LINE payloads are verified against local stub endpoints (format, headers, plain-text conversion, `@allowed_mentions` hardened); I have not yet fired them at real webhooks — that is the next thing on my list.
- Tested on Windows 11 + Docker Desktop. The compose file is plain Linux containers, but macOS/Raspberry Pi are untested — reports welcome.
- No mobile app; the web UI is a PWA.
- Pro modules are not included. If you need POS/accounting/fleet, this repo is the wrong place — that is the point of the split.

**Why I am posting**

I would rather hear "your install broke on my NAS" now than after I start charging for the Pro side. If you run it and something is wrong — or the docs assume knowledge you do not have — tell me and I will fix it.

Repo: https://github.com/krisakornutama/sovereign-origin
Docs: `deploy/community/README.md` (install + invite codes), `docs/PRELAUNCH-DEMO.md` (demo)

**Reviewer checklist before posting (delete this section)**

- [ ] Replace the RAM table if you re-measure on the machine you post from
- [ ] Add the demo GIF under `docs/media/demo.gif` and uncomment the image line in `README.md`
- [ ] Re-check the claim list: 867 API tests passing, `tsc` clean, `next build` clean, open-core boundary 0 violations
- [ ] Confirm branch protection on `main` is back on
- [ ] Post in r/selfhosted with the `Project` flair, no marketing links, answer every comment for the first 3 hours

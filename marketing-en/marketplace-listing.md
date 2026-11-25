# Store pages — itch.io and Payhip (copy-paste ready)

Both pages exist for discovery. **The checkout that pays the Thai bank account is Gumroad**, so every
listing points buyers there: https://oweenhoper.gumroad.com/l/sovereign-os

Read this before you publish on either platform:

- **itch.io** pays creators through PayPal (and its own payout options, not Thai bank transfer). If you open a
  paid page there, money lands in that rail, not in the Thai account. Use itch.io as a **free demo / project
  page that sends buyers to Gumroad**, or keep it unpaid until you have PayPal sorted.
- **Payhip** pays through PayPal or Stripe. Same caveat.
- Never put a bank account number on a marketplace page. Gumroad handles the money.

---

## 1. itch.io

**Title** (max 60 chars):

```
Sovereign OS — self-hosted operations suite for small business
```

**Short tagline / "Short description"** (one line, shown under the title):

```
Dashboards, energy, sensors, backups and a local AI assistant on one Windows machine. Offline license, one-time price.
```

**Project type:** Downloadable · **Pricing:** No payments (or "Paid" only after PayPal is verified) ·
**Platforms:** Windows · **Tags:** `self-hosted`, `offline-first`, `small-business`, `productivity`, `privacy`

**Long description** (paste into the description box; itch.io renders Markdown):

```markdown
Sovereign OS is an operations suite for a small business that runs on **one Windows machine you own**.

No cloud account. No telemetry. No subscription. It keeps working when the internet does not.

## What is inside

- live dashboards with history
- energy monitoring
- device sensors with rules and alerts
- a security panel with a kill switch and a live event stream
- encrypted backups
- an offline queue that survives disconnects and reconciles afterwards
- a local AI assistant that reads only your own data
- multi-user roles

## Where it is honest about its limits

The shop, POS and tax modules follow **Thai** rules: PromptPay QR and 7% VAT. Outside Thailand, buy it for
the operations side and leave those modules unused. Support is by email, in English or Thai, from the
developer, not a support team.

## The license is the point

The license is an Ed25519-signed token that the app verifies **locally**. There is no activation server, so
there is nothing to phone home and nothing the developer can switch off later. It is machine-bound, with one
free machine transfer per year.

The build is open-core: read the repository, verify every release against a published key fingerprint at
https://sovereignoriginshop.dpdns.org/release-verify.html, then decide.

## What you get

- `Sovereign-OS-1.3.10-portable.exe` — one file, no installer, Windows 10/11 64-bit
- `INSTALL.txt` — a one-page guide, about ten minutes
- `SHA256SUMS.txt` — check the download without trusting anyone
- `attest-release.pub.pem` — the public key that verifies your license
- your signed `license.txt` by email within 24 hours

## Price and where to buy

Home $59 (1 machine, 1 year of updates) · Business $199 (3 machines) · Pro $599 (perpetual, unlimited
branches, 2-hour setup session).

**Buy here:** https://oweenhoper.gumroad.com/l/sovereign-os — card checkout, instant download, 7-day full
refund if it does not run on your machine.

Built by Krisakorn Utama, a solo developer in Thailand. Technical questions go to me directly.
```

---

## 2. Payhip

**Product name:**

```
Sovereign OS — self-hosted operations suite (one-time license)
```

**Short description / subtitle:**

```
Run your shop's back office on your own Windows machine. Offline license, no subscription, no cloud account.
```

**Category:** Software → Business · **Product type:** Digital download · **Tags:** self-hosted, offline,
small business, POS, privacy, one-time license

**Full description** (plain text or Markdown; Payhip accepts both):

```markdown
**Own your data and keep working offline.**

Sovereign OS runs on a Windows machine you own: dashboards, energy monitoring, sensors with rules and
alerts, a security panel, encrypted backups, an offline queue and a local AI assistant that reads only your
own data.

- one portable `.exe`, no installer, Windows 10/11 64-bit
- works with the internet down
- your data stays on your machine
- no subscription, no telemetry

**The license.** An Ed25519-signed token that the app checks locally. No activation server, so nothing the
developer can switch off later. Machine-bound, one free transfer per year.

**What you receive.** The build, `INSTALL.txt`, `SHA256SUMS.txt`, the public key to verify your license, and
your signed `license.txt` by email within 24 hours.

**Be clear about fit.** The shop, POS and tax modules follow Thai rules (PromptPay QR, 7% VAT). Outside
Thailand, use the operations side and leave those modules alone.

**Price.** Home $59 · Business $199 · Pro $599. 7-day full refund if it does not run on your machine.

Buy on Gumroad: https://oweenhoper.gumroad.com/l/sovereign-os
Verification guide: https://sovereignoriginshop.dpdns.org/release-verify.html

Developer: Krisakorn Utama (Thailand). Email support in English or Thai.
```

---

## 3. Rules that keep these pages honest

- One link per page: the Gumroad product URL. No bank details, no "DM me to pay".
- Say the Thai fiscal modules are Thai. Buyers punish surprises more than limitations.
- Never claim VAT or accounting compliance for another country.
- Never promise sales, rankings or income. The only promises are the 7-day refund and 24-hour license delivery.
- If a platform forbids external checkout links, keep the page as an unpaid project page and put the Gumroad
  link in your profile bio instead of the description.

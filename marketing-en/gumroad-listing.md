# Gumroad product — exact field-by-field copy

Paste these into Gumroad → **New product → Digital product**. Keep every number identical to
`portfolio/buy-intl.html`: Home $59 · Business $199 · Pro $599.

## 1. Basics

| Gumroad field | Paste this |
|---|---|
| Name | `Sovereign OS — self-hosted operations suite (one-time license)` |
| Type | Digital product |
| URL slug | `sovereign-os` (so the link is `<yourname>.gumroad.com/l/sovereign-os`) |
| Price | `59` (the Home tier; the other two are versions, see 4) |
| Currency | USD |
| "Let customers pay what they want" | **Off** |
| "Show a limited number of seats" | Off |
| Quantity | Unlimited |
| Cover image | `marketing-en/assets/gumroad-cover.jpg` (1280×720) |
| Thumbnail | same file, Gumroad crops it |

## 2. Short description (the one-line summary under the name)

```
Own your data and keep working offline: dashboards, energy, sensors, security, backups and a local AI assistant on one Windows machine. Signed offline license, no subscription.
```

## 3. Description (paste whole block into the rich-text description)

```
Most small-business software assumes three things: a permanent internet connection, a cloud account you do not control, and a monthly payment that outlives the value you get.

Sovereign OS is the opposite. It runs on a Windows machine you own, keeps your data local, and keeps working when the connection drops.

WHAT IS INSIDE — works regardless of your country
- live dashboards with history
- energy monitoring
- device sensors with rules and alerts
- a security panel with a kill switch and a live event stream
- encrypted backups
- an offline queue that survives disconnects
- a local AI assistant that reads only your own data
- multi-user roles
- full English interface (Thai also available)

INSIDE, AND THAI-SPECIFIC — no pretending otherwise
- shop and POS modules with PromptPay QR and Thai VAT (7%)
If your business is outside Thailand, buy this for the operations side and leave those modules unused.

THE LICENSE IS THE POINT
The license is an Ed25519-signed token your machine verifies locally. There is no activation server, so there is nothing to phone home and nothing I can switch off later. It is machine-bound, with one free machine transfer per year.

OPEN-CORE
You can read the code before buying and verify every release yourself against a published key fingerprint: https://sovereignoriginshop.dpdns.org/release-verify.html

WHAT YOU GET ONCE YOU PAY
- the Windows build (portable exe, and a zip for older machines)
- a one-page install guide
- the public key to verify the license yourself
Your signed license.txt follows by email within 24 hours of purchase, because it carries your name and machine ID.

PLANS (choose at checkout)
- Home — $59: 1 machine, 1 year of updates
- Business — $199: 3 machines, 1 year of updates, multi-user roles, security panel, offline queue, shop modules. Renewal after year one is $79.
- Pro — $599: perpetual license, unlimited branches and users, plus a 2-hour online setup session.

REFUND
7 days, full amount, if it does not run on your machine. Tell me what failed and I refund it — no argument.

WHAT THIS IS NOT
- not a subscription, and not a cloud service
- not Thai tax advice, and not accounting compliance for your country
- not resale or white-label rights (ask me first)
- support is by email, in English or Thai

Built by Krisakorn Utama, a solo developer in Thailand. I answer technical questions myself.
```

## 4. Versions (Prices → "Add version")

| Version name | Price | What it changes on the page |
|---|---|---|
| `Home` | `59` | 1 machine, 1 year of updates (the default) |
| `Business` | `199` | 3 machines, 1 year of updates; renewal $79 |
| `Pro` | `599` | perpetual license, unlimited branches and users, 2-hour setup session |

For each version, put this one-liner in its description:

- Home: `1 machine · 1 year of updates · dashboards, sensors, energy, backups, local AI assistant`
- Business: `3 machines · 1 year of updates · adds multi-user roles, security panel, offline queue and the shop modules`
- Pro: `perpetual license · unlimited branches and users · includes a 2-hour online setup session`

## 5. Content (the files buyers download)

Upload these from `marketing-en/assets/` and the release page
(https://github.com/krisakornutama/sovereign-origin/releases/tag/v1.3.10):

- `Sovereign-OS-1.3.10-portable.exe` (188 MB) — the main file
- `Sovereign.OS-1.3.10-win.zip` (340 MB) — keep it on GitHub, upload only if Gumroad accepts the size
- `INSTALL.txt` — `marketing-en/assets/INSTALL.txt`
- `attest-release.pub.pem` — copy of `docs/keys/attest-release.pub.pem`

Leave **"Generate a unique license key per sale" OFF**: the app verifies my Ed25519 token, not a
Gumroad key, and a second key format would only confuse the buyer. The real license is emailed within 24 hours.
Put in the **Content note / receipt note**:

```
Your download starts now. The signed license.txt for your name and machine arrives by email within 24 hours — reply to this receipt with the name for the license and, if you want it machine-bound, the machine ID from the app's /system page.
If the build does not run on your machine, reply within 7 days for a full refund.
```

## 6. Settings to switch before publishing

- **Refund policy**: `7 days, full amount, if the build does not run on your machine.`
- **Call to action / button text**: `Buy Sovereign OS`
- **"Allow customers to pay more than the price"** — your choice, keep it off for a clean price page.
- **Discover / affiliate**: leave affiliates off until you have a first sale.
- **Custom domain**: optional, skip for now.
- **Taxes**: nothing to configure. Gumroad is the merchant of record and collects and remits the sales tax or
  VAT that applies in the buyer's country. Do not add a tax line of your own.

## 7. What you net (direct sales, after Gumroad's cut)

Gumroad takes 10% + $0.50, and card processing 2.9% + $0.30. Estimates, not promises:

| Price | Gumroad + processing | You net (approx.) |
|---|---|---|
| $59 | ≈ $8.41 | ≈ $50.59 |
| $199 | ≈ $26.47 | ≈ $172.53 |
| $599 | ≈ $78.07 | ≈ $520.93 |

Sales that arrive through Gumroad's own Discover marketplace are charged 30% flat instead.

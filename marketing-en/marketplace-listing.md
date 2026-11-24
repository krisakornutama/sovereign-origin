# Marketplace listing copy (Gumroad or any hosted checkout)

Use this when you create the product on a checkout platform. Keep the numbers identical to
`portfolio/buy-intl.html`. Product type: digital, one file plus a license file. Do not enable
subscriptions — the product is a one-time license.

## Product name

Sovereign OS — Self-hosted operations suite (one-time license)

## Short description (one line)

Own your data and keep working offline: dashboards, energy, sensors, security, backups and a local AI
assistant on one Windows machine. Signed offline license, no subscription.

## Full description

Most small-business software assumes three things: a permanent internet connection, a cloud account you
do not control, and a monthly payment that outlives the value you get.

Sovereign OS is the opposite of that. It runs on a Windows machine you own, keeps your data local, and
keeps working when the connection drops.

What is inside, and works regardless of your country:
- live dashboards and history
- energy monitoring
- device sensors with rules and alerts
- a security panel with a kill switch and a live event stream
- encrypted backups
- an offline queue that survives disconnects
- a local AI assistant limited to your own data
- multi-user roles
- full English interface (Thai also available)

Inside, and Thai-specific — no pretending otherwise:
- shop and POS modules with PromptPay QR and Thai VAT (7%)

The license is an Ed25519-signed token your machine verifies locally. There is no activation server, so
there is nothing to phone home and nothing the developer can switch off later. It is machine-bound, with
one free machine transfer per year.

The project is open-core. You can read the code before buying and verify every release yourself against a
published key fingerprint.

Plans
- Home — $59: one machine, one year of updates
- Business — $199: three machines, one year of updates (renewal $79)
- Pro — $599: perpetual license, unlimited branches and users, 2-hour online setup session

Delivery: the Windows build (portable exe and zip), the signed license file, the public key and a
one-page install guide, within 24 hours after payment is confirmed.

Refund: 7 days, full amount, if it does not run on your machine.

Not included: local VAT or sales tax collection, reselling or white-labeling rights, support beyond
email, and any promise that the Thai fiscal modules work outside Thailand.

Developer: Krisakorn Utama. Verification guide: https://sovereignoriginshop.dpdns.org/release-verify.html

## Tags

self-hosted, offline-first, small business, operations, energy monitoring, sensors, license once,
no subscription, open-core

## Files to attach

- The Windows build (portable exe and zip) from the latest GitHub release
- `license.txt` issued per buyer with `npm run license:sell`
- The public key PEM used to verify the license
- A one-page install guide

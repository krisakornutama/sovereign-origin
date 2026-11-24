# Posts — copy, paste, submit (Gumroad checkout live)

Replace `https://oweenhoper.gumroad.com/l/sovereign-os` with your product URL before posting. One link per post. No payment details,
ever — Gumroad handles the money, so there is nothing to send by DM.

Submit pages, so you do not hunt for them:

- Reddit r/selfhosted: https://www.reddit.com/r/selfhosted/submit
- Hacker News: https://news.ycombinator.com/submit
- X: https://x.com/compose/post
- LinkedIn: https://www.linkedin.com/feed/?shareActive=true
- Indie Hackers: https://www.indiehackers.com/new-product

Post one, answer comments for two hours, then the next. Posting all five in ten minutes looks like spam and
gets filtered.

## 1. Reddit — r/selfhosted

Title:

```
I got tired of monthly fees for software that dies with the internet, so I built a self-hosted operations suite and sell it as a one-time license
```

Body:

```
I run a small family business and kept paying monthly for software that stops working when the connection
drops or the vendor changes its pricing. So I built the thing I wanted: one Windows machine, one portable
build, no cloud account, no telemetry.

What it does, country-neutral:
- live dashboards with history
- energy monitoring
- device sensors with rules and alerts
- a security panel with a kill switch and a live event stream
- encrypted backups
- an offline queue that survives disconnects
- a local AI assistant that reads only your own data
- multi-user roles

What it also does, and I will not pretend otherwise: shop and POS modules with Thai PromptPay QR and Thai
VAT 7%, because that is where I live and that is what I needed. Outside Thailand, ignore those modules.

Why a one-time license: the app verifies a signed license locally with Ed25519, so there is no server to
phone home and nothing I can switch off later. Machine-bound, one free transfer per year.

The project is open-core, so you can read what would run on your machine before paying, and verify each
release against a published key fingerprint.

$59 Home (1 machine) · $199 Business (3 machines) · $599 Pro (perpetual). Card checkout is on Gumroad, and
the signed license file follows by email within 24 hours. 7-day refund if it does not run on your machine.

Link: https://oweenhoper.gumroad.com/l/sovereign-os

I am the developer — happy to answer anything technical in the comments, including the parts that are rough.
```

## 2. Reddit — r/selfhosted, short variant (use after a few days if the first one did well)

```
Show r/selfhosted: a local-first ops suite for small business — dashboards, energy, sensors, security,
encrypted backups, offline queue, local AI. One Windows build, no cloud, no telemetry.

The license is an Ed25519 token verified locally with node:crypto, so there is no activation server and
nothing the developer can revoke remotely. One-time price, open-core, verify the release yourself.

$59 / $199 / $599, 7-day refund, instant download: https://oweenhoper.gumroad.com/l/sovereign-os
I built it, so ask me the hard questions here.
```

## 3. Hacker News — Show HN

Title:

```
Show HN: Self-hosted ops suite for small business, offline license, one-time price
```

Body (URL field: `https://oweenhoper.gumroad.com/l/sovereign-os`):

```
I am a solo developer in Thailand. I built a local-first operations suite for small businesses:
dashboards, energy monitoring, device sensors with rules and alerts, a security panel with a kill switch,
encrypted backups, an offline queue, and a local AI assistant scoped to the owner's own data.

The part I care about is the licensing model. Buyers get an Ed25519-signed token; the machine verifies it
with node:crypto and never calls my server. No activation outage, no subscription, and nothing I can revoke
remotely. The trade-off is honest too: a signed token cannot be revoked instantly online, so I sell perpetual
and one-year licenses with a published key fingerprint instead of pretending revocation works.

The code is open-core, so the claim is checkable: build the repository, verify a release against the
fingerprint, then decide whether to buy. I also label the tax and payment modules as Thai-specific
(PromptPay QR, 7% VAT) instead of implying they are universal.

Pricing: $59 / $199 / $599 by machine count and update window, card via Gumroad, license emailed within
24 hours, 7-day refund. Feedback on the licensing model and the page copy is more useful to me than praise.
```

## 4. X — 5-post thread

```
1/ I got tired of paying monthly for shop software that dies when the internet dies.
So I built a self-hosted operations suite and sell it as a one-time license.
No cloud, no telemetry, no subscription.
```

```
2/ Inside: dashboards, energy monitoring, sensors with rules and alerts, a security panel with a kill
switch, encrypted backups, an offline queue, and a local AI assistant over your own data.
```

```
3/ The license is the interesting part. An Ed25519 token your machine verifies locally with node:crypto.
No activation server. Nothing I can switch off later. Machine-bound, one free transfer a year.
```

```
4/ Honest about fit: the shop and POS modules are Thai-specific (PromptPay QR, 7% VAT). Outside Thailand,
buy it for the operations side and leave those modules unused.
```

```
5/ $59 Home · $199 Business · $599 Pro perpetual. Card checkout, instant download, license by email
within 24 hours. 7-day refund if it does not run on your machine.
https://oweenhoper.gumroad.com/l/sovereign-os
```

## 5. LinkedIn

```
I just put the software I use to run a small business on sale, and I want to be precise about what it is.

Sovereign OS runs on one Windows machine you own. Dashboards, energy monitoring, device sensors with rules
and alerts, a security panel, encrypted backups, an offline queue and a local AI assistant. It keeps working
when the internet does not, and it does not have a cloud account or telemetry.

The license is signed and verified offline, so there is no activation server to depend on. Buy once: $59 for
one machine, $199 for three, $599 for a perpetual license with a setup session.

Two things I will not oversell: the tax and shop modules follow Thai rules (PromptPay QR, 7% VAT), and I am
the developer selling this directly, not a company with a support team. Card checkout, instant download,
7-day refund: https://oweenhoper.gumroad.com/l/sovereign-os
```

## 6. Indie Hackers — product post

```
What it is: a self-hosted operations suite for small business — dashboards, energy, sensors with alerts,
security panel, encrypted backups, offline queue, local AI assistant. One Windows build.

How it is sold: one-time license, $59 / $199 / $599. Gumroad for cards, license file emailed within 24 hours.
The app verifies an Ed25519 token offline, so there is no subscription and no activation server — that is the
whole product thesis: software that keeps working after the vendor loses interest.

What I am learning: whether small businesses will pay once for tools they can hold, instead of renting.
Rough edges are documented on the page rather than hidden: Thai-only fiscal modules, email support, no cloud sync.

https://oweenhoper.gumroad.com/l/sovereign-os
```

## 7. One-line bio link (GitHub profile, YouTube description, email signature)

```
Sovereign OS — self-hosted operations suite, one-time license, offline activation: https://oweenhoper.gumroad.com/l/sovereign-os
```

## Replies to keep open while a post is live

- "Is this just a dashboard?" → `The dashboard is the visible part. The useful part in production is the offline queue and the alert rules — it keeps recording while the link is down and reconciles after.`
- "Why not open source it fully?" → `The core is readable and every release is verifiable against a published fingerprint. What I sell is the signed license and the packaged Windows build, not a secret binary.`
- "Does it work outside Thailand?" → `The operations side does. The shop, POS and tax modules follow Thai rules; outside Thailand leave them unused and the rest is unaffected.`
- "Refund?" → `7 days, full amount, if it does not run on your machine. Reply to the Gumroad receipt.`

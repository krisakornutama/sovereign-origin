# Gumroad launch — the exact click path (about 20 minutes)

This is the shortest honest route from "nothing" to "a stranger can pay by card and download".
Two things only you can do, because they need your identity: **create the account** and **verify the payout**.
Everything else here is a paste.

## 0. Before you start (1 minute)

- Have your Thai ID card or passport photo ready, and a recent bank statement or utility bill as proof of address.
- Have your Krung Thai bank book to hand — Gumroad pays out in **THB** to a **local Thai bank account**,
  and the account name must be **กฤษกรณ์ อุตมะ**, exactly as the bank has it.
- Do not put your account number in any public post. Gumroad collects it inside its own settings page.

## 1. Create the account (3 minutes)

1. Open https://gumroad.com/signup and sign up with your email. Use your real name.
2. Confirm the email link Gumroad sends you.
3. Settings → **Profile**: put your real name, and in the bio one line:
   `Solo developer in Thailand. I build self-hosted software you buy once.`

## 2. Payout verification — the step that decides whether money can reach you (6 minutes)

Settings → **Payments** (payout settings):

1. Country: **Thailand** · Payout currency: **THB**.
2. Bank: Krung Thai Bank · account name **กฤษกรณ์ อุตมะ** · your account number · branch as on the passbook.
3. Upload the photo ID and the proof of address when asked. This goes to Stripe for verification; Gumroad's
   staff do not read it.
4. Save. **Do not skip this.** With no verified payout method you can make sales but the money sits in Gumroad.

Facts to expect, so nothing surprises you later:

- Minimum payout for Thailand is **฿600**, not $100.
- Gumroad pays out on a schedule and bank transfers take 2–7 business days, longer around holidays.
- Gumroad is the **merchant of record**: it collects and remits VAT / sales tax worldwide, so you do not
  register for VAT anywhere to sell this.

## 3. Create the product (7 minutes)

1. https://gumroad.com/products/new → **Digital product**.
2. Fill every field from `marketing-en/gumroad-listing.md` (name, slug, $59, description, tags).
3. Add versions **Home / Business / Pro** at 59 / 199 / 599.
4. Upload the content files listed in that file (portable exe + `INSTALL.txt` + public key).
5. Set the refund policy line, keep Gumroad license keys **off**, paste the receipt note.
6. **Publish**. Copy the product URL (`https://<yourname>.gumroad.com/l/sovereign-os`).

## 4. Switch the website over (1 minute)

The sales page already has a hidden instant-checkout block. Send me the product URL and I set it in
`portfolio/buy-intl.html` (`const GUMROAD_URL = '...'`), or paste it there yourself and push — the block
becomes a "Buy on Gumroad" button and the email path stays as the fallback. Until that constant is filled,
the page keeps working exactly as it does today.

## 5. Prove the whole chain before you promote it (3 minutes)

Do this once, yourself, with a real card or a 100% discount code. It is the only way to know the buyer gets
files instead of an apology:

1. Gumroad → your product → **Discounts** → create a 100% off code `SELF-TEST`.
2. Buy your own product with it. Watch for: the receipt email, the download link, `INSTALL.txt` inside.
3. Run the build on a machine that is not your dev box if you can — a clean Windows user account is enough.
4. Then send yourself the license with `npm run license:sell` (see `gumroad-delivery.md`) and confirm the app
   accepts it offline, with the network cable out.
5. Only after that, post (`gumroad-posts.md`).

## 6. Post, in this order

`gumroad-posts.md` has the text for Reddit, Hacker News, X, LinkedIn and Indie Hackers, with a first-day
order and the reply scripts to keep open.

## What is still manual, and why

- **The license email.** Gumroad delivers files instantly; the license carries the buyer's name and machine
  ID, so it is issued per buyer with `npm run license:sell` and emailed within 24 hours. Every honest listing
  on this page says "within 24 hours", so the promise is kept even if you are asleep when the sale lands.
- **Support and refunds.** Gumroad processes the refund; you approve it. 7 days, full amount, no argument.
- **No guarantee of income.** Nobody can promise you sales. What this kit guarantees is that a stranger who
  wants to pay you now has a working card checkout, a legal tax path, and files waiting for them.

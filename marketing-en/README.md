# International selling kit — copy, paste, post

Everything here drives traffic to https://sovereignoriginshop.dpdns.org/buy-intl.html
(the English page; the Thai page is `buy.html`).

## Facts you must not change in a post

- Prices: Home $59 · Business $199 (renewal $79) · Pro $599 perpetual. 1 / 3 / unlimited machines.
- 7-day refund if it does not run on the buyer's machine. Delivery within 24 hours after payment.
- Full English UI; Thai also available.
- License is Ed25519-signed and verified offline. Machine-bound, one free transfer per year.
- Country-neutral scope: dashboards, energy, sensors and alerts, security panel, encrypted backups,
  offline queue, local AI assistant, multi-user roles.
- Thai-only scope (say it plainly, never hide it): shop and POS with PromptPay QR and Thai VAT 7%.
- Not a merchant of record **on a direct invoice**: no local VAT or sales tax is collected there.
  Through Gumroad it is the opposite — Gumroad is the merchant of record and collects and remits the
  sales tax or VAT that applies in the buyer's country. Say which path you mean, every time.

## Files

| File | Use it for |
|---|---|
| `posts.md` | Reddit, Hacker News, X thread |
| `dm-scripts.md` | Replies: asks for a discount, wants a demo, says "paid" |
| `marketplace-listing.md` | Product copy for a checkout platform (Gumroad or similar) |
| `checklist-10-min.md` | The order to press things in, plus the license command when money arrives |
| `gumroad-launch.md` | **Start here for Gumroad**: account, Thai payout verification, product, test buy |
| `gumroad-listing.md` | Every Gumroad product field, ready to paste (name, price, versions, description, receipt note) |
| `gumroad-posts.md` | Posts for the launch week: Reddit, Hacker News, X, LinkedIn, Indie Hackers |
| `gumroad-delivery.md` | What to upload, and how the signed license is delivered after each sale |
| `assets/INSTALL.txt` | The one-page install guide attached to the product |
| `assets/gumroad-cover.jpg` | Product cover, 1392×752 (Gumroad crops to 1280×720) |

## Hard rules

- No payment details in public posts. Send them in DM or on the invoice only.
- One link per post. Do not stack URLs.
- Never promise sales, rankings or "guaranteed income" — the only guarantees are the 7-day refund and the 24-hour delivery.
- Disclose that you are the developer. Reddit and Hacker News punish undisclosed self-promotion.
- Never claim EU VAT, US sales tax or accounting compliance. The product does not do that.

## Consistency check before posting

```
node portfolio/scripts/check-copy.mjs
grep -o "\$59\|\$199\|\$599" portfolio/buy-intl.html | sort -u
grep -o "\$59\|\$199\|\$599" marketing-en/*.md | sort | uniq -c
```

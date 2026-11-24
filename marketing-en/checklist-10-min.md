# 10-minute checklist — from zero to first inbound message (international)

Print this or keep it open. Each step is a paste, not a writing task.

- [ ] **0–1 min — open your own page first**
      Open https://sovereignoriginshop.dpdns.org/buy-intl.html and confirm Home $59 / Business $199 /
      Pro $599 and the 7-day refund line are there. If you change a price, change it in
      `portfolio/buy-intl.html` first and let it deploy.

- [ ] **1–4 min — Reddit**
      Post the r/selfhosted text from `marketing-en/posts.md`. Read the subreddit rules for the day and
      answer every technical comment honestly. One post per subreddit, no cross-post spam.

- [ ] **4–6 min — Hacker News**
      Submit the Show HN text. Do not ask for upvotes anywhere — that gets the account flagged and the
      post killed. Reply to comments for two hours; that window matters more than the post itself.

- [ ] **6–8 min — X**
      Post the 5-post thread in order. Pin post 1 for the week.

- [ ] **8–9 min — the places people already look**
      Add the link to your GitHub profile bio, your YouTube description and your LinkedIn headline.
      One link only.

- [ ] **9–10 min — be ready to answer**
      Keep `marketing-en/dm-scripts.md` open. Answer within the hour if you can; the first reply usually
      decides whether a stranger pays.

## When the money arrives

1. Check the payment actually landed and matches the plan and the amount.
2. Ask for the invoice name, the license name, and (optionally) the machine ID.
3. Issue the license and the delivery pack with one command:
   `npm run license:sell -- --key <private.pem> --public-key <public.pem> --licensee "Buyer or business" --tier business --machines <machine-id> --days 365 --amount 199 --sku SW-INTL-BUSINESS --paid`
   Use `--amount` in the currency you were actually paid in, and keep one ledger row per sale.
4. Send `sales/<order>/license.txt` and `sales/<order>/delivery.md`, plus the build from the latest release.
5. Point the buyer at the release verification page so they can check the build themselves.
6. Refund in full if they report within 7 days that it does not run.

## Before you post — consistency check

Run from the repository root:

```
node portfolio/scripts/check-copy.mjs
grep -o "\$59\|\$199\|\$599" portfolio/buy-intl.html | sort -u
grep -o "\$59\|\$199\|\$599" marketing-en/*.md | sort | uniq -c
grep -c "buy-intl.html" portfolio/buy-intl.html marketing-en/posts.md
```

You should see: check-copy PASS · all three prices in both the page and the marketing files · the English
page link in every post file.

## Rules that keep this honest

- Say the Thai fiscal modules are Thai. Buyers punish surprises more than limitations.
- Never claim VAT, sales-tax or accounting compliance for another country.
- Never promise sales, rankings or income. The only promises are the 7-day refund and 24-hour delivery.
- Disclose that you are the developer in every post.
- No payment details in public threads, ever.

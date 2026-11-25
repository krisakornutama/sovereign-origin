# Delivery — files on Gumroad, license by email

Gumroad hands over the build the second the card clears. The license is personal, so it is issued per order.
This file is the exact sequence for one sale, in the order the money arrives.

## 1. What sits on the product page (upload once)

From the release https://github.com/krisakornutama/sovereign-origin/releases/tag/v1.3.10 :

| File | Size | Why |
|---|---|---|
| `Sovereign-OS-1.3.10-portable.exe` | 188 MB | the build most buyers run |
| `SHA256SUMS.txt` | 193 B | attach as a product file — buyers verify without leaving the page |
| `Sovereign.OS-1.3.10-win.zip` | 340 MB | **not attached** (too large for this flow) — the content copy says it is on the release page |
| `INSTALL.txt` | small | `marketing-en/assets/INSTALL.txt` |
| `attest-release.pub.pem` | small | copy of `docs/keys/attest-release.pub.pem` |

Also put the verification page in the description: https://sovereignoriginshop.dpdns.org/release-verify.html
Buyers can check the build without trusting GitHub, and that is a selling point, not a chore.

## 2. When a sale notification arrives

1. Open Gumroad → **Sales** → the order. Note the buyer's email, the version (Home / Business / Pro) and the
   amount actually charged (Gumroad's fee is already deducted from your balance, not from the order total).
2. Reply to the receipt asking for the two things the license needs:
   ```
   Thanks — the download is live in your receipt.
   To issue your license I need:
   1. the name to print on it (person or business)
   2. optionally, the machine ID from the app's /system page — or say "unbound" and I bind it later
   ```
3. Issue and verify with one command (it refuses to write files if the signature does not verify):
   ```
   npm run license:sell -- --key .secrets/license-priv.pem --public-key docs/keys/attest-release.pub.pem \
     --licensee "Buyer or Business" --tier business --machines <machine-id> --days 365 \
     --amount 199 --sku SW-INTL-BUSINESS --paid
   ```
   Use `--perpetual` instead of `--days` for Pro. `--amount` takes the price the buyer paid on the product page.
4. Attach `sales/<order>/license.txt` to the Gumroad receipt thread, and paste the delivery note below.
5. Keep `sales/ledger.jsonl` — it is your record of what was sold, for whom and at what price. `sales/` is
   gitignored on purpose: it holds buyer names.

## 3. Delivery note to paste into the sale thread

```
Attached: license.txt, signed for <name>. It verifies offline — the app never calls a server.

To activate: put license.txt where the install guide says, then open Settings → License and confirm it reads
"valid". If it does not, send me the exact message and I will fix it today.

Verify the build yourself first if you want: https://sovereignoriginshop.dpdns.org/release-verify.html
SHA256SUMS.txt from the release page should match your download.

Updates for one year are included (Home and Business). After that the version you have keeps working.
Anything breaks in the first 7 days — reply here and I refund the full amount, no questions.
```

## 4. Refunds and chargebacks

- Refund from Gumroad → Sales → the order → Refund. Full amount, within 7 days, when the buyer says it does
  not run. Issue it the same day; a public dispute costs more than the sale.
- Add one line to the ledger row (`paid` stays as it is; note the refund in `sales/notes.md`) so the numbers
  you quote later are true.
- A chargeback after a delivery you can prove (receipt + license + support thread) is winnable — keep the thread.

## 5. Weekly, ten minutes

- Gumroad → Payouts: check the balance and the next payout date. Thailand minimum is ฿600.
- Compare Gumroad sales with `sales/ledger.jsonl`: every paid order should have a license row. A sale with no
  license is a buyer who paid and got nothing but files — fix that first.
- One improvement per week to the product page, based on the questions buyers actually asked.

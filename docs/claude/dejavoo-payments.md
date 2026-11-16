# Dejavoo / iPOSPays card payments: plan + open questions

Status (2026-11-16): PLAN v2, written from the iPOSpays Developer Central
docs (Hosted Payment Page, iPOS Transact, FEED, Tap to Pay on Android,
Recurring). No code yet; waiting on Bernard's OK. Sandbox only.
Processor: Banc Card of America. Demo merchant: Creed Handyman LLC, CloudPOS on.

## What the docs confirmed

| Need | Dejavoo API | Sandbox URL |
|---|---|---|
| Make a pay link | HPP "external payment transaction" (v3) | `POST https://payment.ipospays.tech/api/v3/external-payment-transaction` |
| Auth for HPP + refunds/voids | JWT from API Key + Secret Key, header `token` | `POST https://auth.ipospays.tech/v1/authenticate-token` (expiry 30 min to 24 h) |
| Confirm a payment server-side | Query Payment Status, header `Authorization` = per-TPN **Ecom token** | `GET https://api.ipospays.tech/v1/queryPaymentStatus?tpn=&transactionReferenceId=` |
| Kill an unpaid link | Cancel Payment Link (Authorization = the link's `t` value) | `POST https://payment.ipospays.tech/api/v1/cancel` |
| Refund / void | iPOS Transact, by the original **RRN**; type 3 = refund, 2 = void; empty amount = full, partial allowed, never send 0 | `POST https://payment.ipospays.tech/api/v3/iposTransact` |
| Charges made outside Creed (CloudPOS, terminals) | FEED: real-time transaction + settlement push, Basic auth or HMAC-SHA512 | configured in the portal, **ISO account only** (Banc Card) |

Production = same paths on `.com` instead of `.tech` (auth.ipospays.com,
payment.ipospays.com, api.ipospays.com). Production credentials come from
devsupport after the sandbox integration is done.

Key HPP request facts:
- `merchantId` = the 12-digit TPN. `transactionReferenceId` = OUR id,
  alphanumeric, max 42 chars. We guarantee it's unique.
- `amount` in cents. Set `calculateFee: false` and `calculateTax: false`
  explicitly (both default TRUE: Dejavoo would add its own fee/tax on top of
  Creed's invoice total, which already has tax).
- `tipsInputPrompt` optional; the tip comes back as its own `tips` field, so
  Creed keeps tips out of the job balance (same as Stripe today).
- `expiry` 1 to 31 days. `sendPaymentLink: false` + `eReceipt: false`: Creed
  sends the link itself (invoice / Messages app).
- One request can set BOTH `postAPI` (server-to-server callback) with our own
  `authHeader` (up to 50 chars) AND `returnUrl` / `failureUrl` / `cancelUrl`
  (customer redirect).
- `personalization`: business name, logo (PNG ≤100 KB, ~110×90), theme color.
- Status codes: 200 success, 400 declined/failed, 401 cancelled by customer,
  402 rejected by customer.
- Callback / redirect / query all return `transactionId`, `rrn`, `amount`,
  `tips`, `customFee`, taxes, `totalAmount`, card brand + last 4.

## Which product fits

- **Invoice pay link: Hosted Payment Page.** Card numbers never touch Creed
  (PCI stays minimal, like Stripe Checkout).
- **Field, version 1: the same HPP, two ways.** (a) **QR code** on the tech's
  phone; the customer scans and pays on their own phone (preferred: the
  customer types their own card). (b) The tech opens the page and keys the
  card in for the customer. Both record automatically.
- **CloudPOS virtual terminal:** works today, but its charges only reach
  Creed through FEED, which Banc Card must set up on their ISO account.
  Phase 2: match a FEED charge to a job by the invoice number the tech types.
  Until then a CloudPOS charge = owner marks the job paid by hand.
- **Tap to Pay on Android: not now.** It's a native Android SDK (Creed is a
  web app / PWA, the Play Store app is a wrapper) and the docs list TSYS as
  the only supported processor.
- **Card on file / recurring:** possible later (HPP `requestCardToken`, then
  iPOS Transact sale-cardtoken). Not in v1.

## How a payment gets confirmed (never trust one message alone)

1. Owner/tech taps Pay link / QR. Server creates a `payment_attempts` row
   (our reference id, job, org, amount in cents, a random callback secret),
   calls HPP with `postAPI` = `/api/dejavoo/callback`, `authHeader` = that
   secret, `returnUrl` = `/payment/dejavoo-return?ref=…`.
2. Callback arrives: check the auth header against the attempt's secret;
   then **re-ask Dejavoo** (queryPaymentStatus with the org's Ecom token) and
   only trust THAT answer: responseCode 200, same reference id, amount = the
   attempt's amount.
3. Record through the existing `fulfillJobPayment` (ledger insert, paid-to-
   date, job → paid when the work is done, review request, owner alert). The
   ledger row is keyed unique on (processor, processor_txn_id) so the
   callback + the redirect + a retry record it once.
4. The return page runs the same re-query, so a lost callback still records.
5. A pending link is cancelled (Cancel API) when the job is paid another way
   or the amount changes.

## Database (migration needs Bernard's yes before it runs on live)

1. `org_payment_processors`: `org_id`, `processor` ('dejavoo'),
   `environment` ('sandbox' | 'live'), `tpn`, `api_key_enc`,
   `secret_key_enc`, `ecom_token_enc`, `last4` hints, `enabled`, timestamps.
   RLS ON with NO client policies (server/service role only). Secrets
   AES-256-GCM encrypted with Vercel env `PROCESSOR_CREDS_KEY`.
   The minted JWT is cached server-side (in memory / short-lived row, never
   sent to the browser) and re-minted before expiry.
2. `payment_attempts`: `reference_id` (unique), `org_id`, `job_id`,
   `amount_cents`, `callback_secret_hash`, `hpp_token` (for Cancel),
   `status`, `created_at`, `expires_at`.
3. `payments` (existing ledger): add `processor` (default 'stripe'),
   `processor_txn_id`, `processor_rrn`; UNIQUE (processor, processor_txn_id).
   Stripe rows unchanged.
4. Add the new tables/columns to preflight's DB_CHECKS.

## Server

- `lib/dejavoo.ts`: the ONLY code that calls iPOSpays (token, create link,
  query, cancel, refund, void). Base URLs chosen from the org's environment.
- `lib/processor-creds.ts`: load + decrypt an org's credentials (server only).
- `/api/dejavoo/checkout` (org-scoped like `/api/checkout`), `/callback`,
  `/verify` (return page), `/refund`, `/settings` (save + "Test connection";
  only ever answers "saved, ends in 1234").
- Refunds: void when the batch is still open, else refund (or try void,
  fall back to refund; see question 4); recorded with `recordJobRefund`.

## App UI

- Ops → Settings → **Payments** category: card processor (Stripe /
  Dejavoo), TPN, API key, Secret key, Ecom token, Sandbox/Live, Test button.
- Invoice, Send-invoice text, /status page: Pay follows the org's processor.
  Stripe orgs see no change.
- Job → **Take card payment**: QR code for the customer, or "enter card".
- Refund button on a Dejavoo payment (owner/manager).

## Test

`DEJAVOO_SANDBOX=1`-gated script: mints a token, makes a pay link for a test
job, prints the link; you pay with a Dejavoo test card; it then polls status
and checks the payments row + job status. Unit tests (fake iPOSpays) for:
callback auth, re-query mismatch (wrong amount / reference / declined), double
callback = one ledger row, tip kept out of the balance, refund proration.
Sandbox creds for the script live in `.env.dejavoo.local` (gitignored via
`.env*.local`).

## Open questions for the Dejavoo developer call

1. **Auth tokens, per merchant or per ISO?** The docs say the HPP `token` is
   minted from an "ISO Admin account" API + Secret key, and elsewhere that
   Merchant Admins can generate keys too. For a platform with many merchants:
   does each merchant generate its own API/Secret key, or does Creed (as an
   ISV) get one key that works for every TPN it's linked to?
2. Is there an ISV / partner program for onboarding each Creed business's
   merchant account, and can Creed take a platform fee on HPP payments?
3. Callback: does Dejavoo retry the `postAPI` call if we don't answer 200?
   How many times, how long? Is the callback body exactly the
   queryPaymentStatus shape?
4. Void vs. refund: until when is a void allowed (batch close time)? What
   error comes back if we void a settled charge? Is the batch auto-closed?
5. Is `transactionReferenceId` unique-enforced by Dejavoo? What happens if a
   customer opens one link twice / double-taps Pay?
6. `integrationVersion: "v2"`: what exactly changes (the docs say legacy =
   "base amount excludes tip")? Which should a new integration use?
7. Surcharge / cash discount: if the merchant's TPN is on a fee program, does
   `calculateFee: false` really stop any fee being added? Who is allowed to
   turn that off?
8. Sandbox test cards, and amounts/cards that force a decline, AVS or CVV fail.
9. FEED: can Banc Card enable it for the sandbox and point it at Creed? Is it
   per ISO, or can each merchant have its own endpoint? Which payload field
   carries the invoice number a tech types in CloudPOS?
10. Is the HPP link usable on a phone in landscape / inside an installed PWA
    (any iframe or popup limits)? Is a light-box/embedded mode documented?
11. Tap to Pay on Android: is TSYS still the only processor, and which
    processor is Banc Card's demo merchant on? Any web (not native) option?
12. Apple Pay / Google Pay on HPP: on by default, or enabled per merchant?
13. Rate limits on authenticate-token / queryPaymentStatus?
14. Confirm HPP keeps Creed at PCI SAQ-A.
15. ACH on HPP (docs list Paya / Vericheck): available through Banc Card?

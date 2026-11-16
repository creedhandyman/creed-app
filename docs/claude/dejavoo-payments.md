# Dejavoo / iPOSPays card payments — plan + open questions

Status (2026-11-16): PLANNING. No code yet. Waiting on (1) the API docs from
the iPOSPays portal (Resources), (2) Bernard's OK on this plan. Sandbox only.
Processor: Banc Card of America. Demo merchant: Creed Handyman LLC, CloudPOS
(virtual terminal) on.

Everything marked (confirm) is what I expect from iPOSPays' public material;
the docs or the developer call decide it.

## Which product fits

- **Pay link (invoice / text): iPOSPays hosted payment page** ("iPOS Transact"
  / external payment transaction API). Our server asks iPOSPays for a payment
  URL for the job's balance and sends the customer there. Card numbers never
  touch Creed (keeps us out of PCI scope, same as Stripe Checkout today).
- **Confirming payment:** the hosted page calls back to a URL we pass in the
  request (confirm). We never trust that callback body alone: the server
  re-asks iPOSPays for the transaction's status (query / transaction status
  API, confirm) before it records anything. Same rule as `/api/verify-payment`
  for Stripe. The customer's return redirect does the same check, so a
  dropped callback still gets recorded.
- **Running a card in the field:** first version = the tech opens the same
  hosted pay page on their phone from the job ("Take card payment") and keys
  the card in. Payment lands in Creed automatically. CloudPOS (the virtual
  terminal in the portal) works today but its charges never reach Creed unless
  iPOSPays can report them to us; the owner would have to mark the job paid
  by hand. Card-present (tap / dip on a Dejavoo terminal through the SPIn API,
  or tap to pay on the phone) is a later phase; see questions.

## Database (migration needs Bernard's yes before it runs on live)

1. `org_payment_processors`: one row per org per processor.
   `org_id`, `processor` ('dejavoo'), `environment` ('sandbox' | 'live'),
   `tpn` (plain, not secret), `auth_token_enc` (encrypted), `token_last4`,
   `enabled`, `created_at`, `updated_at`. **RLS on with NO client policies**:
   only server routes using the service role can read it. The token is
   encrypted (AES-GCM) with a server key from Vercel env
   (`PROCESSOR_CREDS_KEY`), so even a database dump doesn't expose it.
2. `payments` (the existing ledger): add `processor` (default 'stripe') and
   `processor_txn_id`, with a UNIQUE index on (processor, processor_txn_id).
   That's the idempotency key for Dejavoo, the same job `stripe_session_id`
   does for Stripe, so the callback + the redirect + a retry record a charge once.
   Existing Stripe rows are unchanged.
3. `payment_attempts` (maybe; depends on the docs): our reference id → job,
   amount and org, written when a pay link is made, so a callback can be
   matched to its job without trusting anything in the callback.
4. Add every new table / column to preflight's DB_CHECKS.

## Server

- `lib/dejavoo.ts`: the only code that talks to iPOSPays (create payment URL,
  query status, refund / void). Sandbox vs. live base URL comes from the org's
  row, never from the client.
- `lib/processor-creds.ts`: load + decrypt an org's credentials (server only).
- `/api/dejavoo/checkout`: makes the hosted-page link for a job (org-scoped
  like `/api/checkout`).
- `/api/dejavoo/callback`: receives the notification, re-queries status, then
  calls the existing `fulfillJobPayment` (records the ledger row, flips the job
  to paid when the work is done, review request, owner alert). No second
  "mark paid" path.
- `/api/dejavoo/verify`: the return-redirect check (same re-query).
- Refunds / voids: via `lib/dejavoo.ts`, recorded with the existing
  `recordJobRefund`.
- `/api/dejavoo/settings`: owner saves TPN + token. It encrypts, stores, and
  only ever answers "saved, ends in 1234"; the token is never sent back.

## App UI

- Ops → Settings → **Payments** category (new): pick the card processor
  (Stripe or Dejavoo), enter TPN + token, Sandbox/Live switch, "Test
  connection" button.
- Invoice / Send-invoice text / /status page: the Pay button goes to the
  org's processor. Orgs on Stripe see no change.
- Jobs → job: **Take card payment** (owner/manager/tech) opens the hosted page
  for the balance on the tech's phone.
- Refund button on a Dejavoo payment, same place as Stripe's.

## Test

A sandbox script (`scripts/dejavoo-sandbox-test`, gated like the audit tests:
skips unless `DEJAVOO_SANDBOX=1`) that makes a pay link for a test job, has
you pay it with a Dejavoo test card, then checks the payments row and job
status. Plus unit tests for the callback → re-query → fulfill path with a fake
iPOSPays.

## Open questions for the Dejavoo developer call

1. Hosted page: is "iPOS Transact" / external payment transaction the right API
   for an invoice pay link? Sandbox + live base URLs?
2. Auth: one token per merchant (TPN)? Generated where in the portal? Does it
   expire or rotate?
3. Callback: what exactly is posted, and is it signed (HMAC / shared secret)?
   Retries if we answer non-200? Are callback URLs per request or set in the
   portal?
4. Status query: what API confirms a transaction server-side, and by which id
   (our reference id or theirs)?
5. Is our reference id echoed back, and is it unique-enforced (stops double
   charges on a double-tapped link)?
6. Can a pay link be reused or expire? Can the amount be locked so the
   customer can't change it?
7. Tips on the hosted page: supported? Returned as a separate amount? (Creed
   keeps tips out of the job balance.)
8. Surcharge / cash-discount programs: does the hosted page add a fee, and how
   is it reported? (affects what "paid in full" means)
9. Refunds and voids by API: void before settlement, refund after? Partial
   refunds? Batch / settlement times?
10. CloudPOS virtual terminal charges: can they be reported to us (webhook or
    reporting API) so a card run there marks the job paid?
11. Field card-present: SPIn API with a terminal, or a tap-to-pay-on-phone
    product? What hardware does Banc Card supply?
12. Multi-merchant: how does a software platform onboard each business's own
    merchant account (ISV / partner program, per-merchant tokens, can Creed
    take a platform fee)?
13. Sandbox test cards and amounts that trigger declines / AVS / CVV failures.
14. ACH / bank payments through iPOSPays?
15. PCI: confirm hosted page keeps us SAQ-A.

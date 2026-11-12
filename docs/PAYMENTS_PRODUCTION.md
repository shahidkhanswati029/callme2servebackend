# CallMe2Serve — Production payment methods (apply + wire)

Default is **sandbox** (`PAYMENTS_MODE=sandbox`): no real money; package/job pay still updates ledger and receipts.

Set **`PAYMENTS_MODE=live`** only after each rail’s merchant credentials are approved and webhook URLs are registered.

## Architecture (already in code)

1. `PaymentTransaction` row created for every package/job charge.
2. Provider adapter (`sandbox` | `jazzcash` | `easypaisa` | `stripe` | `paypal`) returns `SUCCEEDED` or `REQUIRES_ACTION` + `checkoutUrl` / `clientSecret`.
3. Webhooks: `POST /api/payments/webhooks/:provider` mark SUCCEEDED and finalize package upgrade or job ledger/receipt.
4. Inspect mode: `GET /api/payments/mode`.

---

## Step-by-step: apply for each rail

### A. JazzCash (Pakistan wallet / mobile account)

1. Register a **JazzCash Merchant** account (JazzCash Merchant Portal / bank partner onboarding).
2. Submit business docs: CNIC/NTN, bank account, website/app URLs, product description (marketplace services).
3. Request **Hosted Checkout / Payment Gateway** + **IPN (Instant Payment Notification)**.
4. After approval you receive: `MerchantID`, `Password`, `IntegritySalt`.
5. Put them in `.env`:
   - `JAZZCASH_MERCHANT_ID`
   - `JAZZCASH_PASSWORD`
   - `JAZZCASH_INTEGRITY_SALT`
6. In the portal set:
   - Return URL → your frontend success page
   - IPN URL → `https://<API_HOST>/api/payments/webhooks/jazzcash`
7. Test in JazzCash sandbox first; then production checkout URL.
8. Replace the signed form fields inside `gateway/jazzcash.provider.ts` with the official field set from their docs (HMAC with IntegritySalt).

### B. Easypaisa (Pakistan wallet)

1. Apply via **Easypaisa Merchant / Telenor Microfinance** partner onboarding (or your acquiring bank).
2. Provide the same KYC/business pack + callback URLs.
3. Receive `StoreId` + hash/secret key.
4. Env:
   - `EASYPAISA_STORE_ID`
   - `EASYPAISA_HASH_KEY`
5. Register IPN: `https://<API_HOST>/api/payments/webhooks/easypaisa`
6. Finish signed request in `gateway/easypaisa.provider.ts` per Easypay v2 docs.

### C. Debit / credit card + Google Pay → Stripe

1. Create account at [https://dashboard.stripe.com](https://dashboard.stripe.com).
2. Complete business verification (activate account) for live charges.
3. Developers → API keys → copy **Secret** + **Publishable** keys.
4. Developers → Webhooks → Add endpoint:
   - URL: `https://<API_HOST>/api/payments/webhooks/stripe`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
5. Env:
   - `STRIPE_SECRET_KEY=sk_live_…` (or `sk_test_…` while testing)
   - `STRIPE_PUBLISHABLE_KEY=pk_…`
   - `STRIPE_WEBHOOK_SECRET=whsec_…`
6. Frontend: use **Stripe Payment Element** (never POST raw PAN in live mode — API rejects that).
7. Enable **Google Pay** in Stripe Dashboard → Payment methods; same PaymentIntent path covers `GOOGLE_PAY` rail.
8. Install `stripe` SDK and replace the theoretical PaymentIntent stub in `gateway/stripe.provider.ts`.

### D. PayPal

1. [https://developer.paypal.com](https://developer.paypal.com) → Apps & Credentials.
2. Create app → Sandbox credentials for tests; Live credentials after business verification.
3. Env:
   - `PAYPAL_CLIENT_ID`
   - `PAYPAL_CLIENT_SECRET`
   - `PAYPAL_MODE=sandbox` then `live`
4. Webhook / return URL: `https://<API_HOST>/api/payments/webhooks/paypal`
5. Finish Orders v2 create + capture in `gateway/paypal.provider.ts`.

---

## Go-live checklist

1. All provider keys in production secrets (not committed).
2. `PAYMENTS_MODE=live`
3. HTTPS API with public webhook routes (no JWT on webhooks; verify provider signatures).
4. Frontend: if response has `checkoutUrl`, redirect; if `clientSecret`, mount Stripe Elements.
5. Confirm one test charge per rail → `PaymentTransaction.status=SUCCEEDED` + ledger/receipt.
6. Keep sandbox as default on local/dev.

## What stays the same for users today

With `PAYMENTS_MODE=sandbox` (default), package pay and job complete still succeed immediately — existing expert earnings and asker receipt flows keep working while you finish merchant applications.

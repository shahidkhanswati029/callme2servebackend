# Fix: `Environment variable not found: DATABASE_URL`

Your API **build** can succeed while **start** crashes if Postgres is not linked.

## Exact steps (Railway dashboard)

1. Open your Railway **project**.
2. If you do **not** already have Postgres:
   - **+ New** → **Database** → **PostgreSQL**
   - Wait until it shows **Online**.
3. Open your **backend / API** service (the GitHub `callme2servebackend` service).
4. Go to **Variables**.
5. Click **+ New Variable** → **Add Reference** (or Shared Variable / Variable Reference).
6. Choose the **PostgreSQL** service → select **`DATABASE_URL`**.
7. Save. You should see something like:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (reference syntax may vary slightly in UI)
8. Also set these on the **same API service** (Raw values, not references):

| Variable | Value |
|----------|--------|
| `NODE_ENV` | `production` |
| `JWT_ACCESS_SECRET` | long random string (32+) |
| `JWT_REFRESH_SECRET` | different long random string |
| `CORS_ORIGIN` | your frontend Railway URL (`https://….up.railway.app`) |
| `COOKIE_SECURE` | `true` |
| `DESK_ADMIN_EMAIL` | `maaali615@gmail.com` |
| `WEBAUTHN_RP_NAME` | `CallMe2Serve` |
| `WEBAUTHN_RP_ID` | frontend host only (no `https://`) |
| `PAYMENTS_MODE` | `sandbox` |

9. **Redeploy** the API service (Deployments → Redeploy).
10. Open `https://YOUR-API-URL/api/health` — should return OK.

## Do not

- Put `.env` from your laptop into Railway with `localhost` Postgres.
- Leave `DATABASE_URL` empty hoping Prisma will invent a DB.
- Put `DATABASE_URL` only on the Postgres service — the **API service** must have it too (via reference).

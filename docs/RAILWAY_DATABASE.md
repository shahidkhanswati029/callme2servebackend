# Railway Postgres: `P1001 Can't reach database server at postgres.railway.internal`

`DATABASE_URL` is present, but the API cannot open a TCP connection to Postgres.

## Checklist (do in order)

### 1. Same project
- API service and PostgreSQL must be in **one** Railway project.
- If Postgres is in another project, private host `*.railway.internal` will never work.

### 2. Postgres is Online
- Open the **Postgres** service.
- Status must be **Online**.
- If it is provisioning, wait. If crashed, click Restart.

### 3. Correct variable on the API
- Open **API** → **Variables**.
- `DATABASE_URL` should be added via **Add Reference** → your Postgres → `DATABASE_URL`.
- Delete any manual/local `DATABASE_URL` you typed yourself.

### 4. Same environment
- Project may have `production` / `staging`.
- API and Postgres must share the **same environment**.

### 5. Fallback: public URL (quick test)
If private networking still fails:

1. Postgres → **Variables** → copy **`DATABASE_PUBLIC_URL`** (or “Public Network” connection URL).
2. API → **Variables** → set `DATABASE_URL` to that **public** value (paste raw, not reference).
3. Redeploy API.

If public URL works but private does not, keep services in the same project and switch back to the private reference later.

### 6. Redeploy
After fixing variables / Postgres status → **Redeploy** the API (do not only restart an old broken deploy).

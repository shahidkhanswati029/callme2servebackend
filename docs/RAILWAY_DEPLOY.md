# CallMe2Serve — GitHub + Railway deploy

Two services: **API** (`callmetoservebackend1.0`) and **Web** (`callmetoservefrontend1.0`). Plan rule: one Node API process with Socket.io (no Redis).

## 1. Push both repos to GitHub

### Backend (new git repo)

```powershell
cd D:\trendtommy\callmetoservebackend1.0
git init
git add .
git commit -m "Initial CallMe2Serve API for Railway"
# Create empty repo on GitHub, then:
git branch -M main
git remote add origin https://github.com/<YOU>/callme2serve-api.git
git push -u origin main
```

### Frontend (already a git repo)

```powershell
cd D:\trendtommy\callmetoservefrontend1.0
git add .
git commit -m "CallMe2Serve frontend ready for Railway"
git branch -M main
git remote add origin https://github.com/<YOU>/callme2serve-web.git
git push -u origin main
```

Install [GitHub CLI](https://cli.github.com/) if you want `gh repo create` instead of the website.

## 2. Railway project

1. [railway.app](https://railway.app) → New Project.
2. Add **PostgreSQL** (Railway plugin). Copy `DATABASE_URL`.
3. Add service from **GitHub** → `callme2serve-api`.
4. Add service from **GitHub** → `callme2serve-web`.
5. Optionally add a custom domain on each service.

## 3. Backend variables (API service)

| Variable | Example / note |
|----------|----------------|
| `DATABASE_URL` | From Railway Postgres (Reference variable) |
| `PORT` | Railway sets this — do not hardcode |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | Your web URL, e.g. `https://callme2serve-web.up.railway.app` (comma-separate if multiple) |
| `JWT_ACCESS_SECRET` | Long random string (≥32 chars) |
| `JWT_REFRESH_SECRET` | Different long random string |
| `COOKIE_SECURE` | `true` |
| `DESK_ADMIN_EMAIL` | `maaali615@gmail.com` |
| `WEBAUTHN_RP_ID` | Your frontend hostname (no `https://`) |
| `WEBAUTHN_RP_NAME` | `CallMe2Serve` |
| `GOOGLE_CLIENT_ID` | From Google Cloud console |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Optional |
| `CLOUDINARY_*` | Cloud name, key, secret |
| `PAYMENTS_MODE` | `sandbox` until merchant keys are live |
| `FIREBASE_*` | Optional push; leave empty to use sockets only |

Start command (already in `railway.toml`): `npm run start:migrate` → `prisma db push` then `node dist/server.js`.

Health: `GET /api/health`.

## 4. Frontend variables (Web service)

| Variable | Example / note |
|----------|----------------|
| `PORT` | Railway sets this |
| `NEXT_PUBLIC_API_URL` | Backend public URL, e.g. `https://callme2serve-api.up.railway.app` |
| `NEXT_PUBLIC_SITE_URL` | Frontend public URL |
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Mapbox token (restrict to your domain) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same Google client as API |
| `NEXT_PUBLIC_FIREBASE_*` | Optional FCM |

`next.config.ts` uses `output: "standalone"` for smaller Railway images.

## 5. After deploy checklist

1. Open web URL → landing loads.
2. Open `API_URL/api/health` → OK.
3. Desk login as `maaali615@gmail.com` → `/desk/contacts` shows Contact/Complaint detail.
4. Submit `/contact` → appears in desk inbox with full message.
5. Socket chat works only if web and API origins are in `CORS_ORIGIN` and you use the public API host for Socket.io.

## 6. What not to commit

`.env`, keys, `node_modules`, `.next`, `dist`, certificates — covered by each repo’s `.gitignore`.

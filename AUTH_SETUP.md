# CallMeToServe — Authentication setup

Module-wise identity room only (Steps 1–4 from the development plan).

## Backend module map

```
src/
  modules/
    identity/     ← auth room (register, login, Google, Facebook, JWT, biometrics flags)
    health/       ← health check
  shared/         ← db, errors, tokens, password helpers
  config/         ← env validation
```

Other rooms (profile, shops, jobs…) must **not** read `accounts` directly. They will call identity doors later.

## 1. PostgreSQL

1. Open pgAdmin or `psql` and create the database:

```sql
CREATE DATABASE callmetoserve;
```

2. Copy env and set your real postgres password:

```bash
cd callmetoservebackend1.0
copy .env.example .env
```

Edit `.env`:

```
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/callmetoserve?schema=public"
JWT_ACCESS_SECRET=pick-a-long-random-string-at-least-32
JWT_REFRESH_SECRET=another-long-random-string-at-least-32
CORS_ORIGIN=http://localhost:3000
PORT=4000
```

3. Install and migrate:

```bash
npm install
npx prisma db push
npm run db:seed
npm run dev
```

Health check: `http://localhost:4000/api/health`

### Seed accounts (for testing)

| Seat   | Email                            | Password      |
|--------|----------------------------------|---------------|
| Expert | `adeel@raza.example`             | `Password123!` |
| Desk   | `noor@desk.callmetoserve.example`| `Password123!` |

## 2. Identity API doors

| Method | Path                         | Auth   | Purpose                          |
|--------|------------------------------|--------|----------------------------------|
| POST   | `/api/identity/register`     | No     | Expert email/password signup     |
| POST   | `/api/identity/login`        | No     | Expert email/password login      |
| POST   | `/api/identity/desk/login`   | No     | Desk email/password login        |
| POST   | `/api/identity/refresh`      | No     | Rotate access via refresh token  |
| POST   | `/api/identity/logout`       | Bearer | Clear refresh token              |
| GET    | `/api/identity/me`           | Bearer | Current account                  |
| POST   | `/api/identity/google`       | No     | Body: `{ "idToken": "..." }`     |
| POST   | `/api/identity/facebook`     | No     | Body: `{ "accessToken": "..." }` |
| PATCH  | `/api/identity/biometrics`   | Bearer | Mark fingerprint/face enrolled   |

Register body example:

```json
{
  "name": "Sana Malik",
  "email": "sana@maliq.example",
  "password": "Password123!",
  "phone": "+92 300 555 0199",
  "city": "Sialkot",
  "work": "Leather jackets",
  "languages": ["Urdu", "English"]
}
```

Response always includes short-lived `accessToken` + longer `refreshToken` (JWT access, opaque refresh).

## 3. Google Sign-In (optional for first test)

Email/password works without this. For Google:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a project (or use one).
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Authorized JavaScript origins: `http://localhost:3000`
5. Authorized redirect URIs: `http://localhost:3000` (and `/` if asked).
6. Copy the **Client ID** into backend `.env` as `GOOGLE_CLIENT_ID=...`
7. Put the **same Client ID** in frontend `.env.local` as `NEXT_PUBLIC_GOOGLE_CLIENT_ID=...`
8. Restart both servers.

Frontend sends Google’s `idToken` to `POST /api/identity/google`. Same email merges into one expert account.

## 4. Facebook Login (optional for first test)

1. [Meta for Developers](https://developers.facebook.com/) → Create App → type **Consumer** / authenticate.
2. Add product **Facebook Login** → Web.
3. Valid OAuth Redirect URIs: `http://localhost:3000/`
4. App settings → Basic: copy **App ID** and **App Secret**.
5. Backend `.env`:

```
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
```

6. Frontend `.env.local`:

```
NEXT_PUBLIC_FACEBOOK_APP_ID=...
```

7. In Facebook Login settings, request the `email` permission (required — we link accounts by email).

## 5. Frontend env

```bash
cd callmetoservefrontend1.0
copy .env.example .env.local
npm install
npm run dev
```

`.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
NEXT_PUBLIC_FACEBOOK_APP_ID=
```

Open `http://localhost:3000` → Welcome → Register / Expert sign-in / Desk sign-in.

## Rules already enforced

- Expert and desk are separate seats; desk cannot use Google/Facebook.
- Password is stored as bcrypt hash only.
- Google/Facebook/email with the same email stay **one** account.
- Biometrics flags are stored; raw fingerprint/face images are **not** stored.
- Access JWT is short-lived; refresh token is rotated on use.

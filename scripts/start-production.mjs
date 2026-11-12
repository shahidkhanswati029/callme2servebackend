/**
 * Railway / production entry.
 * Builds a valid DATABASE_URL from discrete PG* vars when needed,
 * then prisma db push + start API.
 */
import { spawnSync } from "node:child_process";

function fail(message) {
  console.error("\n========== CallMe2Serve API startup failed ==========");
  console.error(message);
  console.error("=====================================================\n");
  process.exit(1);
}

function sleep(ms) {
  spawnSync(process.execPath, ["-e", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms})`], {
    stdio: "ignore",
  });
}

function redactUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "(unparseable URL)";
  }
}

function looksLikeTemplate(value) {
  return /\$\{\{|\}\}/.test(String(value || ""));
}

function validateDatabaseUrl(raw) {
  const url = String(raw || "").trim();
  if (!url) return "DATABASE_URL is empty.";
  if (looksLikeTemplate(url)) {
    return "DATABASE_URL still contains unresolved ${{ }} template parts.";
  }
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    return "DATABASE_URL must start with postgresql:// or postgres://";
  }
  try {
    const u = new URL(url);
    if (!u.hostname) return "DATABASE_URL has an empty host.";
    return null;
  } catch {
    return "DATABASE_URL could not be parsed. URL-encode special password characters.";
  }
}

function buildUrlFromParts() {
  const user = String(process.env.PGUSER || process.env.POSTGRES_USER || "").trim();
  const password = String(process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || "").trim();
  const host = String(
    process.env.RAILWAY_TCP_PROXY_DOMAIN ||
      process.env.PGHOST_PUBLIC ||
      process.env.PGHOST ||
      "",
  ).trim();
  const port = String(
    process.env.RAILWAY_TCP_PROXY_PORT || process.env.PGPORT || "5432",
  ).trim();
  const database = String(
    process.env.PGDATABASE || process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE || "railway",
  ).trim();

  if (!user || !password || !host) return null;
  if (looksLikeTemplate(user) || looksLikeTemplate(password) || looksLikeTemplate(host)) {
    return null;
  }
  // Prefer public proxy host when available.
  if (host.includes("railway.internal") && !process.env.RAILWAY_TCP_PROXY_DOMAIN) {
    console.warn("PGHOST is private (*.railway.internal). Prefer RAILWAY_TCP_PROXY_DOMAIN.");
  }

  const encUser = encodeURIComponent(user);
  const encPass = encodeURIComponent(password);
  return `postgresql://${encUser}:${encPass}@${host}:${port}/${encodeURIComponent(database)}`;
}

function runPrismaPush() {
  return spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
}

function tryPushWithRetries(label, attempts) {
  console.log(`Syncing Prisma schema via ${label}…`);
  console.log(`Using ${redactUrl(process.env.DATABASE_URL)}`);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    console.log(`prisma db push attempt ${attempt}/${attempts}…`);
    const push = runPrismaPush();
    if (push.status === 0) return true;
    if (attempt < attempts) {
      console.warn("Database not ready / rejected. Waiting 5s…");
      sleep(5000);
    }
  }
  return false;
}

for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) {
  if (!String(process.env[key] || "").trim()) {
    fail(`Missing required environment variable: ${key}`);
  }
}

const candidates = [];

// 1) Explicit public URL
const publicUrl = String(process.env.DATABASE_PUBLIC_URL || "").trim();
if (publicUrl && !validateDatabaseUrl(publicUrl)) {
  candidates.push({ label: "DATABASE_PUBLIC_URL", url: publicUrl });
}

// 2) Built from discrete PG* / proxy vars (best for users who linked each field)
const built = buildUrlFromParts();
if (built && !validateDatabaseUrl(built)) {
  candidates.push({ label: "built from PGUSER/PGPASSWORD/HOST/PORT", url: built });
}

// 3) DATABASE_URL as provided
const rawUrl = String(process.env.DATABASE_URL || "").trim();
if (rawUrl && !validateDatabaseUrl(rawUrl)) {
  candidates.push({ label: "DATABASE_URL", url: rawUrl });
}

if (candidates.length === 0) {
  fail(
    [
      "No valid database connection URL could be built.",
      "",
      "On Railway → API service → Variables, do ONE of these:",
      "",
      "A) Set DATABASE_URL to a Variable Reference:",
      "   ${{Postgres.DATABASE_PUBLIC_URL}}",
      "   (use your exact Postgres service name)",
      "",
      "B) Or Add References for these from Postgres, then redeploy:",
      "   PGUSER, PGPASSWORD, RAILWAY_TCP_PROXY_DOMAIN, RAILWAY_TCP_PROXY_PORT, POSTGRES_DB",
      "",
      "C) Or paste ONE full public URL (no ${{ }} wrappers around password/username):",
      "   postgresql://postgres:PASSWORD@HOST.proxy.rlwy.net:PORT/railway",
      "",
      "Wrong (causes empty host):",
      "   postgresql://${{postgres}}:${{MyPassword}}@${{RAILWAY_TCP_PROXY_DOMAIN}}...",
    ].join("\n"),
  );
}

let ok = false;
for (const candidate of candidates) {
  process.env.DATABASE_URL = candidate.url;
  console.log(`Trying ${candidate.label}…`);
  if (tryPushWithRetries(candidate.label, 5)) {
    ok = true;
    break;
  }
}

if (!ok) {
  fail(
    [
      "Could not reach Postgres with any candidate URL.",
      "Confirm Postgres is Online, then use DATABASE_PUBLIC_URL / proxy host.",
      `Last tried: ${redactUrl(process.env.DATABASE_URL)}`,
    ].join("\n"),
  );
}

console.log("Schema synced. Starting API on 0.0.0.0…");
const server = spawnSync("node", ["dist/server.js"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});
process.exit(server.status ?? 1);

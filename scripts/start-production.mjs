/**
 * Railway / production entry:
 * Validate DATABASE_URL, prefer public URL when valid, prisma db push, start API.
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

/** Returns null if OK, otherwise an error string. Never logs secrets. */
function validateDatabaseUrl(raw) {
  const url = String(raw || "").trim();
  if (!url) return "DATABASE_URL is empty.";
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    return "DATABASE_URL must start with postgresql:// or postgres://";
  }
  // Common Railway mistake: pasted variable name or broken reference
  if (url.includes("${{") || url.includes("PGHOST") || url === "DATABASE_URL") {
    return "DATABASE_URL looks like a template/name, not a real connection string.";
  }
  try {
    const u = new URL(url);
    if (!u.hostname) {
      return "DATABASE_URL has an empty host. Example: postgresql://USER:PASSWORD@HOST:PORT/DATABASE";
    }
    if (u.hostname === "postgres.railway.internal") {
      // allowed but warn — caller may prefer public
      return null;
    }
    return null;
  } catch {
    return "DATABASE_URL could not be parsed. If the password has @ # % etc, URL-encode it.";
  }
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
      console.warn("Database not ready / URL rejected. Waiting 5s…");
      sleep(5000);
    }
  }
  return false;
}

const required = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
const missing = required.filter((key) => !String(process.env[key] || "").trim());
if (missing.length > 0) {
  fail(`Missing required environment variable(s): ${missing.join(", ")}`);
}

const publicUrl = String(process.env.DATABASE_PUBLIC_URL || "").trim();
const privateUrl = String(process.env.DATABASE_URL || "").trim();

// Prefer public URL only if it is a valid non-empty host URL.
let chosen = privateUrl;
let label = "DATABASE_URL";
if (publicUrl) {
  const publicErr = validateDatabaseUrl(publicUrl);
  if (!publicErr) {
    chosen = publicUrl;
    label = "DATABASE_PUBLIC_URL";
  } else {
    console.warn(`Ignoring DATABASE_PUBLIC_URL: ${publicErr}`);
  }
}

const chosenErr = validateDatabaseUrl(chosen);
if (chosenErr) {
  fail(
    [
      chosenErr,
      "",
      "Fix on Railway → API service → Variables:",
      "1) Delete broken DATABASE_URL / DATABASE_PUBLIC_URL",
      "2) Postgres → Connect → copy the Public URL (must include a host like *.proxy.rlwy.net)",
      "3) Paste that FULL string as API DATABASE_URL (raw value)",
      "4) Valid shape:",
      "   postgresql://postgres:PASSWORD@HOST.proxy.rlwy.net:PORT/railway",
      "5) If password contains @ # % & etc, URL-encode those characters",
      "6) Redeploy API",
    ].join("\n"),
  );
}

process.env.DATABASE_URL = chosen;
let ok = tryPushWithRetries(label, 8);

if (!ok && publicUrl && chosen !== privateUrl) {
  const privateErr = validateDatabaseUrl(privateUrl);
  if (!privateErr) {
    console.warn("Public URL failed; trying DATABASE_URL…");
    process.env.DATABASE_URL = privateUrl;
    ok = tryPushWithRetries("DATABASE_URL", 4);
  }
}

if (!ok) {
  fail(
    [
      "Could not sync database.",
      "If you see P1013: DATABASE_URL is invalid (empty host / bad paste).",
      "If you see P1001: host is unreachable (use public *.proxy.rlwy.net URL).",
      "Paste the FULL public connection string into API DATABASE_URL, then redeploy.",
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

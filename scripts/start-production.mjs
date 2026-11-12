/**
 * Railway / production entry:
 * Prefer DATABASE_PUBLIC_URL when present (avoids broken *.railway.internal DNS),
 * then prisma db push with retries, then start API.
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

function runPrismaPush() {
  return spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
}

function tryPushWithRetries(label, attempts) {
  console.log(`Syncing Prisma schema via ${label}…`);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    console.log(`prisma db push attempt ${attempt}/${attempts}…`);
    const push = runPrismaPush();
    if (push.status === 0) return true;
    if (attempt < attempts) {
      console.warn("Database not reachable yet. Waiting 5s…");
      sleep(5000);
    }
  }
  return false;
}

const required = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
const missing = required.filter((key) => !String(process.env[key] || "").trim());

if (missing.length > 0) {
  fail(
    [
      `Missing required environment variable(s): ${missing.join(", ")}`,
      "",
      "Railway API service → Variables:",
      "- Add Reference: Postgres DATABASE_URL",
      "- Add Reference: Postgres DATABASE_PUBLIC_URL  (required if private DNS fails)",
      "- JWT_ACCESS_SECRET / JWT_REFRESH_SECRET",
    ].join("\n"),
  );
}

// Prefer public URL when available — private host often fails until networking is perfect.
const publicUrl = String(process.env.DATABASE_PUBLIC_URL || "").trim();
const privateUrl = String(process.env.DATABASE_URL || "").trim();

if (publicUrl) {
  console.log("Using DATABASE_PUBLIC_URL (recommended on Railway when private DNS fails).");
  process.env.DATABASE_URL = publicUrl;
} else if (privateUrl.includes("railway.internal")) {
  console.warn(
    "DATABASE_URL uses *.railway.internal and DATABASE_PUBLIC_URL is not set.",
  );
  console.warn(
    "Add Reference DATABASE_PUBLIC_URL on the API service, or paste the public URL into DATABASE_URL.",
  );
}

let ok = tryPushWithRetries(publicUrl ? "DATABASE_PUBLIC_URL" : "DATABASE_URL", 10);

if (!ok && publicUrl && privateUrl && privateUrl !== publicUrl) {
  console.warn("Public URL failed; trying original DATABASE_URL…");
  process.env.DATABASE_URL = privateUrl;
  ok = tryPushWithRetries("DATABASE_URL", 4);
}

if (!ok) {
  fail(
    [
      "Cannot reach Postgres (P1001).",
      "",
      "Do exactly this:",
      "1) Postgres service → Variables → copy DATABASE_PUBLIC_URL",
      "2) API service → Variables → set DATABASE_URL = that copied public URL (paste raw)",
      "3) Also add DATABASE_PUBLIC_URL reference if you want",
      "4) Confirm Postgres is Online",
      "5) Redeploy API",
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

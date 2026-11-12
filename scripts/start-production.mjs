/**
 * Railway / production entry:
 * 1) Validate required env
 * 2) prisma db push (retries + optional public URL fallback)
 * 3) start Express on 0.0.0.0
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
      "On Railway:",
      "1) Same project → + New → Database → PostgreSQL",
      "2) API service → Variables → Add Reference → Postgres → DATABASE_URL",
      "3) Also Add Reference → DATABASE_PUBLIC_URL (recommended fallback)",
      "4) Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET",
      "5) Redeploy API",
    ].join("\n"),
  );
}

console.log("DATABASE_URL is set.");
if (String(process.env.DATABASE_URL).includes("railway.internal")) {
  console.log("Private host detected (*.railway.internal).");
}

let ok = tryPushWithRetries("DATABASE_URL", 8);

// Railway private DNS sometimes fails; public URL works across the edge.
if (!ok && process.env.DATABASE_PUBLIC_URL) {
  console.warn("Private DATABASE_URL failed. Falling back to DATABASE_PUBLIC_URL…");
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
  ok = tryPushWithRetries("DATABASE_PUBLIC_URL", 6);
}

if (!ok) {
  fail(
    [
      "Cannot reach Postgres (P1001).",
      "",
      "Do this in Railway:",
      "1) Postgres service must be Online in the SAME project as the API.",
      "2) API Variables → Add Reference for BOTH:",
      "   - DATABASE_URL",
      "   - DATABASE_PUBLIC_URL",
      "3) Or paste Postgres DATABASE_PUBLIC_URL into API DATABASE_URL as a raw value.",
      "4) Redeploy the API.",
      "",
      "Until the DB is reachable, Railway will show 'Application failed to respond' / 502.",
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

/**
 * Railway / production entry:
 * 1) Validate required env
 * 2) prisma db push (with retries — Postgres may not be ready yet)
 * 3) start Express
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
      "3) Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET",
      "4) Redeploy API",
    ].join("\n"),
  );
}

const dbUrl = String(process.env.DATABASE_URL);
console.log("DATABASE_URL is set.");
if (dbUrl.includes("railway.internal")) {
  console.log("Using Railway private host (*.railway.internal). API and Postgres must be in the SAME project.");
}

console.log("Syncing Prisma schema (retries if DB is still starting)…");

const maxAttempts = 12;
let pushed = false;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  console.log(`prisma db push attempt ${attempt}/${maxAttempts}…`);
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
  if (push.status === 0) {
    pushed = true;
    break;
  }
  if (attempt < maxAttempts) {
    console.warn("Database not reachable yet. Waiting 5s…");
    sleep(5000);
  }
}

if (!pushed) {
  fail(
    [
      "prisma db push failed after retries (P1001 = cannot reach Postgres).",
      "",
      "Fix in Railway dashboard:",
      "1) Open Postgres service → confirm status is Online (not Provisioning / Crashed).",
      "2) API + Postgres must be in the SAME Railway project AND same environment.",
      "3) API Variables → DATABASE_URL must be a Reference to that Postgres service",
      "   (not a copied localhost URL, not a URL from another project).",
      "4) If private networking fails, temporarily set DATABASE_URL to the Postgres",
      "   public URL (Postgres → Variables → DATABASE_PUBLIC_URL), then redeploy.",
      "5) Settings → restart Postgres, then Redeploy the API.",
    ].join("\n"),
  );
}

console.log("Schema synced. Starting API…");
const server = spawnSync("node", ["dist/server.js"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

process.exit(server.status ?? 1);

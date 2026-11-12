/**
 * Railway / production entry:
 * 1) Validate required env (clear message if missing)
 * 2) prisma db push
 * 3) start Express
 */
import { spawnSync } from "node:child_process";

function fail(message) {
  console.error("\n========== CallMe2Serve API startup failed ==========");
  console.error(message);
  console.error("=====================================================\n");
  process.exit(1);
}

const required = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
const missing = required.filter((key) => !String(process.env[key] || "").trim());

if (missing.length > 0) {
  fail(
    [
      `Missing required environment variable(s): ${missing.join(", ")}`,
      "",
      "On Railway:",
      "1) Project → + New → Database → PostgreSQL (if you do not have one)",
      "2) Open your API service → Variables",
      "3) Add Variable → Add Reference → select Postgres → DATABASE_URL",
      "4) Also set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (32+ random chars)",
      "5) Redeploy the API service",
      "",
      "Do NOT paste a localhost DATABASE_URL. Use Railway's Postgres reference.",
    ].join("\n"),
  );
}

console.log("DATABASE_URL is set. Syncing Prisma schema…");
const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

if (push.status !== 0) {
  fail(
    [
      "prisma db push failed.",
      "Check that DATABASE_URL points to the Railway Postgres service",
      "and that the database is online.",
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

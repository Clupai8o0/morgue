import type { Config } from "drizzle-kit";

// drizzle-kit runs outside Next, so nothing has loaded .env.local for it.
// Node 20.6+ can do this natively — no dotenv dependency needed.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Absent in CI and on first run; DATABASE_URL may come from the real
  // environment instead.
}

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
} satisfies Config;

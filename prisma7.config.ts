import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = new URL(
  process.env.DATABASE_URL ||
    "postgresql://debtaware:replace-this-local-password@localhost:5432/debtaware",
);
if (process.env.NODE_ENV === "production") {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production.");
  }
  if (process.env.DATABASE_SSL !== "true") {
    throw new Error("DATABASE_SSL=true is required in production.");
  }
  if (!process.env.WEB_ORIGIN?.startsWith("https://")) {
    throw new Error("An HTTPS WEB_ORIGIN is required in production.");
  }
  databaseUrl.searchParams.set("sslmode", "verify-full");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl.toString() },
});

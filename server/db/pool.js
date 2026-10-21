import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to start the API.");
}

const databaseUrl = new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV === "production") {
  if (process.env.DATABASE_SSL !== "true") {
    throw new Error("DATABASE_SSL=true is required in production.");
  }
  if (!process.env.WEB_ORIGIN?.startsWith("https://")) {
    throw new Error("An HTTPS WEB_ORIGIN is required in production.");
  }
  databaseUrl.searchParams.set("sslmode", "verify-full");
}
const adapter = new PrismaPg({
  connectionString: databaseUrl.toString(),
  max: Number(process.env.DATABASE_CONNECTION_LIMIT || 10),
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

export const prisma = new PrismaClient({ adapter });

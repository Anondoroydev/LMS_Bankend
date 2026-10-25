import "dotenv/config";
import { prisma } from "./config/database.js";
import { app } from "./app.js";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 characters");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be configured");
}
const jwtExpiresInSeconds = Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 3600);
if (!Number.isSafeInteger(jwtExpiresInSeconds) || jwtExpiresInSeconds < 60) {
  throw new Error("JWT_EXPIRES_IN_SECONDS must be an integer of at least 60");
}

const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port);

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

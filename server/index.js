import { createApp } from "./app.js";
import { prisma } from "./db/pool.js";

const port = Number(process.env.API_PORT || 4000);
const app = createApp({ prisma });

await prisma.$connect();
await prisma.$queryRaw`SELECT 1`;
const pruneExpiredSessions = () =>
  prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
await pruneExpiredSessions();
const maintenanceTimer = setInterval(() => {
  pruneExpiredSessions().catch(() => {
    process.stderr.write("Session maintenance did not complete.\n");
  });
}, 24 * 60 * 60 * 1000);
maintenanceTimer.unref();
const server = app.listen(port, () => {
  process.stdout.write(`DebtAware API listening on port ${port}.\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(maintenanceTimer);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}

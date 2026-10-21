import { createApp } from "./app.js";
import { pool } from "./db/pool.js";

const port = Number(process.env.API_PORT || 4000);
const app = createApp({ pool });

await pool.query("SELECT 1");
const server = app.listen(port, () => {
  process.stdout.write(`DebtAware API listening on port ${port}.\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";
import { getIntegrationStatus } from "./providers/status.js";

async function withServer(
  run,
  pool = {
    async query() {
      return { rowCount: 0, rows: [] };
    },
  },
) {
  const server = createApp({ pool }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("API exposes a database-backed health response", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("private routes require an authenticated session", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/overview`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "Sign in to continue.",
    });
  });
});

test("registration rejects weak passwords and missing privacy consent", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "person@example.com",
        password: "weak",
        privacyConsent: false,
      }),
    });
    assert.equal(response.status, 400);
  });
});

test("cookie-authenticated mutations reject untrusted browser origins", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/auth/register`, {
      method: "POST",
      headers: {
        origin: "https://untrusted.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "person@example.com",
        password: "A-long-passphrase-123",
        privacyConsent: true,
      }),
    });
    assert.equal(response.status, 403);
  });
});

test("unknown accounts cannot authenticate with the dummy hash password", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "missing@example.com",
        password: "a-random-password-for-login-timing-equalization",
      }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "Invalid email or password.",
    });
  });
});

test("unconfigured provider integrations are reported honestly", () => {
  const status = getIntegrationStatus();
  assert.equal(status.openBanking.status, "not_configured");
  assert.equal(status.lenderDirectory.partnerCount, 0);
  assert.equal(status.coaching.externalLlmEnabled, false);
});

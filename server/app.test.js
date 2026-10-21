import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "./app.js";
import { getIntegrationStatus } from "./providers/status.js";

async function withServer(run, overrides = {}) {
  const prisma = {
    async $queryRaw() {
      return [{ "?column?": 1 }];
    },
    session: {
      async findFirst() {
        return null;
      },
      async deleteMany() {
        return { count: 0 };
      },
    },
    user: {
      async findUnique() {
        return null;
      },
    },
    ...overrides,
  };
  const server = createApp({ prisma }).listen(0);
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

test("registration rejects weak passwords and missing privacy acknowledgement", async () => {
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

test("logout is safe to retry when a session is already absent", async () => {
  await withServer(async (origin) => {
    const first = await fetch(`${origin}/auth/logout`, { method: "POST" });
    const second = await fetch(`${origin}/auth/logout`, { method: "POST" });
    assert.equal(first.status, 204);
    assert.equal(second.status, 204);
  });
});

test("payment retries with the same key do not reduce debt twice", async () => {
  const userId = randomUUID();
  const debtId = randomUUID();
  let balance = 1000;
  const payments = [];
  const findPayment = (where) =>
    payments.find(
      (payment) =>
        payment.userId === where.userId_idempotencyKey.userId &&
        payment.idempotencyKey ===
          where.userId_idempotencyKey.idempotencyKey,
    ) || null;
  const prisma = {
    session: {
      async findFirst() {
        return { user: { id: userId, email: "person@example.com" } };
      },
    },
    payment: {
      findUnique: async ({ where }) => findPayment(where),
    },
    async $transaction(run) {
      return run({
        async $queryRaw() {
          return [{ balance }];
        },
        debtAccount: {
          async update({ data }) {
            balance = Number(data.balance);
          },
        },
        payment: {
          async create({ data }) {
            const existing = payments.find(
              (payment) =>
                payment.userId === data.userId &&
                payment.idempotencyKey === data.idempotencyKey,
            );
            if (existing) {
              const error = new Error("Unique constraint failed");
              error.code = "P2002";
              throw error;
            }
            const payment = {
              id: randomUUID(),
              ...data,
              debtAccount: { name: "Vehicle loan" },
              createdAt: new Date(),
            };
            payments.push(payment);
            return payment;
          },
        },
      });
    },
  };

  await withServer(async (origin) => {
    const sendPayment = (amount) =>
      fetch(`${origin}/api/payments`, {
        method: "POST",
        headers: {
          authorization: "Bearer session-token",
          "content-type": "application/json",
          "idempotency-key": "payment-retry-0001",
        },
        body: JSON.stringify({
          debtAccountId: debtId,
          amount,
          note: "Extra payment",
        }),
      });
    const first = await sendPayment(120);
    const replay = await sendPayment(120);
    const conflict = await sendPayment(150);

    assert.equal(first.status, 201);
    assert.equal(replay.status, 200);
    assert.equal(conflict.status, 409);
    assert.equal(balance, 880);
    assert.equal(payments.length, 1);
  }, prisma);
});

test("resource creation requires a client idempotency key", async () => {
  const prisma = {
    session: {
      async findFirst() {
        return { user: { id: randomUUID(), email: "person@example.com" } };
      },
    },
  };
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/debts`, {
      method: "POST",
      headers: {
        authorization: "Bearer session-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Card",
        debtType: "credit_card",
        balance: 1000,
        monthlyPayment: 100,
        annualRate: 20,
      }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Invalid request/);
  }, prisma);
});

test("optional consent withdrawal can be retried safely", async () => {
  const userId = randomUUID();
  let active = true;
  const prisma = {
    session: {
      async findFirst() {
        return { user: { id: userId, email: "person@example.com" } };
      },
    },
    consentRecord: {
      async updateMany() {
        if (!active) return { count: 0 };
        active = false;
        return { count: 1 };
      },
    },
  };
  await withServer(async (origin) => {
    const withdraw = () =>
      fetch(`${origin}/api/consents/withdraw`, {
        method: "POST",
        headers: {
          authorization: "Bearer session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ consentType: "ai_processing" }),
      });
    assert.equal((await withdraw()).status, 204);
    assert.equal((await withdraw()).status, 204);
    assert.equal(active, false);
  }, prisma);
});

test("unconfigured provider integrations are reported honestly", () => {
  const status = getIntegrationStatus();
  assert.equal(status.openBanking.status, "not_configured");
  assert.equal(status.lenderDirectory.partnerCount, 0);
  assert.equal(status.coaching.externalLlmEnabled, false);
});

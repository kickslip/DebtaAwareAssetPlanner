import test from "node:test";
import assert from "node:assert/strict";
import {
  createIdempotently,
  requestFingerprint,
} from "./idempotency.js";

test("request fingerprints ignore object key order", () => {
  assert.equal(
    requestFingerprint({ amount: 42, note: "monthly" }),
    requestFingerprint({ note: "monthly", amount: 42 }),
  );
});

test("replays the original create result without creating it again", async () => {
  let record = null;
  let committedCreates = 0;
  const fingerprint = requestFingerprint({ amount: 42 });
  const options = {
    fingerprint,
    findExisting: async () => record,
    create: async () => {
      record = { id: "payment-1", requestHash: fingerprint };
      committedCreates += 1;
      return record;
    },
  };

  const first = await createIdempotently(options);
  const replay = await createIdempotently(options);

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.id, "payment-1");
  assert.equal(committedCreates, 1);
});

test("concurrent retries commit only one create", async () => {
  let record = null;
  let committedCreates = 0;
  const fingerprint = requestFingerprint({ amount: 42 });
  const options = {
    fingerprint,
    findExisting: async () => record,
    create: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (record) {
        const error = new Error("Unique constraint failed");
        error.code = "P2002";
        throw error;
      }
      record = { id: "payment-1", requestHash: fingerprint };
      committedCreates += 1;
      return record;
    },
  };

  const results = await Promise.all([
    createIdempotently(options),
    createIdempotently(options),
  ]);

  assert.equal(committedCreates, 1);
  assert.deepEqual(
    results.map((result) => result.record.id),
    ["payment-1", "payment-1"],
  );
});

test("rejects reusing a key with a different normalized payload", async () => {
  const record = { requestHash: requestFingerprint({ amount: 42 }) };
  await assert.rejects(
    createIdempotently({
      fingerprint: requestFingerprint({ amount: 99 }),
      findExisting: async () => record,
      create: async () => assert.fail("should not create a conflicting replay"),
    }),
    { status: 409 },
  );
});

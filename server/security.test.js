import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  readSessionToken,
  verifyPassword,
} from "./security.js";

test("password hashes are salted and verify only the original password", async () => {
  const first = await hashPassword("A-long-passphrase-123");
  const second = await hashPassword("A-long-passphrase-123");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("A-long-passphrase-123", first), true);
  assert.equal(await verifyPassword("not-the-password", first), false);
});

test("session tokens are random and only their hashes are stored", () => {
  const first = createSessionToken();
  const second = createSessionToken();
  assert.equal(first.length, 43);
  assert.notEqual(first, second);
  assert.equal(hashSessionToken(first).length, 64);
  assert.notEqual(hashSessionToken(first), first);
});

test("reads bearer tokens and cookies without accepting malformed cookies", () => {
  const request = (headers) => ({
    get(name) {
      return headers[name.toLowerCase()] || "";
    },
  });
  assert.equal(
    readSessionToken(request({ authorization: "Bearer abc123" })),
    "abc123",
  );
  assert.equal(
    readSessionToken(
      request({ cookie: "other=value; debtaware_session=token-value" }),
    ),
    "token-value",
  );
  assert.equal(
    readSessionToken(request({ cookie: "debtaware_session=%E0%A4%A" })),
    null,
  );
});

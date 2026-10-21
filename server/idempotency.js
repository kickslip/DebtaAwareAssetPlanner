import { createHash } from "node:crypto";

export class IdempotencyConflictError extends Error {
  constructor() {
    super("This idempotency key was already used for a different request.");
    this.status = 409;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function requestFingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function replay(existing, fingerprint) {
  if (existing.requestHash !== fingerprint) {
    throw new IdempotencyConflictError();
  }
  return { record: existing, replayed: true };
}

export async function createIdempotently({
  findExisting,
  create,
  fingerprint,
}) {
  const existing = await findExisting();
  if (existing) return replay(existing, fingerprint);

  try {
    return { record: await create(), replayed: false };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const racedRecord = await findExisting();
    if (!racedRecord) throw error;
    return replay(racedRecord, fingerprint);
  }
}

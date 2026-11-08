import assert from "node:assert/strict";
import test from "node:test";
import { isLogPayload } from "../src/shared/types/logger.ts";

const validPayload = {
  module: "STOCK",
  level: "INFO",
  msg: "Market data ready",
  timestamp: 1_798_000_000_000,
  tags: ["market"],
  context: { symbol: "ECP", attempt: 2 },
};

test("logger payload validation accepts valid payloads and optional fields", () => {
  assert.equal(isLogPayload(validPayload), true);
  assert.equal(
    isLogPayload({
      module: "LOGGER",
      level: "DEBUG",
      msg: "Started",
      timestamp: 0,
    }),
    true,
  );
});

test("logger payload validation rejects malformed required and optional fields", () => {
  const invalidPayloads = [
    null,
    "not a payload",
    { ...validPayload, module: "  " },
    { ...validPayload, level: "TRACE" },
    { ...validPayload, msg: 12 },
    { ...validPayload, timestamp: Number.NaN },
    { ...validPayload, timestamp: 8.64e15 + 1 },
    { ...validPayload, target: 12 },
    { ...validPayload, tags: ["market", 4] },
    { ...validPayload, context: { attempt: Number.POSITIVE_INFINITY } },
    { ...validPayload, context: [] },
  ];

  for (const payload of invalidPayloads) {
    assert.equal(isLogPayload(payload), false);
  }
});

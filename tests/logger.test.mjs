import assert from "node:assert/strict";
import test from "node:test";
import { isLogPayload } from "../src/shared/types/logger.ts";
import {
  PortDropTracker,
  shouldEmitLog,
} from "../src/infrastructure/logging/logger-client-policy.ts";

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

test("logger client policy filters levels below the configured minimum", () => {
  assert.equal(shouldEmitLog(0, 1), false);
  assert.equal(shouldEmitLog(1, 1), true);
  assert.equal(shouldEmitLog(3, 1), true);
});

test("port drop warnings are summarized and rate-limited", () => {
  const tracker = new PortDropTracker(30_000);

  assert.equal(tracker.record(false, 100_000), 1);
  assert.equal(tracker.record(false, 110_000), undefined);
  assert.equal(tracker.record(false, 120_000), undefined);
  assert.equal(tracker.record(true, 129_999), undefined);
  assert.equal(tracker.record(true, 130_000), 2);
  assert.equal(tracker.record(true, 160_000), undefined);
  assert.equal(tracker.record(false, 160_001), 1);
  assert.equal(tracker.record(false, 160_002), undefined);
  assert.equal(tracker.record(false, 160_003), undefined);
  assert.equal(tracker.record(true, 190_002), 2);
  assert.equal(tracker.record(true, 220_002), undefined);
});

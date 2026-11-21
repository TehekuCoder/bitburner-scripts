import assert from "node:assert/strict";
import test from "node:test";
import { parseDnetStateSnapshot } from "../src/infrastructure/runtime/dnet-mutation-state.ts";

test("darknet state parser accepts mutation epochs", () => {
  const state = parseDnetStateSnapshot(JSON.stringify({
    cooldowns: { hostA: 1234 },
    passwords: { hostA: "secret" },
    mutationEpoch: 7,
  }));

  assert.equal(state.mutationEpoch, 7);
  assert.equal(state.cooldowns.hostA, 1234);
  assert.equal(state.passwords.hostA, "secret");
});

test("darknet state parser rejects malformed and legacy snapshots safely", () => {
  assert.deepEqual(parseDnetStateSnapshot("not-json"), {
    cooldowns: {},
    passwords: {},
    mutationEpoch: 0,
  });
  assert.deepEqual(parseDnetStateSnapshot(JSON.stringify({
    mutationEpoch: -5,
  })), {
    cooldowns: {},
    passwords: {},
    mutationEpoch: 0,
  });
  assert.equal(parseDnetStateSnapshot(JSON.stringify({
    hostA: 1234,
  })).cooldowns.hostA, 1234);
});

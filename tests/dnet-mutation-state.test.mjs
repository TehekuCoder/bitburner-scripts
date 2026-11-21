import assert from "node:assert/strict";
import test from "node:test";
import { parseDnetStateSnapshot } from "../src/infrastructure/runtime/dnet-mutation-state.ts";

test("darknet state parser accepts mutation epochs", () => {
  const state = parseDnetStateSnapshot(JSON.stringify({
    cooldowns: { hostA: 1234 },
    passwords: { hostA: "secret" },
    mutationEpoch: 7,
    lastMutationAt: 5678,
    hosts: {
      hostA: {
        hostname: "hostA",
        depth: 4,
        requiredCharismaSkill: 69,
        hasSession: false,
        isOnline: true,
        isStationary: false,
        modelId: "KingOfTheHill",
        passwordFormat: "numeric",
        passwordLength: 2,
        difficulty: 4,
        blockedRam: 1,
        isConnectedToCurrentServer: true,
        observedAt: 6000,
        observedMutationEpoch: 7,
        lastSuccessfulLoginAt: 5000,
        isStasisLinked: true,
      },
    },
  }));

  assert.equal(state.mutationEpoch, 7);
  assert.equal(state.lastMutationAt, 5678);
  assert.equal(state.cooldowns.hostA, 1234);
  assert.equal(state.passwords.hostA, "secret");
  assert.equal(state.hosts.hostA.isStasisLinked, true);
});

test("darknet state parser rejects malformed and legacy snapshots safely", () => {
  assert.deepEqual(parseDnetStateSnapshot("not-json"), {
    cooldowns: {},
    passwords: {},
    mutationEpoch: 0,
    lastMutationAt: 0,
    hosts: {},
  });
  assert.deepEqual(parseDnetStateSnapshot(JSON.stringify({
    mutationEpoch: -5,
  })), {
    cooldowns: {},
    passwords: {},
    mutationEpoch: 0,
    lastMutationAt: 0,
    hosts: {},
  });
  assert.equal(parseDnetStateSnapshot(JSON.stringify({
    hostA: 1234,
  })).cooldowns.hostA, 1234);
});

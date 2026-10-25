import assert from "node:assert/strict";
import test from "node:test";
import {
  getBotStateShapeErrors,
  isBotStateShape,
  parseStoredState,
  STATE_SCHEMA_VERSION,
} from "../src/infrastructure/state/state-schema.ts";

const validState = {
  lastUpdate: 1,
  batcherProgress: "idle",
  traderProgress: "idle",
  financeProgress: "idle",
  hacknetProgress: "idle",
  gangPhase: "INACTIVE",
  gangProgress: "none",
  stage: "INACTIVE",
  kernelTarget: "n00dles",
  currentBitNode: 1,
  currentBitNodeLevel: 1,
  gangMembersCount: 0,
  gangRespect: 0,
  gangWantedPenalty: 1,
  minWinChance: 1,
  funds: 0,
  revenue: 0,
  expenses: 0,
  investmentOffer: 0,
  hasGang: false,
  hasCorp: false,
  hasDarkScapeNavigator: false,
  hasTorRouter: false,
  hasCorporation: false,
  hasBladeburner: false,
  divisions: [],
  corpRecentLogs: [],
  recentLogs: [],
  sourceFiles: {},
  augRoadMap: [
    {
      name: "Neuroreceptor Management Implant",
      repReq: 2750,
      basePrice: 450000,
      prereqs: [],
      factions: ["CyberSec"],
      bestFaction: "CyberSec",
    },
  ],
};

test("schema-v0 snapshots migrate missing values from defaults", () => {
  const parsed = parseStoredState(
    { revision: 2, state: validState },
    { moneyReserve: 100 },
    isBotStateShape,
  );

  assert.equal(parsed?.revision, 2);
  assert.equal(parsed?.state.moneyReserve, 100);
});

test("current-version snapshots are validated without silently defaulting bad values", () => {
  const parsed = parseStoredState(
    {
      schemaVersion: STATE_SCHEMA_VERSION,
      revision: 3,
      state: { ...validState, moneyReserve: "invalid" },
    },
    { moneyReserve: 100 },
    isBotStateShape,
  );

  assert.equal(parsed, null);
});

test("state shape diagnostics identify invalid fields", () => {
  const errors = getBotStateShapeErrors({
    ...validState,
    strategy: "UNKNOWN",
  });

  assert.deepEqual(errors, ["strategy has an invalid value"]);
});

test("augmentation roadmap validates the shape written by its analyzer", () => {
  assert.deepEqual(getBotStateShapeErrors(validState), []);
});

test("unknown future schemas are rejected", () => {
  const parsed = parseStoredState(
    {
      schemaVersion: STATE_SCHEMA_VERSION + 1,
      revision: 3,
      state: validState,
    },
    {},
    isBotStateShape,
  );

  assert.equal(parsed, null);
});

test("malformed nested finance-related state is rejected", () => {
  const parsed = parseStoredState(
    {
      schemaVersion: STATE_SCHEMA_VERSION,
      revision: 3,
      state: {
        ...validState,
        batcherTargetsSummary: [{ target: "n00dles", activeBatches: "many" }],
      },
    },
    {},
    isBotStateShape,
  );

  assert.equal(parsed, null);
});

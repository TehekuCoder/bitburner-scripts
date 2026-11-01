import assert from "node:assert/strict";
import test from "node:test";
import {
  isManualMode,
  isModuleDisabled,
  shouldRunDaemonInBitNode,
  shouldRunSingularityDispatcher,
  shouldRunSleeveManager,
} from "../src/app/orchestration/orchestrator-policy.ts";

test("module disable policy supports aliases and ignores malformed state", () => {
  assert.equal(
    isModuleDisabled({ disabledModules: ["stock", "sleeve"] }, ["finance", "stock"]),
    true,
  );
  assert.equal(isModuleDisabled({ disabledModules: ["sleeve"] }, "finance"), false);
  assert.equal(isModuleDisabled({ disabledModules: "finance" }, "finance"), false);
  assert.equal(isModuleDisabled(null, "finance"), false);
});

test("manual mode is enabled by its flag or strategy", () => {
  assert.equal(isManualMode({ manualMode: true }), true);
  assert.equal(isManualMode({ strategy: "MANUAL" }), true);
  assert.equal(isManualMode({ strategy: "MONEY" }), false);
  assert.equal(isManualMode(undefined), false);
});

test("BN8 keeps the sleeve manager off regardless of sleeve shock", () => {
  assert.equal(shouldRunSleeveManager(8), false);
  assert.equal(shouldRunSleeveManager(7), true);
});

test("BN8 minimal mode only starts explicitly allowed daemons", () => {
  assert.equal(shouldRunDaemonInBitNode(8, true), true);
  assert.equal(shouldRunDaemonInBitNode(8, false), false);
  assert.equal(shouldRunDaemonInBitNode(7, false), true);
});

test("BN8 only starts the Singularity dispatcher for reputation farming", () => {
  assert.equal(shouldRunSingularityDispatcher(8, "REP"), true);
  assert.equal(shouldRunSingularityDispatcher(8, "STOCK"), false);
  assert.equal(shouldRunSingularityDispatcher(8, undefined), false);
  assert.equal(shouldRunSingularityDispatcher(7, "STOCK"), true);
});

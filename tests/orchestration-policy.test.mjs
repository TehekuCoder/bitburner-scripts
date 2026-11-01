import assert from "node:assert/strict";
import test from "node:test";
import {
  isManualMode,
  isModuleDisabled,
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

test("BN8 only runs the sleeve manager while a sleeve has shock", () => {
  assert.equal(shouldRunSleeveManager(8, true), true);
  assert.equal(shouldRunSleeveManager(8, false), false);
  assert.equal(shouldRunSleeveManager(7, false), true);
});

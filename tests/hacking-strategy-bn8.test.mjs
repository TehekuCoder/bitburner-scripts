import assert from "node:assert/strict";
import test from "node:test";
import {
  canRunHackingWorkersOnHome,
  getHackingStrategyOverride,
} from "../src/domain/evaluators/strategy/hacking-policy.ts";

test("BN8 uses the worker fleet instead of the XP-grind engine", () => {
  const override = getHackingStrategyOverride(8);

  assert.equal(override?.strategy, "WORKER");
  assert.match(override?.reason ?? "", /BN8/);
});

test("other BitNodes retain their normal hacking strategy selection", () => {
  assert.equal(getHackingStrategyOverride(7), null);
});

test("BN8 keeps hacking workers off home while other BitNodes may use it", () => {
  assert.equal(canRunHackingWorkersOnHome(8), false);
  assert.equal(canRunHackingWorkersOnHome(7), true);
});

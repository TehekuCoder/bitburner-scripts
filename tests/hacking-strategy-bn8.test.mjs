import assert from "node:assert/strict";
import test from "node:test";
import { getHackingStrategyOverride } from "../src/domain/evaluators/strategy/hacking-policy.ts";

test("BN8 uses the worker fleet instead of the XP-grind engine", () => {
  const override = getHackingStrategyOverride(8);

  assert.equal(override?.strategy, "WORKER");
  assert.match(override?.reason ?? "", /BN8/);
});

test("other BitNodes retain their normal hacking strategy selection", () => {
  assert.equal(getHackingStrategyOverride(7), null);
});

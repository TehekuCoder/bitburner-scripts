import assert from "node:assert/strict";
import test from "node:test";
import { shouldEnableStanekForBitNode } from "../src/domain/strategy/stanek-policy.ts";

test("Stanek is disabled in BitNode 8 and remains enabled elsewhere", () => {
  assert.equal(shouldEnableStanekForBitNode(8), false);
  assert.equal(shouldEnableStanekForBitNode(1), true);
  assert.equal(shouldEnableStanekForBitNode(13), true);
});

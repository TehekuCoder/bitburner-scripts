import assert from "node:assert/strict";
import test from "node:test";
import { hasSleevesNeedingShockRecovery } from "../src/domain/sleeve/sleeve-recovery.ts";

test("shock recovery is needed while any sleeve has shock", () => {
  const ns = {
    sleeve: {
      getNumSleeves: () => 3,
      getSleeve: (id) => [{ shock: 0 }, { shock: 0.1 }, { shock: 0 }][id],
    },
  };

  assert.equal(hasSleevesNeedingShockRecovery(ns), true);
});

test("shock recovery is complete when all sleeves have zero shock", () => {
  const ns = {
    sleeve: {
      getNumSleeves: () => 2,
      getSleeve: () => ({ shock: 0 }),
    },
  };

  assert.equal(hasSleevesNeedingShockRecovery(ns), false);
  assert.equal(hasSleevesNeedingShockRecovery({}), false);
});

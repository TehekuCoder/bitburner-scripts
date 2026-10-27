import assert from "node:assert/strict";
import test from "node:test";
import { getEligibleAugmentations } from "../src/domain/evaluators/purchase/augmentation-plan.ts";

test("eligible plan items skip missing prerequisites but include later affordable candidates", () => {
  const items = [
    { name: "Expensive", prereqs: [] },
    { name: "Locked Upgrade", prereqs: ["Expensive"] },
    { name: "Affordable", prereqs: [] },
  ];

  assert.deepEqual(
    getEligibleAugmentations(items, new Set()).map((item) => item.name),
    ["Expensive", "Affordable"],
  );
});

test("purchasing a prerequisite unlocks its planned upgrade", () => {
  const items = [
    { name: "Base", prereqs: [] },
    { name: "Upgrade", prereqs: ["Base"] },
  ];

  assert.deepEqual(
    getEligibleAugmentations(items, new Set(["Base"])).map((item) => item.name),
    ["Upgrade"],
  );
});

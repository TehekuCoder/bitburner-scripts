import assert from "node:assert/strict";
import test from "node:test";
import {
  getEligibleAugmentations,
  selectNextAugmentationRequest,
} from "../src/domain/evaluators/purchase/augmentation-plan.ts";

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

test("augmentation requests are selected one at a time by priority then lowest price", () => {
  const requests = [
    { description: "Expensive", priority: 2, cost: 200 },
    { description: "Cheap", priority: 2, cost: 100 },
    { description: "Critical", priority: 1, cost: 500 },
  ];

  assert.equal(selectNextAugmentationRequest(requests)?.description, "Critical");
  assert.equal(
    selectNextAugmentationRequest(requests.slice(0, 2))?.description,
    "Cheap",
  );
  assert.equal(requests.length, 3);
});

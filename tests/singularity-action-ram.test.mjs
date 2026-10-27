import assert from "node:assert/strict";
import test from "node:test";
import {
  getMaximumSingularityActionRam,
  getSingularityActionRam,
} from "../src/app/actions/singularity-action-ram.ts";

test("augmentation purchase RAM includes all validation and purchase APIs", () => {
  assert.equal(getSingularityActionRam(["player-purchase-aug"], 1), 28.21);
  assert.ok(getMaximumSingularityActionRam(1) >= 28.21);
});

test("augmentation purchase RAM scales with the Singularity multiplier", () => {
  assert.equal(getSingularityActionRam(["player-purchase-aug"], 4), 106.2);
  assert.equal(getSingularityActionRam(["player-purchase-aug"], 16), 418.21);
});

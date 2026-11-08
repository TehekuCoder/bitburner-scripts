import assert from "node:assert/strict";
import test from "node:test";
import {
  getDaedalusAugmentationRequirement,
  getHackingAugmentationValue,
  getMissingDaedalusAugmentationCount,
  hasBothFourSigmaLicenses,
  hasGraftingUnlock,
  hasHackingAugmentationBenefit,
} from "../src/domain/evaluators/purchase/bn8-augmentation.ts";

test("BN8 accepts only augmentations with a positive hacking multiplier", () => {
  assert.equal(hasHackingAugmentationBenefit({ hacking: 1.1 }), true);
  assert.equal(hasHackingAugmentationBenefit({ hacking_exp: 1.2 }), true);
  assert.equal(hasHackingAugmentationBenefit({ hacking_speed: 1.3 }), true);
  assert.equal(hasHackingAugmentationBenefit({ strength: 2 }), false);
  assert.equal(hasHackingAugmentationBenefit({ hacking: 1 }), false);
  assert.equal(
    getHackingAugmentationValue({ hacking: 1.1, hacking_exp: 1.2 }),
    Math.log(1.1) + Math.log(1.2),
  );
});

test("Daedalus augmentation count respects the BitNode multiplier and pending batch", () => {
  assert.equal(getDaedalusAugmentationRequirement(1), 30);
  assert.equal(getDaedalusAugmentationRequirement(1.5), 45);
  assert.equal(getDaedalusAugmentationRequirement(Number.NaN), 30);
  assert.equal(getMissingDaedalusAugmentationCount(30, 20, 7), 3);
  assert.equal(getMissingDaedalusAugmentationCount(30, 30, 4), 0);
});

test("both 4S licenses are required for the BN8 augmentation phase", () => {
  const makeNs = (hasData, hasApi) => ({
    stock: {
      has4SData: () => hasData,
      has4SDataTixApi: () => hasApi,
    },
  });

  assert.equal(hasBothFourSigmaLicenses(makeNs(false, false)), false);
  assert.equal(hasBothFourSigmaLicenses(makeNs(true, false)), false);
  assert.equal(hasBothFourSigmaLicenses(makeNs(true, true)), true);
});

test("Grafting unlock detects SF10 and BitNode 10", () => {
  assert.equal(
    hasGraftingUnlock({
      getResetInfo: () => ({ currentNode: 8, ownedSF: new Map([[10, 1]]) }),
    }),
    true,
  );
  assert.equal(
    hasGraftingUnlock({
      getResetInfo: () => ({ currentNode: 10, ownedSF: new Map() }),
    }),
    true,
  );
  assert.equal(
    hasGraftingUnlock({
      getResetInfo: () => ({ currentNode: 8, ownedSF: new Map() }),
    }),
    false,
  );
});

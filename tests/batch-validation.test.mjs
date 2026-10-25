import assert from "node:assert/strict";
import test from "node:test";
import {
  isNonNegativeFiniteNumber,
  isPositiveFiniteNumber,
} from "../src/domain/hacking/batch-validation.ts";

test("batch plan positive values reject zero and non-finite formula results", () => {
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(isPositiveFiniteNumber(invalid), false);
  }
  assert.equal(isPositiveFiniteNumber(0.01), true);
});

test("batch delays accept zero but reject negative and non-finite values", () => {
  assert.equal(isNonNegativeFiniteNumber(0), true);
  assert.equal(isNonNegativeFiniteNumber(1), true);
  assert.equal(isNonNegativeFiniteNumber(-1), false);
  assert.equal(isNonNegativeFiniteNumber(Number.NaN), false);
  assert.equal(isNonNegativeFiniteNumber(Number.POSITIVE_INFINITY), false);
});

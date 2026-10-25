import assert from "node:assert/strict";
import test from "node:test";
import { groupRequestsByCategory } from "../src/domain/evaluators/request-batches.ts";

test("mixed evaluator requests are split into category-consistent batches", () => {
  const license = { id: "wse", category: "STOCK_LICENSE" };
  const trade = { id: "buy", category: "STOCK_TRADE" };

  assert.deepEqual(groupRequestsByCategory("STOCK_LICENSE", [license, trade]), [
    { category: "STOCK_LICENSE", requests: [license] },
    { category: "STOCK_TRADE", requests: [trade] },
  ]);
});

test("empty evaluators still publish their category heartbeat", () => {
  assert.deepEqual(groupRequestsByCategory("HACKNET", []), [
    { category: "HACKNET", requests: [] },
  ]);
});

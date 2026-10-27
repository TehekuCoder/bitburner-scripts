import assert from "node:assert/strict";
import test from "node:test";
import {
  canAffordFinanceRequest,
  compareFinanceRequests,
  findCachedFinanceRequest,
  findRunningFinanceAction,
  getCompletedAugmentationPurchaseOutcome,
  hasPendingFinanceCategory,
  isAugmentationPurchasePriceStale,
  isFinanceRequestRecentlyCompleted,
  isFinanceActionTimedOut,
  pruneExpiredFinanceRetries,
} from "../src/app/orchestration/finance-runtime.ts";

test("finance requests sort by priority, category weight, score, then cost", () => {
  const weights = { PLAYER_AUG: 3, HACKNET: 1 };
  const requests = [
    { id: "cheap", category: "HACKNET", priority: 2, cost: 10 },
    { id: "high-score", category: "PLAYER_AUG", priority: 2, cost: 100, score: 8 },
    { id: "highest-priority", category: "HACKNET", priority: 1, cost: 10 },
    { id: "low-score", category: "PLAYER_AUG", priority: 2, cost: 10, score: 2 },
  ];

  assert.deepEqual(
    requests.sort((a, b) => compareFinanceRequests(a, b, weights)).map(({ id }) => id),
    ["highest-priority", "high-score", "low-score", "cheap"],
  );
});

test("finance budget includes the configured margin at its exact boundary", () => {
  assert.equal(canAffordFinanceRequest(120, 100, 1.2), true);
  assert.equal(canAffordFinanceRequest(119.99, 100, 1.2), false);
});

test("augmentation dispatch buys the most expensive candidate within budget", () => {
  const candidates = [
    { id: "cheap", category: "PLAYER_AUG", priority: 2, cost: 100, score: 100 },
    { id: "fits", category: "PLAYER_AUG", priority: 2, cost: 200, score: 200 },
    { id: "unaffordable", category: "PLAYER_AUG", priority: 2, cost: 300, score: 300 },
  ];
  const ordered = candidates.sort((a, b) =>
    compareFinanceRequests(a, b, { PLAYER_AUG: 1 }),
  );
  const selected = ordered.find((candidate) =>
    canAffordFinanceRequest(225, candidate.cost, 1),
  );

  assert.equal(selected?.id, "fits");
});

test("a restarted core can identify the already-running action for a request", () => {
  const processes = [
    { filename: "other.js", args: ["__finance_request__:HACKNET:one"], pid: 3 },
    {
      filename: "hacknet.js",
      args: ["buy", "__finance_request__:HACKNET:one"],
      pid: 7,
    },
  ];

  assert.equal(
    findRunningFinanceAction(
      processes,
      "hacknet.js",
      "HACKNET:one",
      "__finance_request__:",
    )?.pid,
    7,
  );
  assert.equal(
    findRunningFinanceAction(
      processes,
      "hacknet.js",
      "HACKNET:two",
      "__finance_request__:",
    ),
    undefined,
  );
});

test("timeouts start only after the timeout boundary", () => {
  assert.equal(isFinanceActionTimedOut(60_000, 0, 60_000), false);
  assert.equal(isFinanceActionTimedOut(60_001, 0, 60_000), true);
});

test("augmentation purchase completion is inferred after the action exits", () => {
  assert.equal(
    getCompletedAugmentationPurchaseOutcome(true, [], "NeuroFlux Governor"),
    undefined,
  );
  assert.equal(
    getCompletedAugmentationPurchaseOutcome(
      false,
      ["NeuroFlux Governor"],
      "NeuroFlux Governor",
    ),
    true,
  );
  assert.equal(
    getCompletedAugmentationPurchaseOutcome(false, [], "NeuroFlux Governor"),
    false,
  );
});

test("augmentation requests with pre-inflation prices are treated as stale", () => {
  assert.equal(isAugmentationPurchasePriceStale(100, 100, 100), false);
  assert.equal(isAugmentationPurchasePriceStale(100, 100, 190), true);
  assert.equal(isAugmentationPurchasePriceStale(100, 90, 100), true);
});

test("a late result can still be matched to its cached request after restart", () => {
  const request = { id: "one", category: "HACKNET" };
  const caches = [{ requests: new Map([[request.id, request]]) }];

  assert.equal(findCachedFinanceRequest(caches, "HACKNET:one"), request);
  assert.equal(findCachedFinanceRequest(caches, "HACKNET:missing"), undefined);
});

test("expired retry entries are pruned without removing active retries", () => {
  const retries = new Map([
    ["expired", 10],
    ["boundary", 20],
    ["active", 21],
  ]);

  pruneExpiredFinanceRetries(retries, 20);

  assert.deepEqual([...retries], [["active", 21]]);
});

test("recently completed requests are suppressed until their dedupe window expires", () => {
  const completed = new Map([["PLAYER_AUG:one", 100]]);

  assert.equal(
    isFinanceRequestRecentlyCompleted(completed, "PLAYER_AUG:one", 99),
    true,
  );
  assert.equal(
    isFinanceRequestRecentlyCompleted(completed, "PLAYER_AUG:one", 100),
    false,
  );
  assert.equal(completed.has("PLAYER_AUG:one"), false);
});

test("only one augmentation purchase runs at a time", () => {
  const pending = [{ category: "HACKNET" }, { category: "PLAYER_AUG" }];

  assert.equal(hasPendingFinanceCategory(pending, "PLAYER_AUG"), true);
  assert.equal(hasPendingFinanceCategory(pending, "COMPANY"), false);
});

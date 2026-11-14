import assert from "node:assert/strict";
import test from "node:test";
import {
  getBn8PostRedPillRamRequirement,
  isBn8PostRedPillRamReady,
  shouldAutoPurchaseProgramInBitNode,
  canAffordFinanceRequest,
  compareFinanceRequests,
  getBn8VioletGraftingReserve,
  findCachedFinanceRequest,
  findRunningFinanceAction,
  getAffordableAugmentationShortlist,
  getCompletedAugmentationPurchaseOutcome,
  isFinanceCategoryAllowedInBitNode,
  isFinanceCategoryAllowedDuringAugmentation,
  shouldPrepareBn8GraftingCapacity,
  shouldPrepareBn8PostRedPillCapacity,
  hasPendingFinanceCategory,
  isAugmentationPurchasePriceStale,
  isFinanceRequestRecentlyCompleted,
  isFinanceActionTimedOut,
  pruneExpiredFinanceRetries,
  shouldPrepareBn8SleeveCapacity,
  shouldUnlockBn8SleeveAugPurchases,
} from "../src/app/orchestration/finance-runtime.ts";

test("BitNode 8 finance dispatch gates augmentations and programs by phase", () => {
  assert.equal(isFinanceCategoryAllowedInBitNode("DARKNET_PROGRAM", 8), false);
  assert.equal(isFinanceCategoryAllowedInBitNode("STOCK_LICENSE", 8), true);
  assert.equal(isFinanceCategoryAllowedInBitNode("STOCK_TRADE", 8), true);
  assert.equal(isFinanceCategoryAllowedInBitNode("PURCHASED_SERVER", 8), true);
  assert.equal(isFinanceCategoryAllowedInBitNode("PLAYER_AUG", 8), false);
  assert.equal(isFinanceCategoryAllowedInBitNode("SLEEVE_AUG", 8, true, false, false, true), true);
  assert.equal(isFinanceCategoryAllowedInBitNode("SLEEVE_AUG", 8, true), false);
  assert.equal(isFinanceCategoryAllowedInBitNode("HOME_SERVER", 8), false);
  assert.equal(isFinanceCategoryAllowedInBitNode("HOME_SERVER", 8, true, false, true), true);
  assert.equal(isFinanceCategoryAllowedInBitNode("PLAYER_AUG", 8, true), true);
  assert.equal(
    isFinanceCategoryAllowedInBitNode("DARKNET_PROGRAM", 8, true),
    false,
  );
  assert.equal(
    isFinanceCategoryAllowedInBitNode("DARKNET_PROGRAM", 8, true, true),
    true,
  );
  assert.equal(isFinanceCategoryAllowedInBitNode("PLAYER_AUG", 7), true);
});

test("BN8 sleeve aug purchases unlock once the 100T threshold and prerequisites are met", () => {
  assert.equal(shouldUnlockBn8SleeveAugPurchases(8, true, true, 100e12, false), true);
  assert.equal(shouldUnlockBn8SleeveAugPurchases(8, true, true, 99e12, false), false);
  assert.equal(shouldUnlockBn8SleeveAugPurchases(8, false, true, 100e12, false), false);
  assert.equal(shouldUnlockBn8SleeveAugPurchases(8, true, false, 100e12, false), false);
  assert.equal(shouldUnlockBn8SleeveAugPurchases(7, true, true, 100e12, false), false);
  assert.equal(shouldUnlockBn8SleeveAugPurchases(8, false, false, 0, true), true);
  assert.equal(shouldUnlockBn8SleeveAugPurchases(7, false, false, 0, true), false);
});

test("BN8 protects the Violet graft price until the augmentation is owned", () => {
  assert.equal(getBn8VioletGraftingReserve(true, false), 150e12);
  assert.equal(getBn8VioletGraftingReserve(true, false, 160e12), 160e12);
  assert.equal(getBn8VioletGraftingReserve(true, false, Number.NaN), 150e12);
  assert.equal(getBn8VioletGraftingReserve(true, true), 0);
  assert.equal(getBn8VioletGraftingReserve(false, false), 0);
});

test("BN8 prepares Home RAM for the Sleeve evaluator only when capacity is short", () => {
  assert.equal(shouldPrepareBn8SleeveCapacity(8, true, true, true, false, 20, 19), true);
  assert.equal(shouldPrepareBn8SleeveCapacity(8, true, true, true, false, 20, 20), false);
  assert.equal(shouldPrepareBn8SleeveCapacity(8, true, true, true, true, 20, 10), false);
  assert.equal(shouldPrepareBn8SleeveCapacity(8, false, true, true, false, 20, 10), false);
  assert.equal(shouldPrepareBn8SleeveCapacity(8, true, false, true, false, 20, 10), false);
  assert.equal(shouldPrepareBn8SleeveCapacity(7, true, true, true, false, 20, 10), false);
});

test("BN8 prepares home RAM before starting the Grafting Manager", () => {
  assert.equal(shouldPrepareBn8GraftingCapacity(8, 1, true, false, 35, 20), true);
  assert.equal(shouldPrepareBn8GraftingCapacity(8, 1, true, false, 35, 35), false);
  assert.equal(shouldPrepareBn8GraftingCapacity(8, 1, true, true, 35, 20), false);
  assert.equal(shouldPrepareBn8GraftingCapacity(8, 0, true, false, 35, 20), false);
  assert.equal(shouldPrepareBn8GraftingCapacity(8, 1, false, false, 35, 20), false);
  assert.equal(shouldPrepareBn8GraftingCapacity(7, 1, true, false, 35, 20), false);
});

test("BN8 delays Red Pill installation until the operational daemon RAM fits", () => {
  assert.equal(shouldPrepareBn8PostRedPillCapacity(8, true, 64, 96), true);
  assert.equal(shouldPrepareBn8PostRedPillCapacity(8, true, 96, 96), false);
  assert.equal(shouldPrepareBn8PostRedPillCapacity(8, false, 32, 96), false);
  assert.equal(shouldPrepareBn8PostRedPillCapacity(7, true, 32, 96), false);

  assert.equal(isBn8PostRedPillRamReady(8, 95, 96), false);
  assert.equal(isBn8PostRedPillRamReady(8, 96, 96), true);
  assert.equal(isBn8PostRedPillRamReady(7, 0, Number.POSITIVE_INFINITY), true);
});

test("BN8 leaves SQLInject to player-created programs but keeps automatic purchases elsewhere", () => {
  assert.equal(shouldAutoPurchaseProgramInBitNode(8, "SQLInject.exe"), false);
  assert.equal(shouldAutoPurchaseProgramInBitNode(8, "BruteSSH.exe"), true);
  assert.equal(shouldAutoPurchaseProgramInBitNode(7, "SQLInject.exe"), true);
});

test("BN8 post-Red Pill RAM requirement includes all persistent operating daemons", () => {
  const ns = {
    getScriptRam: (script) => (script.includes("finance") ? 10 : 5),
  };
  assert.equal(getBn8PostRedPillRamRequirement(ns), 35);
  assert.equal(
    getBn8PostRedPillRamRequirement({
      getScriptRam: () => 0,
    }),
    Number.POSITIVE_INFINITY,
  );
});

test("BN8 stock trading continues while an augmentation batch awaits installation", () => {
  assert.equal(isFinanceCategoryAllowedDuringAugmentation("STOCK_TRADE", 8), true);
  assert.equal(isFinanceCategoryAllowedDuringAugmentation("STOCK_LICENSE", 8), true);
  assert.equal(isFinanceCategoryAllowedDuringAugmentation("PLAYER_AUG", 8), true);
  assert.equal(isFinanceCategoryAllowedDuringAugmentation("DARKNET_PROGRAM", 8), false);
  assert.equal(isFinanceCategoryAllowedDuringAugmentation("STOCK_TRADE", 7), false);
  assert.equal(isFinanceCategoryAllowedDuringAugmentation("SLEEVE_AUG", 7), true);
  assert.equal(isFinanceCategoryAllowedDuringAugmentation("HOME_SERVER", 8), false);
  assert.equal(isFinanceCategoryAllowedDuringAugmentation("HOME_SERVER", 8, true), true);
});

test("BN8 prioritizes affordable 4S licenses over new stock positions", () => {
  const requests = [
    { id: "trade", category: "STOCK_TRADE", priority: 3, cost: 1 },
    { id: "license", category: "STOCK_LICENSE", priority: 1, cost: 10 },
  ];
  const ordered = requests.sort((a, b) =>
    compareFinanceRequests(a, b, {
      STOCK_LICENSE: Number.MAX_SAFE_INTEGER,
      STOCK_TRADE: Number.MAX_SAFE_INTEGER - 1,
    }),
  );

  assert.deepEqual(ordered.map(({ id }) => id), ["license", "trade"]);
});

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

test("augmentation shortlist contains up to five affordable candidates in priority order", () => {
  const candidates = [
    { id: "best-fit", category: "PLAYER_AUG", priority: 2, cost: 200, score: 200 },
    { id: "second-fit", category: "PLAYER_AUG", priority: 2, cost: 150, score: 150 },
    { id: "third-fit", category: "PLAYER_AUG", priority: 2, cost: 125, score: 125 },
    { id: "fourth-fit", category: "PLAYER_AUG", priority: 2, cost: 100, score: 100 },
    { id: "fifth-fit", category: "PLAYER_AUG", priority: 2, cost: 75, score: 75 },
    { id: "sixth-fit", category: "PLAYER_AUG", priority: 2, cost: 50, score: 50 },
    { id: "unaffordable", category: "PLAYER_AUG", priority: 2, cost: 300, score: 300 },
    { id: "other-category", category: "HACKNET", priority: 2, cost: 10 },
  ].sort((a, b) =>
    compareFinanceRequests(a, b, { PLAYER_AUG: 1, HACKNET: 0 }),
  );

  assert.deepEqual(
    getAffordableAugmentationShortlist(candidates, 225, 1, 5).map(
      ({ id }) => id,
    ),
    ["best-fit", "second-fit", "third-fit", "fourth-fit", "fifth-fit"],
  );
});

test("augmentation shortlist keeps the cheapest request visible when none fit the budget", () => {
  const candidates = [
    { id: "expensive", category: "PLAYER_AUG", priority: 2, cost: 200 },
    { id: "cheapest", category: "PLAYER_AUG", priority: 2, cost: 100 },
  ];

  assert.deepEqual(
    getAffordableAugmentationShortlist(candidates, 50, 1, 5).map(
      ({ id }) => id,
    ),
    ["cheapest"],
  );
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

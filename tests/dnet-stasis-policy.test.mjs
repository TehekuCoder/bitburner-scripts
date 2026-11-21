import assert from "node:assert/strict";
import test from "node:test";
import { chooseDnetStasisAction } from "../src/domain/strategy/dnet-stasis-policy.ts";

const candidates = [
  {
    hostname: "shallow",
    depth: 2,
    isOnline: true,
    isStationary: false,
    hasCrawler: true,
  },
  {
    hostname: "deep",
    depth: 7,
    isOnline: true,
    isStationary: false,
    hasCrawler: true,
  },
  {
    hostname: "offline",
    depth: 20,
    isOnline: false,
    isStationary: false,
    hasCrawler: true,
  },
];

test("free stasis slots are assigned only by the deepest active crawler", () => {
  assert.equal(chooseDnetStasisAction("shallow", candidates, [], 1), null);
  assert.equal(chooseDnetStasisAction("deep", candidates, [], 1), "link");
});

test("a full stasis quota is leapfrogged by unlinking only the shallowest anchor", () => {
  assert.equal(
    chooseDnetStasisAction("shallow", candidates, ["shallow"], 1),
    "unlink",
  );
  assert.equal(
    chooseDnetStasisAction("deep", candidates, ["shallow"], 1),
    null,
  );
});

test("stationary nodes and non-deeper candidates do not trigger link churn", () => {
  const stationaryOnly = [{
    hostname: "fixed",
    depth: 12,
    isOnline: true,
    isStationary: true,
    hasCrawler: true,
  }];
  assert.equal(chooseDnetStasisAction("fixed", stationaryOnly, [], 2), null);
  assert.equal(
    chooseDnetStasisAction("shallow", candidates, ["deep"], 1),
    null,
  );
});

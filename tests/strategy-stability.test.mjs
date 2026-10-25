import assert from "node:assert/strict";
import test from "node:test";
import { shouldContinueFactionReputation } from "../src/domain/strategy/strategy-stability.ts";

const activeReputationRequest = {
  previousMode: "REP",
  previousFaction: "Tian Di Hui",
  nextFaction: "Tian Di Hui",
  playerFactions: ["Tian Di Hui"],
  currentReputation: 100,
  targetReputation: 500,
};

test("an unfinished reputation request stays in REP mode", () => {
  assert.equal(shouldContinueFactionReputation(activeReputationRequest), true);
});

test("reputation mode releases when its target has been reached", () => {
  assert.equal(
    shouldContinueFactionReputation({
      ...activeReputationRequest,
      currentReputation: 500,
    }),
    false,
  );
});

test("a different faction target does not pin the previous REP mode", () => {
  assert.equal(
    shouldContinueFactionReputation({
      ...activeReputationRequest,
      nextFaction: "CyberSec",
    }),
    false,
  );
});

test("only a joined faction and a valid unfinished target can be pinned", () => {
  assert.equal(
    shouldContinueFactionReputation({
      ...activeReputationRequest,
      playerFactions: [],
    }),
    false,
  );
  assert.equal(
    shouldContinueFactionReputation({
      ...activeReputationRequest,
      currentReputation: Number.NaN,
    }),
    false,
  );
});

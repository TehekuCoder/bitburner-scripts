import assert from "node:assert/strict";
import test from "node:test";
import {
  getFactionDonationAmount,
  getNextFactionDonationTarget,
  meetsFactionDonationFavorRequirement,
  shouldUnlockBn8FactionDonations,
  shouldDonateToBn8Faction,
} from "../src/domain/evaluators/purchase/bn8-donation.ts";

test("BN8 unlocks general faction donations once 1q and sleeves have both been reached", () => {
  assert.equal(shouldUnlockBn8FactionDonations(8, true, 1e15, false), true);
  assert.equal(shouldUnlockBn8FactionDonations(8, false, 1e15, false), false);
  assert.equal(shouldUnlockBn8FactionDonations(8, true, 1e15 - 1, false), false);
  assert.equal(shouldUnlockBn8FactionDonations(8, false, 0, true), true);
  assert.equal(shouldUnlockBn8FactionDonations(7, true, 1e15, false), false);
});

test("BN8 general donations use the persistent unlock and Daedalus can donate for the eligible Red Pill", () => {
  assert.equal(shouldDonateToBn8Faction(8, "CyberSec", true, false), true);
  assert.equal(shouldDonateToBn8Faction(8, "CyberSec", false, false), false);
  assert.equal(shouldDonateToBn8Faction(8, "Daedalus", false, true), true);
  assert.equal(shouldDonateToBn8Faction(8, "Daedalus", false, false), false);
  assert.equal(shouldDonateToBn8Faction(7, "Daedalus", true, true), false);
});

test("donation amount covers the target rep gap and rejects invalid multipliers", () => {
  assert.equal(getFactionDonationAmount(1_000, 900, 1), 101_000_000);
  assert.equal(getFactionDonationAmount(900, 1_000, 1), 0);
  assert.equal(getFactionDonationAmount(1_000, 900, 0), 0);
});

test("faction donations target only the next eligible augmentation's reputation", () => {
  const candidates = [
    { name: "First Aug", factions: ["CyberSec"], repReq: 100 },
    { name: "Later Aug", factions: ["CyberSec"], repReq: 1_000 },
    { name: "Other", factions: ["NiteSec"], repReq: 250 },
  ];

  assert.equal(
    getNextFactionDonationTarget(candidates, "CyberSec", 0)?.name,
    "First Aug",
  );
  assert.equal(
    getNextFactionDonationTarget(candidates, "CyberSec", 100),
    undefined,
  );
  assert.equal(
    getNextFactionDonationTarget(candidates, "CyberSec", 0, "Later Aug")
      ?.name,
    "Later Aug",
  );
  assert.equal(
    getNextFactionDonationTarget(candidates, "CyberSec", 0, "Missing"),
    undefined,
  );
});

test("BN8 donations ignore faction favor while other BitNodes retain the favor gate", () => {
  assert.equal(meetsFactionDonationFavorRequirement(8, 0, 150), true);
  assert.equal(meetsFactionDonationFavorRequirement(7, 149, 150), false);
  assert.equal(meetsFactionDonationFavorRequirement(7, 150, 150), true);
});

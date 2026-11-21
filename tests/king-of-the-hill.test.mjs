import assert from "node:assert/strict";
import test from "node:test";
import {
  getKingOfTheHillCandidateRange,
  parseKingOfTheHillAltitude,
} from "../src/domain/solvers/king-of-the-hill-policy.ts";

test("KingOfTheHill parses altitude and attempted password from logs", () => {
  const feedback = parseKingOfTheHillAltitude([
    JSON.stringify({
      message: "current altitude: 7788.00783 m; highest peak: 10,000 m",
      data: 7788.007830714048,
      passwordAttempted: 95,
      code: 401,
    }),
  ]);

  assert.equal(feedback?.altitude, 7788.00783);
  assert.equal(feedback?.passwordAttempted, 95);
});

test("KingOfTheHill builds bounded numeric password ranges", () => {
  assert.deepEqual(
    getKingOfTheHillCandidateRange(2, "numeric"),
    { minimum: 10, maximum: 99 },
  );
  assert.throws(
    () => getKingOfTheHillCandidateRange(2, "alphanumeric"),
    /nur numerische Passwörter/,
  );
});

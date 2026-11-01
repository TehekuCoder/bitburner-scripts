import test from "node:test";
import assert from "node:assert/strict";
import { wrapText } from "../src/ui/ui-text.ts";

const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, "");

test("wrapText wraps on word boundaries and preserves all text", () => {
  const lines = wrapText("A longer status message for the dashboard", 14);

  assert.equal(lines.join(" "), "A longer status message for the dashboard");
  assert.ok(lines.every((line) => stripAnsi(line).length <= 14));
});

test("wrapText safely breaks words wider than the line", () => {
  const lines = wrapText("abcdefgh", 3);

  assert.deepEqual(lines, ["abc", "def", "gh"]);
});

test("wrapText keeps ANSI colors valid across wrapped lines", () => {
  const lines = wrapText("\u001b[31mred text that wraps\u001b[0m", 8);

  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => stripAnsi(line).length <= 8));
  assert.ok(lines.slice(0, -1).every((line) => line.endsWith("\u001b[0m")));
  assert.ok(lines.slice(1).every((line) => line.startsWith("\u001b[31m")));
  assert.equal(lines.map(stripAnsi).join(" "), "red text that wraps");
});

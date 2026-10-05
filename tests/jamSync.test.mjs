import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// src/utils/jamSync.ts is dependency-free; transpile it with the project's TypeScript and import it directly.
const source = await readFile(new URL("../src/utils/jamSync.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { expectedPosition, estimateClockOffset, correctDrift, SYNC } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);

test("starts at 100s, received 500ms later → expected position ≈ 100.5s", () => {
  const sentAt = 1_791_178_235_000;
  close(expectedPosition({ isPlaying: true, position: 100, positionUpdatedAt: sentAt }, sentAt + 500), 100.5);
});

test("paused rooms don't advance", () => {
  assert.equal(expectedPosition({ isPlaying: false, position: 84.52, positionUpdatedAt: 0 }, 60_000), 84.52);
});

test("a song scheduled to start in the future yields a negative position (wait, then start)", () => {
  close(expectedPosition({ isPlaying: true, position: 0, positionUpdatedAt: 10_800 }, 10_000), -0.8);
});

test("clock offset uses the lowest-latency sample", () => {
  // Server clock is 2000ms ahead. Sample 2 is slow and asymmetric; sample 1 is fast.
  const offset = estimateClockOffset([
    { t0: 1000, t1: 1040, serverTime: 3020 },
    { t0: 5000, t1: 5600, serverTime: 7500 }
  ]);
  close(offset, 2000);
  assert.equal(estimateClockOffset([]), 0);
});

test("small drift is ignored", () => {
  assert.deepEqual(correctDrift(100.2, 100), { kind: "none" });
  assert.deepEqual(correctDrift(100, 100.2), { kind: "none" });
});

test("moderate drift is corrected smoothly with playbackRate, not a seek", () => {
  assert.deepEqual(correctDrift(100.5, 100), { kind: "rate", rate: 1 + SYNC.nudge }, "behind → speed up");
  assert.deepEqual(correctDrift(100, 100.5), { kind: "rate", rate: 1 - SYNC.nudge }, "ahead → slow down");
});

test("rate correction has hysteresis: keeps going until nearly in sync, then returns to 1x", () => {
  const fast = 1 + SYNC.nudge;
  assert.deepEqual(correctDrift(100.2, 100, fast), { kind: "none" }, "still 200ms behind: keep the current rate");
  assert.deepEqual(correctDrift(100.03, 100, fast), { kind: "rate", rate: 1 }, "within settle → back to normal");
});

test("large drift seeks once", () => {
  assert.deepEqual(correctDrift(130, 100), { kind: "seek", position: 130 });
  assert.deepEqual(correctDrift(100, 105, 0.95), { kind: "seek", position: 100 });
});

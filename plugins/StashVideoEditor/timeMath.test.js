// timeMath.test.js
const test = require("node:test");
const assert = require("node:assert");
const { formatTime, validateRange, clampIn, clampOut } = require("./timeMath.js");

// ── formatTime ───────────────────────────────────────────────────────────────
test("formatTime: minutes:seconds with zero-padded seconds", () => {
  assert.strictEqual(formatTime(0), "0:00");
  assert.strictEqual(formatTime(12), "0:12");
  assert.strictEqual(formatTime(93), "1:33");
  assert.strictEqual(formatTime(105), "1:45");
});

test("formatTime: shows hours only when >= 1h", () => {
  assert.strictEqual(formatTime(3599), "59:59");
  assert.strictEqual(formatTime(3661), "1:01:01");
});

test("formatTime: floors fractional seconds", () => {
  assert.strictEqual(formatTime(12.9), "0:12");
});

test("formatTime: non-finite / negative → 0:00", () => {
  assert.strictEqual(formatTime(NaN), "0:00");
  assert.strictEqual(formatTime(Infinity), "0:00");
  assert.strictEqual(formatTime(-5), "0:00");
});

// ── validateRange ─────────────────────────────────────────────────────────────
test("validateRange: a normal in<out range within duration is valid", () => {
  assert.strictEqual(validateRange(12, 105, 200, 0.5).valid, true);
});

test("validateRange: in must be >= 0 and out <= duration", () => {
  assert.strictEqual(validateRange(-1, 105, 200, 0.5).valid, false);
  assert.strictEqual(validateRange(12, 250, 200, 0.5).valid, false);
});

test("validateRange: in must be strictly before out", () => {
  assert.strictEqual(validateRange(100, 100, 200, 0.5).valid, false);
  assert.strictEqual(validateRange(120, 100, 200, 0.5).valid, false);
});

test("validateRange: range shorter than the minimum is rejected", () => {
  const r = validateRange(100, 100.2, 200, 0.5);
  assert.strictEqual(r.valid, false);
  assert.match(r.reason, /min/i);
});

test("validateRange: non-finite inputs are invalid", () => {
  assert.strictEqual(validateRange(NaN, 105, 200, 0.5).valid, false);
  assert.strictEqual(validateRange(12, Infinity, 200, 0.5).valid, false);
});

// ── clampIn (drag in-handle / Set In @ playhead) ─────────────────────────────
// Handle semantics: the in-handle moves to the target time but can NEVER cross
// the out-handle — it stops minLen short of it (out stays put). This is what a
// draggable trim bar must do; a button press shares the same rule.
test("clampIn: moves the in-point to the target time", () => {
  assert.deepStrictEqual(clampIn({ in: 0, out: 100 }, 30, 200, 1), { in: 30, out: 100 });
});

test("clampIn: clamps a negative target to 0", () => {
  assert.deepStrictEqual(clampIn({ in: 10, out: 100 }, -5, 200, 1), { in: 0, out: 100 });
});

test("clampIn: stops minLen short of out, never crossing it", () => {
  assert.deepStrictEqual(clampIn({ in: 0, out: 50 }, 60, 200, 1), { in: 49, out: 50 });
});

// ── clampOut (drag out-handle / Set Out @ playhead) ──────────────────────────
test("clampOut: moves the out-point to the target time", () => {
  assert.deepStrictEqual(clampOut({ in: 10, out: 100 }, 150, 200, 1), { in: 10, out: 150 });
});

test("clampOut: clamps the target to duration", () => {
  assert.deepStrictEqual(clampOut({ in: 10, out: 100 }, 250, 200, 1), { in: 10, out: 200 });
});

test("clampOut: stops minLen past in, never crossing it", () => {
  assert.deepStrictEqual(clampOut({ in: 50, out: 100 }, 30, 200, 1), { in: 50, out: 51 });
});

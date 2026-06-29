// cropMath.test.js
const test = require("node:test");
const assert = require("node:assert");
const { evenRound, getRenderedVideoRect, rectToSourceCrop, stretchOutputDims, resizeBox } = require("./cropMath.js");

const BOUNDS = { x: 0, y: 0, w: 500, h: 500 };
const MIN = 20;

test("evenRound rounds down to even, floors at 0", () => {
  assert.strictEqual(evenRound(101), 100);
  assert.strictEqual(evenRound(103), 102);
  assert.strictEqual(evenRound(-5), 0);
});

test("getRenderedVideoRect letterboxes a 16:9 video in a 4:3 container", () => {
  // 1920x1080 into 800x800 → width-constrained: rendered 800x450, centered vertically
  const r = getRenderedVideoRect({ w: 1920, h: 1080 }, { w: 800, h: 800 });
  assert.strictEqual(Math.round(r.w), 800);
  assert.strictEqual(Math.round(r.h), 450);
  assert.strictEqual(Math.round(r.x), 0);
  assert.strictEqual(Math.round(r.y), 175);
});

test("rectToSourceCrop maps a centered half-size box to source pixels (even)", () => {
  const natural = { w: 1920, h: 1080 };
  const rendered = { x: 0, y: 175, w: 800, h: 450 };
  // a 400x225 box at the rendered center → half the source, centered
  const rect = { x: 200, y: 175 + 112.5, w: 400, h: 225 };
  const crop = rectToSourceCrop(rect, rendered, natural);
  assert.deepStrictEqual(crop, { x: 480, y: 270, width: 960, height: 540 });
});

test("rectToSourceCrop clamps a box dragged past the edges", () => {
  const natural = { w: 1000, h: 1000 };
  const rendered = { x: 0, y: 0, w: 500, h: 500 };
  const rect = { x: -50, y: -50, w: 600, h: 600 }; // overflow both sides
  const crop = rectToSourceCrop(rect, rendered, natural);
  assert.deepStrictEqual(crop, { x: 0, y: 0, width: 1000, height: 1000 });
});

test("stretchOutputDims: no distortion (frame == baseFrame) keeps crop's native size", () => {
  const crop = { x: 480, y: 270, width: 960, height: 540 };
  const baseFrame = { w: 400, h: 225 };
  const frame = { w: 400, h: 225 };
  assert.deepStrictEqual(stretchOutputDims(crop, frame, baseFrame), { width: 960, height: 540 });
});

test("stretchOutputDims: uniform 2x frame doubles both source dimensions", () => {
  const crop = { x: 0, y: 0, width: 960, height: 540 };
  const baseFrame = { w: 400, h: 225 };
  const frame = { w: 800, h: 450 };
  assert.deepStrictEqual(stretchOutputDims(crop, frame, baseFrame), { width: 1920, height: 1080 });
});

test("stretchOutputDims: non-uniform frame stretches axes independently", () => {
  const crop = { x: 0, y: 0, width: 960, height: 540 };
  const baseFrame = { w: 400, h: 225 };
  const frame = { w: 800, h: 225 }; // widen only
  assert.deepStrictEqual(stretchOutputDims(crop, frame, baseFrame), { width: 1920, height: 540 });
});

test("stretchOutputDims: rounds DOWN to even (bounds-safe), like evenRound", () => {
  const crop = { x: 0, y: 0, width: 1000, height: 1000 };
  const baseFrame = { w: 1000, h: 1000 };
  const frame = { w: 1003, h: 1001 }; // ratios 1.003 / 1.001 → 1003 / 1001 → even 1002 / 1000
  assert.deepStrictEqual(stretchOutputDims(crop, frame, baseFrame), { width: 1002, height: 1000 });
});

test("stretchOutputDims: zero-sized baseFrame falls back to crop's native size (no NaN)", () => {
  const crop = { x: 0, y: 0, width: 960, height: 540 };
  const baseFrame = { w: 0, h: 0 };
  const frame = { w: 400, h: 225 };
  assert.deepStrictEqual(stretchOutputDims(crop, frame, baseFrame), { width: 960, height: 540 });
});

test("resizeBox: SE corner enlarges within bounds", () => {
  const box = { x: 100, y: 100, w: 100, h: 100 };
  assert.deepStrictEqual(resizeBox(box, "se", 50, 50, BOUNDS, MIN), { x: 100, y: 100, w: 150, h: 150 });
});

test("resizeBox: NW corner moves left + top edges, growing the box", () => {
  const box = { x: 100, y: 100, w: 100, h: 100 };
  assert.deepStrictEqual(resizeBox(box, "nw", -30, -40, BOUNDS, MIN), { x: 70, y: 60, w: 130, h: 140 });
});

test("resizeBox: W edge handle moves only the left edge, clamps at bounds.x", () => {
  const box = { x: 100, y: 100, w: 100, h: 100 };
  assert.deepStrictEqual(resizeBox(box, "w", -200, 0, BOUNDS, MIN), { x: 0, y: 100, w: 200, h: 100 });
});

test("resizeBox: N edge handle moves only the top edge", () => {
  const box = { x: 100, y: 100, w: 100, h: 100 };
  assert.deepStrictEqual(resizeBox(box, "n", 0, -40, BOUNDS, MIN), { x: 100, y: 60, w: 100, h: 140 });
});

test("resizeBox: enforces min size when a corner is dragged inward past it", () => {
  const box = { x: 100, y: 100, w: 100, h: 100 };
  assert.deepStrictEqual(resizeBox(box, "se", -200, -200, BOUNDS, MIN), { x: 100, y: 100, w: 20, h: 20 });
});

test("resizeBox: E edge clamps at the right bound", () => {
  const box = { x: 100, y: 100, w: 100, h: 100 };
  assert.deepStrictEqual(resizeBox(box, "e", 1000, 0, BOUNDS, MIN), { x: 100, y: 100, w: 400, h: 100 });
});

test("resizeBox: move translates the whole box, clamped so it stays in bounds", () => {
  const box = { x: 400, y: 400, w: 100, h: 100 }; // right/bottom already on the bound
  assert.deepStrictEqual(resizeBox(box, "move", 50, 50, BOUNDS, MIN), { x: 400, y: 400, w: 100, h: 100 });
});

test("resizeBox: move within bounds shifts by the full delta", () => {
  const box = { x: 100, y: 100, w: 100, h: 100 };
  assert.deepStrictEqual(resizeBox(box, "move", 50, -30, BOUNDS, MIN), { x: 150, y: 70, w: 100, h: 100 });
});

test("resizeBox: bounds with an offset origin (letterboxed video) clamp correctly", () => {
  const bounds = { x: 0, y: 175, w: 800, h: 450 }; // 16:9 letterboxed in 4:3
  const box = { x: 0, y: 175, w: 800, h: 450 };    // full-frame
  // drag the top edge up past the letterbox top — should clamp at y=175, not 0
  assert.deepStrictEqual(resizeBox(box, "n", 0, -100, bounds, MIN), { x: 0, y: 175, w: 800, h: 450 });
});

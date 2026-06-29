// cropMath.test.js
const test = require("node:test");
const assert = require("node:assert");
const { evenRound, getRenderedVideoRect, rectToSourceCrop } = require("./cropMath.js");

test("evenRound rounds to nearest even, floors at 0", () => {
  assert.strictEqual(evenRound(101), 100);
  assert.strictEqual(evenRound(103), 104);
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

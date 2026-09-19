// cropLoupe.test.js
const test = require("node:test");
const assert = require("node:assert");
const {
  NUDGE_STEP, NUDGE_STEP_COARSE,
  anchorPoint, loupeSample, loupePlacement, edgeReadout, formatReadout, cutBands, nudgeDelta,
} = require("./cropLoupe.js");

// A 1920x1080 source in the modal's 720x405 stage renders edge-to-edge:
// 1 container px = 2.6667 source px. That ratio is the whole reason the loupe exists.
const NATURAL = { w: 1920, h: 1080 };
const RENDERED = { x: 0, y: 0, w: 720, h: 405 };
const CONTAINER = { w: 720, h: 405 };
const LOUPE = { w: 184, h: 140 };
const FULL = { x: 0, y: 0, w: 720, h: 405 };
// Letterboxed 1920x1080 with 138px bars top and bottom: 138/2.6667 = 51.75 container px.
const LETTERBOXED = { x: 0, y: 51.75, w: 720, h: 301.5 };

test("anchorPoint sits on the edge each handle moves", () => {
  assert.deepStrictEqual(anchorPoint(FULL, "n"), { x: 360, y: 0 });
  assert.deepStrictEqual(anchorPoint(FULL, "s"), { x: 360, y: 405 });
  assert.deepStrictEqual(anchorPoint(FULL, "w"), { x: 0, y: 202.5 });
  assert.deepStrictEqual(anchorPoint(FULL, "e"), { x: 720, y: 202.5 });
  assert.deepStrictEqual(anchorPoint(FULL, "nw"), { x: 0, y: 0 });
  assert.deepStrictEqual(anchorPoint(FULL, "se"), { x: 720, y: 405 });
});

test("loupeSample centres a 1:1 source-pixel window on the dragged edge", () => {
  const s = loupeSample(LETTERBOXED, "n", RENDERED, NATURAL, LOUPE);
  // Top edge is at source y=138; the window is 140 tall so it starts 70px above.
  assert.deepStrictEqual(s.src, { x: 868, y: 68, w: 184, h: 140 });
  assert.strictEqual(s.scaleX, 1); // true 1:1 — one source pixel per loupe pixel
  assert.strictEqual(s.scaleY, 1);
  assert.strictEqual(s.hair.y, 70); // the edge lands dead centre
  assert.strictEqual(s.hair.x, null); // a horizontal edge draws no vertical hairline
  assert.strictEqual(s.keep.y, "below"); // content kept is under the top edge
  assert.strictEqual(s.keep.x, null);
});

test("loupeSample clamps the window to the frame, moving the hairline off centre", () => {
  // Top edge at source y=0: there is nothing above it to show, so the window
  // starts at 0 and the hairline sits at the top rather than the middle.
  const s = loupeSample(FULL, "n", RENDERED, NATURAL, LOUPE);
  assert.strictEqual(s.src.y, 0);
  assert.strictEqual(s.hair.y, 0);
  // Bottom-right corner: window clamps against both far edges.
  const c = loupeSample(FULL, "se", RENDERED, NATURAL, LOUPE);
  assert.strictEqual(c.src.x, NATURAL.w - LOUPE.w);
  assert.strictEqual(c.src.y, NATURAL.h - LOUPE.h);
  assert.strictEqual(c.hair.x, LOUPE.w);
  assert.strictEqual(c.hair.y, LOUPE.h);
  assert.strictEqual(c.keep.x, "left");
  assert.strictEqual(c.keep.y, "above");
});

test("loupeSample scales up when the source is smaller than the loupe", () => {
  const tiny = { w: 92, h: 70 };
  const rnd = { x: 0, y: 0, w: 720, h: 405 };
  const s = loupeSample({ x: 0, y: 0, w: 720, h: 405 }, "w", rnd, tiny, LOUPE);
  assert.strictEqual(s.src.w, 92); // can't sample more than exists
  assert.strictEqual(s.src.h, 70);
  assert.strictEqual(s.scaleX, 2); // 184/92 — still nearest-neighbour, just bigger blocks
  assert.strictEqual(s.scaleY, 2);
  assert.strictEqual(s.hair.x, 0);
});

test("loupePlacement puts the panel outside the box, never over the kept content", () => {
  // Top edge → above it. At y=0 there's no room, so it flips below.
  assert.deepStrictEqual(loupePlacement(FULL, "n", CONTAINER, LOUPE), { left: 268, top: 12 });
  // Bottom edge at y=405 → below is off-stage, flips above.
  assert.deepStrictEqual(loupePlacement(FULL, "s", CONTAINER, LOUPE), { left: 268, top: 253 });
  // A letterboxed top edge has room above: 51.75 - 12 - 140 is negative, so it flips too.
  assert.deepStrictEqual(loupePlacement(LETTERBOXED, "n", CONTAINER, LOUPE), { left: 268, top: 63.75 });
});

test("loupePlacement flips horizontally at the right edge and stays fully on stage", () => {
  const p = loupePlacement(FULL, "e", CONTAINER, LOUPE);
  assert.strictEqual(p.left, 524); // 720 - 12 - 184
  assert.ok(p.left >= 0 && p.left + LOUPE.w <= CONTAINER.w);
  assert.ok(p.top >= 0 && p.top + LOUPE.h <= CONTAINER.h);
  const w = loupePlacement(FULL, "w", CONTAINER, LOUPE);
  assert.strictEqual(w.left, 12); // no room to the left of x=0 → flips right
});

test("edgeReadout reports the source pixel the encode will actually use", () => {
  const r = edgeReadout(LETTERBOXED, "n", RENDERED, NATURAL);
  assert.deepStrictEqual(r.y, { label: "top", value: 138, cut: 138 });
  assert.strictEqual(r.x, null);
  const s = edgeReadout(LETTERBOXED, "s", RENDERED, NATURAL);
  assert.deepStrictEqual(s.y, { label: "bottom", value: 942, cut: 138 });
  const e = edgeReadout(LETTERBOXED, "e", RENDERED, NATURAL);
  assert.deepStrictEqual(e.x, { label: "right", value: 1920, cut: 0 });
});

test("edgeReadout gives both axes for a corner handle", () => {
  const r = edgeReadout(LETTERBOXED, "nw", RENDERED, NATURAL);
  assert.deepStrictEqual(r.x, { label: "left", value: 0, cut: 0 });
  assert.deepStrictEqual(r.y, { label: "top", value: 138, cut: 138 });
});

test("formatReadout names which side is cut, not just how much", () => {
  assert.strictEqual(
    formatReadout(edgeReadout(LETTERBOXED, "n", RENDERED, NATURAL)),
    "top y 138 · cut 138px above");
  assert.strictEqual(
    formatReadout(edgeReadout(LETTERBOXED, "s", RENDERED, NATURAL)),
    "bottom y 942 · cut 138px below");
  assert.strictEqual(
    formatReadout(edgeReadout(LETTERBOXED, "w", RENDERED, NATURAL)),
    "left x 0 · cut 0px left");
  assert.strictEqual(
    formatReadout(edgeReadout(LETTERBOXED, "nw", RENDERED, NATURAL)),
    "x 0 · y 138");
});

test("cutBands paints the whole removed side and never a kept pixel", () => {
  // Top edge: the crop's y is the first KEPT row, so the marker line belongs on
  // the row above it and nothing at or below the hairline may be painted.
  const top = loupeSample(LETTERBOXED, "n", RENDERED, NATURAL, LOUPE);
  const b = cutBands(top, LOUPE);
  assert.deepStrictEqual(b.washes, [{ x: 0, y: 0, w: 184, h: 70 }]);
  assert.deepStrictEqual(b.lines, [{ x: 0, y: 69, w: 184, h: 1 }]);
  for (const r of b.washes.concat(b.lines)) {
    assert.ok(r.y + r.h <= top.hair.y, "mark must stay above the first kept row");
  }

  // Bottom edge: y+height is the first REMOVED row, so the line sits ON the hairline
  // and the wash runs to the bottom of the panel.
  const bot = loupeSample(LETTERBOXED, "s", RENDERED, NATURAL, LOUPE);
  const bb = cutBands(bot, LOUPE);
  assert.deepStrictEqual(bb.washes, [{ x: 0, y: bot.hair.y, w: 184, h: LOUPE.h - bot.hair.y }]);
  assert.deepStrictEqual(bb.lines, [{ x: 0, y: bot.hair.y, w: 184, h: 1 }]);
  for (const r of bb.washes.concat(bb.lines)) {
    assert.ok(r.y >= bot.hair.y, "mark must stay at or below the first removed row");
  }
});

test("cutBands handles vertical edges and both axes at a corner", () => {
  const left = loupeSample(LETTERBOXED, "w", RENDERED, NATURAL, LOUPE);
  const lb = cutBands(left, LOUPE);
  assert.strictEqual(lb.washes.length, 1);
  assert.deepStrictEqual(lb.washes[0], { x: 0, y: 0, w: left.hair.x, h: LOUPE.h });
  // A corner moves two edges, so it marks two removed regions.
  const corner = loupeSample(LETTERBOXED, "se", RENDERED, NATURAL, LOUPE);
  const cb = cutBands(corner, LOUPE);
  assert.strictEqual(cb.washes.length, 2);
  assert.strictEqual(cb.lines.length, 2);
});

test("cutBands stays inside the panel when the edge is flush with the frame", () => {
  // Crop at the very top of the source: nothing is removed, so the wash is empty
  // and the line must not be pushed to a negative row.
  const s = loupeSample(FULL, "n", RENDERED, NATURAL, LOUPE);
  const b = cutBands(s, LOUPE);
  assert.strictEqual(b.washes[0].h, 0);
  assert.strictEqual(b.lines[0].y, 0);
  const se = cutBands(loupeSample(FULL, "se", RENDERED, NATURAL, LOUPE), LOUPE);
  for (const r of se.lines) {
    assert.ok(r.x >= 0 && r.x < LOUPE.w && r.y >= 0 && r.y < LOUPE.h);
  }
});

test("nudgeDelta steps in even source pixels", () => {
  // rectToSourceCrop rounds every edge DOWN to an even number, so an odd step
  // would sometimes produce no change at all — a key press that does nothing.
  assert.strictEqual(NUDGE_STEP % 2, 0);
  assert.strictEqual(NUDGE_STEP_COARSE % 2, 0);
  assert.deepStrictEqual(nudgeDelta("ArrowUp", false), { dx: 0, dy: -NUDGE_STEP });
  assert.deepStrictEqual(nudgeDelta("ArrowDown", false), { dx: 0, dy: NUDGE_STEP });
  assert.deepStrictEqual(nudgeDelta("ArrowLeft", false), { dx: -NUDGE_STEP, dy: 0 });
  assert.deepStrictEqual(nudgeDelta("ArrowRight", false), { dx: NUDGE_STEP, dy: 0 });
  assert.deepStrictEqual(nudgeDelta("ArrowRight", true), { dx: NUDGE_STEP_COARSE, dy: 0 });
  assert.strictEqual(nudgeDelta("a", false), null);
  assert.strictEqual(nudgeDelta("Enter", false), null);
});
